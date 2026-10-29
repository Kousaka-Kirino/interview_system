"""Stage 8B: single-owner local authentication boundary.

Deliberately NO user registration. All legacy resources remain under aslan until
Stage 8C adds per-resource ownership checks and independently scoped storage.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
from uuid import uuid4
import sqlite3
import time
from contextlib import contextmanager
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

COOKIE = "defense_training_session"
TOKEN_LIFETIME_SECONDS = 12 * 60 * 60
SCHEME = "scrypt-n32768-r8-p1"
_ROUTER = APIRouter(prefix="/api/auth", tags=["Account authentication"])
_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
_NO_LOGIN = {"/api/auth/login", "/api/auth/register", "/api/auth/me", "/api/auth/logout", "/api/auth/change-password"}
_LIMIT = 5
_BLOCK_SECONDS = 10 * 60


def _root() -> Path:
    return Path(__file__).resolve().parents[2]


def _value(name: str, default: str) -> str:
    if name in os.environ:
        return os.environ[name]
    env = _root() / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, raw = line.split("=", 1)
            if key.strip() == name:
                return raw.strip().strip('"\'')
    return default


def _database_path() -> Path:
    path = Path(_value("SQLITE_PATH", "storage/data/interview.db")).expanduser()
    path = path.resolve() if path.is_absolute() else (_root() / path).resolve()
    if not path.is_relative_to((_root() / "storage").resolve()):
        raise RuntimeError("Auth database must be inside project storage/.")
    return path


@contextmanager
def _connect():
    path = _database_path()
    if not path.is_file():
        raise RuntimeError("Stage 8A database was not found.")
    db = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=8)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=8000")
        db.execute("PRAGMA foreign_keys=ON")
        with db:
            yield db
    finally:
        db.close()


def _hash_password(password: str, salt64: str) -> str:
    salt = base64.b64decode(salt64, validate=True)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=32768, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
    return base64.b64encode(digest).decode("ascii")


def _check_password(password: str, user: sqlite3.Row) -> bool:
    if user["password_scheme"] != SCHEME:
        return False
    try:
        actual = _hash_password(password, user["password_salt"])
        return hmac.compare_digest(actual, user["password_hash"])
    except (ValueError, TypeError):
        return False


def _owner(db: sqlite3.Connection) -> sqlite3.Row | None:
    """Preserve the original account; no longer enforce single-account count."""
    return db.execute("SELECT * FROM app_users WHERE username = 'aslan' COLLATE NOCASE AND is_active = 1").fetchone()


def _session_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode("ascii")).hexdigest()


def _session(db: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    if not token or len(token) > 150:
        return None
    try:
        digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    except UnicodeError:
        return None
    return db.execute("""SELECT u.*, s.token_hash FROM app_auth_sessions s
        JOIN app_users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>? AND u.is_active=1""",
        (digest, int(time.time()))).fetchone()


def _response_user(row: sqlite3.Row) -> dict[str, Any]:
    return {"username": row["username"], "must_change_password": bool(row["must_change_password"]), "registration_enabled": True}


def _json_error(status: int, msg: str) -> JSONResponse:
    response = JSONResponse({"detail": msg}, status_code=status)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _client_is_local(request: Request) -> bool:
    host = request.client.host if request.client else ""
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _allow_origin(request: Request) -> bool:
    origin = request.headers.get("origin", "")
    candidates = {"http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8000", "http://localhost:8000"}
    candidates.update(x.strip() for x in _value("CORS_ORIGINS", "").split(",") if x.strip())
    # Never expand the CSRF allowlist to a remote site, even if CORS is misconfigured.
    try:
        parsed = urlsplit(origin)
        local_origin = (parsed.scheme in ("http", "https")
                        and parsed.hostname in ("127.0.0.1", "localhost", "::1")
                        and not parsed.username and not parsed.password
                        and not parsed.path and not parsed.query and not parsed.fragment)
        return bool(local_origin and origin in candidates)
    except ValueError:
        return False


class _AuthBarrier(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path.rstrip("/") or "/"
        # Keep the local-only access restriction for account and document privacy.
        if not _client_is_local(request):
            return _json_error(403, "本阶段仅允许本机访问。")
        if request.method == "OPTIONS":
            return await call_next(request)  # CORS preflight remains handled by existing CORSMiddleware
        if request.method in _MUTATING and not _allow_origin(request):
            return _json_error(403, "请求来源不被允许，请使用本地前端页面。")
        if path == "/api/auth/login":
            return await call_next(request)
        if path in _NO_LOGIN:
            return await call_next(request)
        try:
            with _connect() as db:
                row = _session(db, request.cookies.get(COOKIE))
                if not row:
                    return _json_error(401, "请先登录。")
                if row["must_change_password"]:
                    return _json_error(403, "请先修改初始密码。")
        except (sqlite3.Error, RuntimeError):
            return _json_error(503, "账户服务暂不可用，请检查后端启动日志和本地账号数据库。")
        response = await call_next(request)
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


def _set_cookie(response: JSONResponse, token: str, request: Request) -> None:
    response.set_cookie(COOKIE, token, max_age=TOKEN_LIFETIME_SECONDS, httponly=True,
                        samesite="lax", secure=(request.url.scheme == "https"), path="/")
    response.headers["Cache-Control"] = "no-store"


def _revoke(db: sqlite3.Connection, token: str | None) -> None:
    if token:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        db.execute("DELETE FROM app_auth_sessions WHERE token_hash=?", (digest,))


def _payload(data: Any, fields: tuple[str, ...]) -> dict[str, str]:
    if not isinstance(data, dict):
        raise HTTPException(400, "请求格式不正确。")
    output: dict[str, str] = {}
    for field in fields:
        value = data.get(field)
        if not isinstance(value, str) or not 0 < len(value) <= 256:
            raise HTTPException(422, "请填写有效的账号和密码。")
        output[field] = value
    return output


@_ROUTER.get("/me")
def me(request: Request):
    try:
        with _connect() as db:
            row = _session(db, request.cookies.get(COOKIE))
            if row is None:
                raise HTTPException(401, "尚未登录。")
            response = JSONResponse(_response_user(row))
            response.headers["Cache-Control"] = "no-store"
            return response
    except (sqlite3.Error, RuntimeError):
        raise HTTPException(503, "账号数据库尚未准备好。")


def _compatible_insert(db: sqlite3.Connection, table: str, fields: dict[str, object]) -> None:
    """Support Stage 8A schema variants without creating or replacing auth tables."""
    assert table in {"app_users", "app_user_profiles"}
    columns = db.execute(f"PRAGMA table_info({table})").fetchall()
    if not columns:
        raise RuntimeError(f"Missing local account table: {table}")
    names = {row["name"] for row in columns}
    for required in fields:
        if required not in names:
            raise RuntimeError(f"Missing column {table}.{required}")
    for row in columns:
        if row["name"] not in fields and row["notnull"] and not row["pk"] and row["dflt_value"] is None:
            raise RuntimeError(f"Unsupported required account column: {table}.{row['name']}")
    ordered = list(fields)
    quoted = ", ".join('"' + item + '"' for item in ordered)
    params = ", ".join("?" for _ in ordered)
    db.execute(f"INSERT INTO {table} ({quoted}) VALUES ({params})", tuple(fields[item] for item in ordered))


@_ROUTER.post("/register", status_code=201)
async def register(request: Request):
    """Local-only signup; every new account receives a different on-disk workspace."""
    try:
        info = _payload(await request.json(), ("username", "password"))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "请求格式不正确。")
    username = info["username"].strip().lower()
    password = info["password"]
    if not re.fullmatch(r"[a-z0-9_]{3,32}", username) or username == "aslan":
        raise HTTPException(422, "用户名需为 3～32 位小写英文字母、数字或下划线，且不能使用保留账号。")
    if not 12 <= len(password) <= 128 or len(password.encode("utf-8")) > 128:
        raise HTTPException(422, "密码需至少 12 位，且 UTF-8 编码不能超过 128 字节。")
    if password.lower() in {"password1234", "123456789012", username}:
        raise HTTPException(422, "密码过于简单，请使用更强的密码。")
    user_id = str(uuid4())
    salt = base64.b64encode(os.urandom(16)).decode("ascii")
    hashed = _hash_password(password, salt)
    now = int(time.time())
    from app.stage11_local import user_root
    workspace = user_root(user_id)
    try:
        with _connect() as db:
            if db.execute("SELECT 1 FROM app_users WHERE username=? COLLATE NOCASE", (username,)).fetchone():
                raise HTTPException(409, "用户名已被使用。")
            # Create a per-account workspace BEFORE inserting a usable account.
            from app.core.database import ensure_user_database
            ensure_user_database(user_id)
            user_columns = {r["name"] for r in db.execute("PRAGMA table_info(app_users)")}
            user_data = {
                "id": user_id, "username": username,
                "password_hash": hashed, "password_salt": salt,
                "password_scheme": SCHEME, "must_change_password": 0, "is_active": 1,
            }
            if "created_at" in user_columns:
                user_data["created_at"] = now
            if "updated_at" in user_columns:
                user_data["updated_at"] = now
            _compatible_insert(db, "app_users", user_data)
            profile_columns = {r["name"] for r in db.execute("PRAGMA table_info(app_user_profiles)")}
            profile_data = {"user_id": user_id, "display_name": username, "email": ""}
            if "created_at" in profile_columns:
                profile_data["created_at"] = now
            if "updated_at" in profile_columns:
                profile_data["updated_at"] = now
            _compatible_insert(db, "app_user_profiles", profile_data)
            token, digest = _session_token()
            db.execute("INSERT INTO app_auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                       (digest, user_id, now, now + TOKEN_LIFETIME_SECONDS))
            response = JSONResponse({"username": username, "must_change_password": False,
                                     "registration_enabled": True}, status_code=201)
            _set_cookie(response, token, request)
            return response
    except sqlite3.IntegrityError as exc:
        # If user creation was rolled back, remove only this new user workspace.
        import shutil
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(409, "用户名已被使用或账号数据冲突。") from exc
    except HTTPException:
        raise
    except Exception as exc:
        import shutil
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(503, "本地账号创建失败，请检查 SQLite 数据库结构与磁盘空间。") from exc


@_ROUTER.post("/login")
async def login(request: Request):
    try:
        info = _payload(await request.json(), ("username", "password"))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "请求格式不正确。")
    username = info["username"].strip().lower()
    if not username or len(username) > 80:
        raise HTTPException(422, "用户名不正确。")
    client = request.client.host if request.client else "unknown"
    key = hashlib.sha256((client + ":" + username).encode("utf-8")).hexdigest()
    now = int(time.time())
    try:
        with _connect() as db:
            user = db.execute("SELECT * FROM app_users WHERE username=? COLLATE NOCASE AND is_active=1", (username,)).fetchone()
            state = db.execute("SELECT failures, first_failure, blocked_until FROM app_auth_attempts WHERE key=?", (key,)).fetchone()
            if state and state["blocked_until"] > now:
                raise HTTPException(429, "尝试次数过多，请十分钟后重试。")
            valid = user is not None and _check_password(info["password"], user)
            if not valid:
                if state and now - state["first_failure"] < _BLOCK_SECONDS:
                    count, first = state["failures"] + 1, state["first_failure"]
                else:
                    count, first = 1, now
                blocked_until = now + _BLOCK_SECONDS if count >= _LIMIT else 0
                db.execute("""INSERT INTO app_auth_attempts(key,failures,first_failure,blocked_until)
                    VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET
                    failures=excluded.failures, first_failure=excluded.first_failure, blocked_until=excluded.blocked_until""",
                    (key, count, first, blocked_until))
                db.commit()
                raise HTTPException(401, "用户名或密码错误。")
            db.execute("DELETE FROM app_auth_attempts WHERE key=?", (key,))
            db.execute("DELETE FROM app_auth_sessions WHERE expires_at<=?", (now,))
            token, digest = _session_token()
            db.execute("INSERT INTO app_auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                       (digest, user["id"], now, now + TOKEN_LIFETIME_SECONDS))
            db.commit()
            response = JSONResponse(_response_user(user))
            _set_cookie(response, token, request)
            return response
    except (sqlite3.Error, RuntimeError):
        raise HTTPException(503, "账号数据库暂时不可用。")


@_ROUTER.post("/change-password")
async def change_password(request: Request):
    try:
        info = _payload(await request.json(), ("current_password", "new_password"))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "请求格式不正确。")
    fresh = info["new_password"]
    if len(fresh) < 12 or len(fresh.encode("utf-8")) > 128 or fresh.lower() in ("aslan", "password1234"):
        raise HTTPException(422, "新密码需至少 12 位且不能继续使用简单密码。")
    now = int(time.time())
    try:
        with _connect() as db:
            user = _session(db, request.cookies.get(COOKIE))
            if not user:
                raise HTTPException(401, "请先登录。")
            if not _check_password(info["current_password"], user):
                raise HTTPException(401, "原密码错误。")
            if _check_password(fresh, user):
                raise HTTPException(422, "新密码不能与旧密码相同。")
            salt = base64.b64encode(os.urandom(16)).decode("ascii")
            password_hash = _hash_password(fresh, salt)
            db.execute("""UPDATE app_users SET password_hash=?, password_salt=?, password_scheme=?, must_change_password=0
                WHERE id=?""", (password_hash, salt, SCHEME, user["id"]))
            db.execute("DELETE FROM app_auth_sessions WHERE user_id=?", (user["id"],))
            token, digest = _session_token()
            db.execute("INSERT INTO app_auth_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)",
                       (digest, user["id"], now, now + TOKEN_LIFETIME_SECONDS))
            db.commit()
            response = JSONResponse({"username": user["username"], "must_change_password": False, "registration_enabled": True})
            _set_cookie(response, token, request)
            return response
    except (sqlite3.Error, RuntimeError):
        raise HTTPException(503, "账号数据库暂时不可用。")


@_ROUTER.post("/logout")
def logout(request: Request):
    try:
        with _connect() as db:
            _revoke(db, request.cookies.get(COOKIE))
            db.commit()
    except (sqlite3.Error, RuntimeError):
        raise HTTPException(503, "账号数据库暂时不可用。")
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return response



def require_owner_id(request: Request) -> str:
    """Resolve ownership from the server session; never accept a client user_id."""
    try:
        with _connect() as db:
            row = _session(db, request.cookies.get(COOKIE))
            if row is None:
                raise HTTPException(401, "请先登录。")
            if row["must_change_password"]:
                raise HTTPException(403, "请先完成首次密码设置。")
            return str(row["id"])
    except (RuntimeError, sqlite3.Error):
        raise HTTPException(503, "用户数据暂不可用。")


def _get_profile(db: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = db.execute("""SELECT u.username, u.id, p.display_name, p.email
        FROM app_users u JOIN app_user_profiles p ON p.user_id=u.id
        WHERE u.id=?""", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(503, "个人资料尚未初始化，请检查账户数据库并联系项目维护者。")
    return {"user_id": row["id"], "username": row["username"],
            "display_name": row["display_name"], "email": row["email"],
            "email_verified": False}


@_ROUTER.get("/profile")
def get_profile(request: Request):
    user_id = require_owner_id(request)
    with _connect() as db:
        return _get_profile(db, user_id)


@_ROUTER.patch("/profile")
async def patch_profile(request: Request):
    user_id = require_owner_id(request)
    try:
        data = await request.json()
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "请求格式不正确。")
    if not isinstance(data, dict) or not data or set(data) - {"display_name", "email"}:
        raise HTTPException(422, "只允许修改昵称与联系邮箱。")
    updates = {}
    if "display_name" in data:
        value = data["display_name"]
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80:
            raise HTTPException(422, "昵称必须是 1 到 80 个字符。")
        updates["display_name"] = value.strip()
    if "email" in data:
        value = data["email"]
        if not isinstance(value, str) or len(value) > 254 or any(x in value for x in ('\r','\n','\x00')):
            raise HTTPException(422, "联系邮箱内容不正确。")
        # Test mode: no email verification and no proof-of-ownership requirement.
        updates["email"] = value.strip()
    with _connect() as db:
        db.execute("UPDATE app_user_profiles SET " + ", ".join(f"{k}=?" for k in updates)
                   + ", updated_at=? WHERE user_id=?",
                   (*updates.values(), int(time.time()), user_id))
        return _get_profile(db, user_id)


@_ROUTER.post("/profile/password")
async def set_profile_password(request: Request):
    """Local test mode: authenticated session required, no old-password check or OTP."""
    user_id = require_owner_id(request)
    try:
        data = await request.json()
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "请求格式不正确。")
    if not isinstance(data, dict) or set(data) != {"new_password"}:
        raise HTTPException(422, "请提供 new_password。")
    password = data["new_password"]
    # Minimal data-shape validation is retained; there is no complexity or length policy.
    if not isinstance(password, str) or not password or len(password.encode('utf-8')) > 256:
        raise HTTPException(422, "新密码不能为空且不能超过 256 字节。")
    salt = base64.b64encode(os.urandom(16)).decode('ascii')
    hashed = _hash_password(password, salt)
    now = int(time.time())
    with _connect() as db:
        db.execute("UPDATE app_users SET password_hash=?, password_salt=?, password_scheme=?, must_change_password=0 WHERE id=?",
                   (hashed, salt, SCHEME, user_id))
        db.execute("DELETE FROM app_auth_sessions WHERE user_id=?", (user_id,))
        token, digest = _session_token()
        db.execute("INSERT INTO app_auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                   (digest, user_id, now, now + TOKEN_LIFETIME_SECONDS))
        response = JSONResponse({"ok": True, "message": "密码已更新，其他登录会话已退出。"})
        _set_cookie(response, token, request)
        return response


def install_auth(app):
    if getattr(app.state, "stage8b_auth_installed", False):
        return
    app.include_router(_ROUTER)
    app.add_middleware(_AuthBarrier)
    app.state.stage8b_auth_installed = True
