"""Stage 11: local, per-account storage paths. The legacy aslan workspace is unchanged.

Only the authentication database is shared. Other user data lives under
storage/users/<UUID>/, with a different SQLite DB, uploads and Chroma store.
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import Request

from app.core.config import get_settings, Settings, PROJECT_ROOT
from app.stage8b_auth import _connect, require_owner_id


def is_legacy_owner(user_id: str) -> bool:
    with _connect() as db:
        legacy = db.execute(
            "SELECT id FROM app_users WHERE username='aslan' COLLATE NOCASE LIMIT 1"
        ).fetchone()
        if legacy is None:
            raise RuntimeError("Initial local owner missing")
        return str(legacy["id"]) == str(user_id)


def user_root(user_id: str) -> Path:
    # Do not allow arbitrary path components from a database row.
    try:
        value = str(UUID(user_id))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Invalid local account identifier") from exc
    if value != user_id.lower():
        raise RuntimeError("Noncanonical local account identifier")
    root = (PROJECT_ROOT / "storage" / "users").resolve()
    return root / value


def account_settings(user_id: str) -> Settings:
    base = get_settings()
    if is_legacy_owner(user_id):
        return base
    user = user_root(user_id)
    return base.model_copy(
        update={
            "sqlite_path": str(user / "interview.db"),
            "chroma_path": str(user / "chroma"),
            "upload_path": str(user / "uploads"),
        }
    )


def get_user_settings(request: Request) -> Settings:
    return account_settings(require_owner_id(request))
