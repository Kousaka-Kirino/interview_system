"""Stage 7: local knowledge review notes and read-only Chroma excerpt discovery.

Self-contained FastAPI router; existing interview routes/models remain unchanged.
User-initiated highlighting is anchored to the saved knowledge chunk, not a PDF renderer.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from app.stage8b_auth import require_owner_id, _connect as require_owner_database
from app.stage11_local import is_legacy_owner, user_root

router = APIRouter(prefix="/api/study", tags=["Knowledge review"])

DIMENSIONS = (
    "理论依据", "论证逻辑", "研究方法", "数据证据", "创新价值", "答辩表达",
)
ORIENTATIONS = (
    "概念辨析", "依据核验", "方法追问", "反例挑战", "边界条件", "应用延伸",
)
STATUSES = ("pending", "mastered", "disputed")


def _project_root() -> Path:
    # backend/app/stage7_review.py -> project/backend/app -> project
    return Path(__file__).resolve().parents[2]


def _setting(name: str, default: str) -> str:
    present = os.environ.get(name)
    if present:
        return present.strip()
    config = _project_root() / ".env"
    if config.is_file():
        # Use only the required path key; never expose or log other .env values.
        for line in config.read_text(encoding="utf-8-sig").splitlines():
            item = line.strip()
            if not item or item.startswith("#") or "=" not in item:
                continue
            key, value = item.split("=", 1)
            if key.strip() == name:
                return value.strip().strip('"\'') or default
    return default


def _storage_path(name: str, default: str) -> Path:
    value = Path(_setting(name, default)).expanduser()
    return value if value.is_absolute() else (_project_root() / value).resolve()


def _db_path() -> Path:
    # Separate SQLite file: avoids migration/locks/conflicts with Stage 3 SQLAlchemy.
    return _storage_path("STUDY_SQLITE_PATH", "storage/data/study_review.db")


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    target = _db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(target), timeout=8)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout = 8000")
        db.execute("PRAGMA journal_mode = WAL")
        db.execute("""
            CREATE TABLE IF NOT EXISTS study_knowledge_points (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                session_id TEXT,
                material_id TEXT,
                source_name TEXT NOT NULL,
                source_anchor TEXT NOT NULL,
                source_text TEXT NOT NULL,
                quote TEXT NOT NULL,
                title TEXT NOT NULL,
                dimension TEXT NOT NULL,
                orientation TEXT NOT NULL,
                severity INTEGER NOT NULL CHECK (severity >= 1 AND severity <= 5),
                important INTEGER NOT NULL CHECK (important IN (0, 1)),
                status TEXT NOT NULL CHECK (status IN ('pending','mastered','disputed')),
                note TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS ix_study_session ON study_knowledge_points(session_id)")
        db.commit()
        yield db
        db.commit()
    finally:
        db.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _point(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item.pop("user_id", None)
    item["important"] = bool(item["important"])
    return item


class CreatePoint(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    session_id: str | None = Field(default=None, max_length=100)
    material_id: str | None = Field(default=None, max_length=150)
    source_name: str = Field(default="手动摘录", max_length=260)
    source_anchor: str = Field(default="", max_length=260)
    source_text: str = Field(min_length=1, max_length=12000)
    quote: str = Field(min_length=1, max_length=1200)
    dimension: Literal["理论依据", "论证逻辑", "研究方法", "数据证据", "创新价值", "答辩表达"] = "理论依据"
    orientation: Literal["概念辨析", "依据核验", "方法追问", "反例挑战", "边界条件", "应用延伸"] = "依据核验"
    severity: int = Field(default=3, ge=1, le=5)
    important: bool = True
    status: Literal["pending", "mastered", "disputed"] = "pending"
    note: str = Field(default="", max_length=3000)


class UpdatePoint(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=150)
    dimension: Literal["理论依据", "论证逻辑", "研究方法", "数据证据", "创新价值", "答辩表达"] | None = None
    orientation: Literal["概念辨析", "依据核验", "方法追问", "反例挑战", "边界条件", "应用延伸"] | None = None
    severity: int | None = Field(default=None, ge=1, le=5)
    important: bool | None = None
    status: Literal["pending", "mastered", "disputed"] | None = None
    note: str | None = Field(default=None, max_length=3000)


def _validate_quote(text: str, quote: str) -> None:
    if quote not in text:
        raise HTTPException(422, "引用片段必须逐字包含在原文片段中，才能准确定位并高亮")


@router.get("/health")
def health() -> dict[str, str]:
    with _database():
        return {"status": "ok", "storage": "local-sqlite"}


@router.get("/points")
def list_points(session_id: str | None = Query(default=None, max_length=100), user_id: str = Depends(require_owner_id)) -> dict[str, Any]:
    with _database() as db:
        if session_id:
            rows = db.execute(
                "SELECT * FROM study_knowledge_points WHERE session_id = ? AND user_id = ? ORDER BY updated_at DESC, id DESC", (session_id, user_id)
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM study_knowledge_points WHERE user_id = ? ORDER BY updated_at DESC, id DESC", (user_id,)).fetchall()
    return {"items": [_point(r) for r in rows], "total": len(rows)}


@router.post("/points", status_code=201)
def create_point(payload: CreatePoint, user_id: str = Depends(require_owner_id)) -> dict[str, Any]:
    data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    _validate_quote(data["source_text"], data["quote"])
    data.update(id=str(uuid.uuid4()), created_at=_now(), updated_at=_now(), user_id=user_id)
    data["important"] = 1 if data["important"] else 0
    fields = list(data)
    with _database() as db:
        db.execute(
            f"INSERT INTO study_knowledge_points ({', '.join(fields)}) VALUES ({', '.join('?' for _ in fields)})",
            [data[k] for k in fields],
        )
        result = db.execute("SELECT * FROM study_knowledge_points WHERE id = ?", (data["id"],)).fetchone()
    assert result is not None
    return _point(result)


@router.patch("/points/{point_id}")
def update_point(point_id: str, payload: UpdatePoint, user_id: str = Depends(require_owner_id)) -> dict[str, Any]:
    changes = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    if not changes:
        raise HTTPException(422, "没有需要更新的字段")
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "更新字段不能为 null")
    if "important" in changes:
        changes["important"] = 1 if changes["important"] else 0
    changes["updated_at"] = _now()
    with _database() as db:
        original = db.execute("SELECT id FROM study_knowledge_points WHERE id = ? AND user_id = ?", (point_id, user_id)).fetchone()
        if original is None:
            raise HTTPException(404, "知识点不存在")
        assignments = ", ".join(f"{field} = ?" for field in changes)
        db.execute(f"UPDATE study_knowledge_points SET {assignments} WHERE id = ? AND user_id = ?", [*changes.values(), point_id, user_id])
        result = db.execute("SELECT * FROM study_knowledge_points WHERE id = ?", (point_id,)).fetchone()
    assert result is not None
    return _point(result)


@router.delete("/points/{point_id}", status_code=204)
def delete_point(point_id: str, user_id: str = Depends(require_owner_id)) -> None:
    with _database() as db:
        cursor = db.execute("DELETE FROM study_knowledge_points WHERE id = ? AND user_id = ?", (point_id, user_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "知识点不存在")


@router.get("/overview")
def overview(session_id: str | None = Query(default=None, max_length=100), user_id: str = Depends(require_owner_id)) -> dict[str, Any]:
    with _database() as db:
        if session_id:
            rows = db.execute("SELECT * FROM study_knowledge_points WHERE session_id = ? AND user_id = ?", (session_id, user_id)).fetchall()
        else:
            rows = db.execute("SELECT * FROM study_knowledge_points WHERE user_id = ?", (user_id,)).fetchall()
    points = [_point(r) for r in rows]
    heatmap = {dimension: {"low": 0, "medium": 0, "high": 0} for dimension in DIMENSIONS}
    radar = []
    for dimension in DIMENSIONS:
        relevant = [p for p in points if p["dimension"] == dimension]
        # The radar displays *review readiness inferred from user annotations*,
        # not a six-dimensional evaluation produced by an LLM.
        max_risk = sum(5 * (1.4 if p["important"] else 1.0) for p in relevant)
        actual_risk = sum(
            p["severity"] * (1.4 if p["important"] else 1.0) *
            (0.15 if p["status"] == "mastered" else 0.8 if p["status"] == "disputed" else 1.0)
            for p in relevant
        )
        radar.append({
            "dimension": dimension,
            "value": round(100 * (1 - actual_risk / max_risk)) if max_risk else None,
            "count": len(relevant),
        })
    for p in points:
        tier = "high" if p["severity"] >= 4 else "medium" if p["severity"] >= 3 else "low"
        if p["status"] != "mastered":
            heatmap[p["dimension"]][tier] += 1
    risk_items = sorted(
        (p for p in points if p["status"] != "mastered"),
        key=lambda p: (p["severity"] * (1.4 if p["important"] else 1.0), p["updated_at"]), reverse=True,
    )
    return {
        "source": "local-user-annotations",
        "note": "雷达图为知识点标记推导的复习准备度，不是 AI 正式能力评分；无标记的维度不生成分数。",
        "total": len(points),
        "important": sum(bool(p["important"]) for p in points),
        "pending": sum(p["status"] == "pending" for p in points),
        "mastered": sum(p["status"] == "mastered" for p in points),
        "disputed": sum(p["status"] == "disputed" for p in points),
        "radar": radar,
        "heatmap": heatmap,
        "top_risks": [{key: p[key] for key in ("id", "title", "dimension", "orientation", "severity", "important", "status", "source_name")} for p in risk_items[:30]],
    }


def _matches_material(metadata: dict[str, Any], material_ids: set[str]) -> bool:
    if not material_ids:
        return True
    for name in ("material_id", "resource_id", "document_id", "file_id", "source_id"):
        value = metadata.get(name)
        if value is not None and str(value) in material_ids:
            return True
    return False


def _lexical_score(query: str, text: str) -> float:
    clean = query.strip().lower()[:200]
    body = text.lower()
    if not clean or not body:
        return 0
    if clean in body:
        return 100.0
    parts = [part for part in re.split(r"[\s,，。？！?、;；：:]+", clean) if len(part) >= 2]
    part_hits = sum(8 for part in parts[:12] if part in body)
    pairs = {clean[i:i+2] for i in range(len(clean)-1) if clean[i:i+2].strip()}
    pair_hits = sum(1 for pair in pairs if pair in body)
    return float(part_hits + pair_hits)


@router.get("/search")
def search_knowledge(
    query: str = Query(min_length=2, max_length=200),
    material_ids: str = Query(default="", max_length=2500),
    limit: int = Query(default=8, ge=1, le=20),
    user_id: str = Depends(require_owner_id),
) -> dict[str, Any]:
    """Best-effort lexical search over existing Chroma chunks; no embedding calls.

    If Stage 2 stores no material ID in metadata, material-scoped requests may
    return zero matches by design instead of accidentally citing other files.
    """
    # The legacy Chroma folder belongs only to the original owner (Stage 8A ledger).
    # Never enable this endpoint for additional accounts without per-user collections.
    if is_legacy_owner(user_id):
        with require_owner_database() as owner_db:
            legacy = owner_db.execute("SELECT owner_user_id FROM app_vector_ownership").fetchall()
            if (not legacy and _storage_path("CHROMA_PATH", "storage/chroma").is_dir()) or any(row[0] != user_id for row in legacy):
                raise HTTPException(403, "知识库归属不符，检索已拒绝。")
        storage = _storage_path("CHROMA_PATH", "storage/chroma")
    else:
        storage = user_root(user_id) / "chroma"
    try:
        import chromadb
    except ImportError:
        return {"items": [], "status": "unavailable", "message": "缺少 chromadb；仍可手动录入知识片段"}

    if not storage.is_dir():
        return {"items": [], "status": "empty", "message": "当前知识库尚无持久化索引，可手动录入"}
    try:
        client = chromadb.PersistentClient(path=str(storage))
        collection_list = client.list_collections()
        wanted = set(item.strip() for item in material_ids.split(",") if item.strip())
        all_hits: list[dict[str, Any]] = []
        examined = 0
        for collection_info in collection_list[:20]:
            collection_name = collection_info if isinstance(collection_info, str) else collection_info.name
            collection = client.get_collection(name=collection_name)
            offset = 0
            while offset < 800 and examined < 1800:
                batch = collection.get(limit=min(200, 800-offset), offset=offset, include=["documents", "metadatas"])
                ids = batch.get("ids") or []
                documents = batch.get("documents") or []
                metadatas = batch.get("metadatas") or []
                if not ids:
                    break
                for i, identifier in enumerate(ids):
                    examined += 1
                    excerpt = documents[i] if i < len(documents) else None
                    if not isinstance(excerpt, str) or not excerpt.strip():
                        continue
                    metadata = metadatas[i] if i < len(metadatas) and isinstance(metadatas[i], dict) else {}
                    if not _matches_material(metadata, wanted):
                        continue
                    score = _lexical_score(query, excerpt)
                    if score < 2:
                        continue
                    source = str(metadata.get("filename") or metadata.get("source") or metadata.get("file_name") or collection_name)
                    anchor = str(metadata.get("page") or metadata.get("page_number") or metadata.get("chunk_index") or "")
                    material = str(metadata.get("material_id") or metadata.get("resource_id") or "")
                    # Retain full chunk for exact in-app highlighting; no LLM guessed citations.
                    chunk = excerpt[:12000]
                    needle = query.strip().lower()
                    found_at = chunk.lower().find(needle)
                    if found_at < 0:
                        found_at = next((chunk.lower().find(query[i:i+2].lower()) for i in range(len(query)-1) if query[i:i+2].lower() in chunk.lower()), 0)
                    start = max(0, found_at - 45)
                    end = min(len(chunk), start + 200)
                    # Quote must exactly exist inside chunk, no ellipsis added.
                    quote = chunk[start:end]
                    all_hits.append({
                        "source_id": f"{collection_name}:{identifier}",
                        "source_name": source[:260],
                        "source_anchor": anchor[:260],
                        "material_id": material[:150] or None,
                        "source_text": chunk,
                        "quote": quote,
                        "score": score,
                    })
                offset += len(ids)
                if len(ids) < 200:
                    break
        all_hits.sort(key=lambda hit: hit["score"], reverse=True)
        return {
            "items": all_hits[:limit], "status": "ok", "scanned": examined,
            "message": "仅为已有 Chroma 片段的关键词候选检索；不代表模型实际引用或语义检索结果。",
        }
    except Exception as exc:
        # Avoid leaking local paths and possibly sensitive backend error payloads.
        return {"items": [], "status": "unavailable", "message": f"知识库检索暂不可用（{type(exc).__name__}）；可手动录入"}
