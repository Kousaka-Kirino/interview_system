"""Stage 13: safe, idempotent SQLite authentication bootstrap for fresh local installs.

The SQL definitions here match the Stage 8A/8B/8C tables consumed by stage8b_auth.
NO default user is created. Historical data with missing ownership metadata is NEVER
silently assigned to a newly registered account.
"""
from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

AUTH_DDL = (
    """CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_scheme TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS app_auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS app_auth_attempts (
        key TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        first_failure INTEGER NOT NULL,
        blocked_until INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS app_user_profiles (
        user_id TEXT PRIMARY KEY REFERENCES app_users(id),
        display_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS ix_auth_user ON app_auth_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_auth_expiry ON app_auth_sessions(expires_at)",
)

REQUIRED = {
    "app_users": {"id", "username", "password_hash", "password_salt", "password_scheme",
                  "must_change_password", "is_active", "created_at"},
    "app_auth_sessions": {"token_hash", "user_id", "created_at", "expires_at"},
    "app_auth_attempts": {"key", "failures", "first_failure", "blocked_until"},
    "app_user_profiles": {"user_id", "display_name", "email", "updated_at"},
}


def _tables(db: sqlite3.Connection) -> set[str]:
    return {item[0] for item in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )}


def _columns(db: sqlite3.Connection, name: str) -> set[str]:
    # The identifier is from the fixed REQUIRED mapping, not user input.
    return {item[1] for item in db.execute(f'PRAGMA table_info("{name}")')}


def _validate_existing(db: sqlite3.Connection, present: set[str]) -> None:
    if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise RuntimeError('SQLite quick_check failed. Restore a known-good backup before continuing.')
    for table in set(REQUIRED) & present:
        missing = REQUIRED[table] - _columns(db, table)
        if missing:
            raise RuntimeError(f'Existing {table} schema is incompatible; missing: {sorted(missing)}')
    if 'app_users' not in present:
        # No owner identity exists. Do not claim existing nonempty business records.
        for name in present:
            safe = '"' + name.replace('"', '""') + '"'
            if db.execute(f'SELECT 1 FROM {safe} LIMIT 1').fetchone():
                raise RuntimeError(
                    f'Found existing rows in {name} without app_users. '
                    'This is a legacy database; use reviewed Stage 8A/8B/8C migration, '
                    'not an automatic fresh-install bootstrap.'
                )
    else:
        users = db.execute('SELECT id, username FROM app_users').fetchall()
        if not users:
            # Partially migrated legacy databases can have an empty users table
            # alongside nonempty original resumes. Do not silently accept that.
            for name in present - set(REQUIRED):
                safe = '"' + name.replace('"', '""') + '"'
                if db.execute(f'SELECT 1 FROM {safe} LIMIT 1').fetchone():
                    raise RuntimeError(
                        f'Nonempty legacy table {name} without any owner account. '
                        'Review Stage 8 ownership migration before allowing signup.'
                    )
        if any(row[1].lower() == 'aslan' for row in users):
            # The original owner's data must retain the Stage 8C2 ownership ledger.
            if 'app_stage8c2_meta' not in present:
                raise RuntimeError(
                    "Legacy account 'aslan' is present but Stage 8C2 ownership metadata "
                    'is missing. Refusing an unsafe partial migration.'
                )
            meta = dict(db.execute('SELECT name, value FROM app_stage8c2_meta'))
            owner = next(row[0] for row in users if row[1].lower() == 'aslan')
            if meta.get('owner_user_id') != owner or meta.get('multiuser_enabled') != '0':
                raise RuntimeError('Stage 8C2 ownership metadata does not match legacy aslan account.')
        if 'app_stage8c2_meta' in present and not any(row[1].lower() == 'aslan' for row in users):
            raise RuntimeError('Stage 8C2 owner metadata exists but the legacy owner is missing.')
        if 'app_auth_sessions' in present:
            # There must be no orphaned session rows.
            if db.execute('''SELECT 1 FROM app_auth_sessions s
                LEFT JOIN app_users u ON s.user_id=u.id WHERE u.id IS NULL LIMIT 1''').fetchone():
                raise RuntimeError('Orphaned authentication sessions found. Refusing automatic repair.')


def _snapshot(db_path: Path) -> Path:
    """Make an atomic consistent SQLite backup before changing an existing schema."""
    target_dir = db_path.parents[1] / 'backups'
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / (
        'stage13_auth_before_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        + '_' + uuid4().hex[:8] + '.sqlite3'
    )
    tmp = target.with_suffix('.tmp')
    try:
        with closing(sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True, timeout=15)) as src:
            with closing(sqlite3.connect(tmp)) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Stage 13 backup integrity failed.')
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)
    print(f'[Stage 13] Existing SQLite backup: {target}', flush=True)
    return target


def bootstrap_auth_schema(db_path: Path) -> dict[str, object]:
    """Create missing auth tables only if data can be attributed safely.

    Intended to run before SQLAlchemy's business-table create_all during lifespan.
    Existing data remains untouched except filling missing profile rows for known users.
    """
    path = db_path.resolve()
    if db_path.is_symlink():
        raise RuntimeError('Refusing a symlinked account database.')
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.is_file()
    if path.exists() and not path.is_file():
        raise RuntimeError('SQLite target exists but is not a file.')

    # Audit under read access first. Never create missing tables in an incompatible DB.
    if existed:
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=15)) as probe:
            present = _tables(probe)
            _validate_existing(probe, present)
            changes_needed = bool(set(REQUIRED) - present) or (
                'app_user_profiles' in present and
                bool(probe.execute('''SELECT 1 FROM app_users u
                    LEFT JOIN app_user_profiles p ON p.user_id=u.id
                    WHERE p.user_id IS NULL LIMIT 1''').fetchone())
            )
        if changes_needed:
            _snapshot(path)
        else:
            return {'created': False, 'changed': False, 'path': str(path)}

    try:
        with closing(sqlite3.connect(path, timeout=20)) as db:
            db.execute('PRAGMA busy_timeout=20000')
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('BEGIN IMMEDIATE')
            present = _tables(db)
            _validate_existing(db, present)
            for statement in AUTH_DDL:
                db.execute(statement)
            # Keep existing users and hashes unchanged; reconstruct only absent profile rows.
            db.execute('''INSERT INTO app_user_profiles(user_id, display_name, email, updated_at)
                SELECT u.id, u.username, '', CAST(strftime('%s','now') AS INTEGER)
                FROM app_users u LEFT JOIN app_user_profiles p ON p.user_id=u.id
                WHERE p.user_id IS NULL''')
            for table, required in REQUIRED.items():
                missing = required - _columns(db, table)
                if missing:
                    raise RuntimeError(f'Created auth schema incomplete: {table}, {sorted(missing)}')
            if db.execute('PRAGMA foreign_key_check').fetchone():
                raise RuntimeError('SQLite foreign_key_check failed during auth initialization.')
            db.commit()
        print('[Stage 13] Local authentication tables ready. No default account created.', flush=True)
        return {'created': not existed, 'changed': True, 'path': str(path)}
    except Exception:
        # SQLite transaction rolls back. Do not unlink even a brand-new DB:
        # another uvicorn worker could have opened it in the meantime.
        raise


def preflight_account_database(db_path: Path) -> str:
    """Read-only check for use by the installer. Never creates a database."""
    if db_path.is_symlink():
        raise RuntimeError('Refusing a symlinked SQLite account database.')
    if not db_path.exists():
        return 'fresh: database not created yet'
    if not db_path.is_file():
        raise RuntimeError('Account database target is not a regular file.')
    with closing(sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True, timeout=15)) as db:
        present = _tables(db)
        _validate_existing(db, present)
        return f'compatible: {len(present)} existing tables; {int(db.execute("SELECT COUNT(*) FROM app_users").fetchone()[0]) if "app_users" in present else 0} users'


def initialize_account_database() -> None:
    """Called by FastAPI lifespan before SQLAlchemy creates business tables."""
    from app.core.config import get_settings, PROJECT_ROOT
    from app.stage8b_auth import _database_path

    db_path = _database_path()
    expected = get_settings().sqlite_file.resolve()
    if db_path != expected:
        raise RuntimeError('Auth/SQLAlchemy SQLITE_PATH disagreement; refuse two different databases.')
    storage = (PROJECT_ROOT / 'storage').resolve()
    if not db_path.is_relative_to(storage):
        raise RuntimeError('Local auth DB must be located inside project storage/.')
    current = db_path.parent
    while current != storage.parent:
        if current.is_symlink():
            raise RuntimeError('Refusing symlinked storage directory.')
        if current == storage:
            break
        current = current.parent
    bootstrap_auth_schema(db_path)
