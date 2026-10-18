"""Offline auth-session schema upgrade and integrity verification for Stage 8B."""
from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path


def paths(root: Path) -> tuple[Path, Path]:
    root = root.expanduser().resolve()
    if not (root / 'backend/app/main.py').is_file() or not (root / 'frontend/package.json').is_file():
        raise RuntimeError('Invalid project root.')
    value = 'storage/data/interview.db'
    env = root / '.env'
    if env.is_file():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value_candidate = line.split('=', 1)
                if key.strip() == 'SQLITE_PATH':
                    value = value_candidate.strip().strip('"\'')
    raw = Path(os.environ.get('SQLITE_PATH', value)).expanduser()
    target = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
    if not target.is_relative_to((root / 'storage').resolve()):
        raise RuntimeError('Database path must be under project storage/.')
    if not target.is_file() or target.is_symlink():
        raise RuntimeError('Stage 8A SQLite database is missing or a symlink.')
    return root, target


def open_rw(db: Path) -> sqlite3.Connection:
    c = sqlite3.connect(db.as_uri() + '?mode=rw', uri=True, timeout=15)
    c.execute('PRAGMA busy_timeout=15000')
    return c


def preflight(db: Path) -> None:
    with open_rw(db) as c:
        if c.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite integrity check failed.')
        tables = {x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for name in ('app_users', 'app_legacy_datasets', 'app_legacy_ownership', 'app_stage8a_meta'):
            if name not in tables:
                raise RuntimeError(f'Stage 8A prerequisite is missing: {name}.')
        users = c.execute('SELECT username, password_scheme FROM app_users').fetchall()
        if users != [('aslan', 'scrypt-n32768-r8-p1')]:
            raise RuntimeError('Exactly one aslan user with Stage 8A scrypt hash is required; migration stopped.')
        if 'app_auth_sessions' in tables or 'app_auth_attempts' in tables:
            raise RuntimeError('Auth schema already exists; Stage 8B upgrade is not repeatable.')


def snapshot(db: Path, dest: Path) -> None:
    if dest.exists():
        raise RuntimeError('Snapshot already exists; refusing overwrite.')
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open_rw(db) as source, sqlite3.connect(dest) as copy:
        source.backup(copy)
        if copy.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup database integrity check failed.')


def restore_from_snapshot(db: Path, saved: Path, preserve: Path) -> None:
    if not saved.is_file():
        raise RuntimeError('Valid snapshot file missing.')
    if preserve.exists():
        raise RuntimeError('A pre-restore database copy already exists; refusing to overwrite.')
    with sqlite3.connect(saved) as source:
        if source.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Snapshot integrity check failed; no database changes.')
    # Save the current state first. Never discard sessions or post-install edits silently.
    snapshot(db, preserve)
    with sqlite3.connect(saved) as source, open_rw(db) as target:
        source.backup(target)
    with open_rw(db) as current:
        if current.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Database restore integrity check failed; pre-restore copy preserved.')


def apply(db: Path) -> None:
    preflight(db)
    with open_rw(db) as conn:
        conn.execute('BEGIN IMMEDIATE')
        try:
            conn.execute('''CREATE TABLE app_auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES app_users(id),
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )''')
            conn.execute('CREATE INDEX ix_auth_user ON app_auth_sessions(user_id)')
            conn.execute('CREATE INDEX ix_auth_expiry ON app_auth_sessions(expires_at)')
            conn.execute('''CREATE TABLE app_auth_attempts (
                key TEXT PRIMARY KEY,
                failures INTEGER NOT NULL,
                first_failure INTEGER NOT NULL,
                blocked_until INTEGER NOT NULL
            )''')
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def verify(db: Path) -> None:
    with open_rw(db) as c:
        if c.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('SQLite integrity check failed.')
        tables = {x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for item in ('app_auth_sessions', 'app_auth_attempts'):
            if item not in tables:
                raise RuntimeError(f'Auth table missing: {item}')
        if c.execute('SELECT COUNT(*) FROM app_users').fetchone()[0] != 1:
            raise RuntimeError('Multiple users detected; registration must remain disabled.')
        row = c.execute('SELECT username FROM app_users').fetchone()
        if row is None or row[0] != 'aslan':
            raise RuntimeError('Initial owner mismatch.')
        if c.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('SQLite foreign key errors found.')
        print('[Stage 8B] VERIFIED: auth sessions + rate limiter, aslan-only.')


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--project-root', required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--preflight', action='store_true')
    g.add_argument('--snapshot')
    g.add_argument('--apply', action='store_true')
    g.add_argument('--verify', action='store_true')
    g.add_argument('--database-path', action='store_true')
    g.add_argument('--restore-snapshot')
    p.add_argument('--preserve-as')
    args = p.parse_args()
    _, db = paths(Path(args.project_root))
    if args.database_path:
        print(db)
    elif args.preflight:
        preflight(db)
        print('[Stage 8B] Stage 8A account verified; ready for backup.')
    elif args.restore_snapshot:
        if not args.preserve_as:
            raise RuntimeError('Missing --preserve-as for safe restore.')
        restore_from_snapshot(db, Path(args.restore_snapshot).resolve(), Path(args.preserve_as).resolve())
        print('[Stage 8B] SQLite backup snapshot restored; newer database state preserved separately.')
    elif args.snapshot:
        preflight(db)
        snapshot(db, Path(args.snapshot).resolve())
        print('[Stage 8B] SQLite snapshot created and checked.')
    elif args.apply:
        apply(db)
        print('[Stage 8B] Database auth schema installed.')
    else:
        verify(db)


if __name__ == '__main__':
    main()
