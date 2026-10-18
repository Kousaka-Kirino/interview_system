"""Stage 8C2: check primary resource ownership at the API boundary.

Safe single-owner transitional guard, NOT complete multi-user isolation.
Authentication remains with Stage 8B; study notes stay scoped by Stage 8C1.
"""
from __future__ import annotations

import json
import re
import sqlite3
from urllib.parse import parse_qs

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse

from app.stage8b_auth import require_owner_id, _connect

_RESOURCE_PATH = re.compile(r"^/api/(resumes|materials|interviews)/([^/]+)(?:/|$)")
_RESOURCE_KIND = {"resumes": "resume", "materials": "material", "interviews": "session"}
_INTERVIEW_STATIC = {"history", "statistics"}
_MAX_BODY = 128 * 1024


def _response(status: int, message: str):
    return JSONResponse({"detail": message}, status_code=status,
                        headers={"Cache-Control": "no-store"})


def _owner_or_error(request: Request) -> str:
    try:
        return require_owner_id(request)
    except HTTPException as e:
        raise e
    except (RuntimeError, sqlite3.Error):
        raise HTTPException(503, "用户归属服务暂不可用")


def _owned(db: sqlite3.Connection, kind: str, rid: str, user: str) -> bool:
    if not rid or len(rid) > 150:
        return False
    rows = db.execute("SELECT value FROM app_stage8c2_meta WHERE name=?", (kind + "_table",)).fetchall()
    if len(rows) != 1:
        raise RuntimeError("Missing Stage 8C2 ownership mapping")
    table = rows[0][0]
    # Fixed allowlist, never arbitrary identifiers supplied by the client.
    if table not in (
        "resumes", "resume", "resume_records", "resume_documents", "uploaded_resumes",
        "materials", "material", "supplementary_materials", "supplementary_material", "knowledge_materials", "reference_materials",
        "interview_sessions", "interviews", "interview_session", "interview_records", "defense_sessions", "sessions",
    ):
        raise RuntimeError("Unrecognized owner-scoped table")
    row = db.execute('SELECT 1 FROM "' + table + '" WHERE id=? AND user_id=? LIMIT 1', (rid, user)).fetchone()
    return row is not None


def _verify_references(refs: list[tuple[str, str]], request: Request):
    if not refs:
        return None
    try:
        uid = _owner_or_error(request)
        with _connect() as db:
            if not db.execute("SELECT 1 FROM app_stage8c2_meta WHERE name='multiuser_enabled' AND value='0'").fetchone():
                return _response(503, "多账号隔离尚未开放，请停止该请求")
            for kind, rid in refs:
                if not _owned(db, kind, rid, uid):
                    return _response(404, "资源不存在或无权访问")
    except HTTPException as exc:
        return _response(exc.status_code, str(exc.detail))
    except (sqlite3.Error, RuntimeError):
        return _response(503, "资源归属服务不可用")
    return None


def _extract_json_refs(path: str, value):
    if not isinstance(value, dict):
        return []
    refs = []
    if path == "/api/interviews":
        if isinstance(value.get("resume_id"), str):
            refs.append(("resume", value["resume_id"]))
        if isinstance(value.get("material_ids"), list):
            refs.extend(("material", item) for item in value["material_ids"] if isinstance(item, str))
    elif path == "/api/study/points":
        if isinstance(value.get("session_id"), str) and value["session_id"]:
            refs.append(("session", value["session_id"]))
        if isinstance(value.get("material_id"), str) and value["material_id"]:
            refs.append(("material", value["material_id"]))
    return refs


class OwnerScopeMiddleware:
    """Pure ASGI middleware; request replay prevents POST body starvation."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "").rstrip("/") or "/"
        method = scope.get("method", "GET").upper()
        request = Request(scope)
        refs: list[tuple[str, str]] = []
        match = _RESOURCE_PATH.match(path)
        if match:
            section, rid = match.groups()
            if section != "interviews" or rid not in _INTERVIEW_STATIC:
                refs.append((_RESOURCE_KIND[section], rid))
        if path == "/api/study/search" and method == "GET":
            args = parse_qs(scope.get("query_string", b"").decode("utf-8", errors="replace"))
            for rid in args.get("material_ids", [""])[0].split(","):
                if rid.strip():
                    refs.append(("material", rid.strip()))
        body = None
        if method == "POST" and path in ("/api/interviews", "/api/study/points"):
            chunks = []
            size = 0
            while True:
                part = await receive()
                if part["type"] != "http.request":
                    return await _response(400, "请求已中断")(scope, receive, send)
                chunk = part.get("body", b"")
                size += len(chunk)
                if size > _MAX_BODY:
                    return await _response(413, "请求数据超过大小限制")(scope, receive, send)
                chunks.append(chunk)
                if not part.get("more_body", False):
                    break
            body = b"".join(chunks)
            try:
                refs.extend(_extract_json_refs(path, json.loads(body)))
            except (ValueError, UnicodeDecodeError):
                pass  # Let the endpoint's request validation report the error.
        error = _verify_references(refs, request)
        if error is not None:
            return await error(scope, receive, send)
        if body is not None:
            completed = False
            async def replay():
                nonlocal completed
                if not completed:
                    completed = True
                    return {"type": "http.request", "body": body, "more_body": False}
                # Forward further messages (e.g. disconnect) instead of forging them.
                return await receive()
            return await self.app(scope, replay, send)
        return await self.app(scope, receive, send)


def install_owner_scope(app):
    if getattr(app.state, "stage8c2_owner_scope_installed", False):
        return
    app.add_middleware(OwnerScopeMiddleware)
    app.state.stage8c2_owner_scope_installed = True
