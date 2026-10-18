"""Stage 8C1 offline SQLite owner-scoping migration, snapshot and rollback.

No user registration: existing session/reports/material routes are not yet scoped.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def resolve(root: Path) -> tuple[Path, Path, Path]:
    root = root.resolve()
    if not (root / 'backend/app/main.py').is_file() or not (root / 'frontend/package.json').is_file():
        raise RuntimeError('Invalid project root')
    config = {}
    env = root / '.env'
    if env.is_file():
        for line in env.read_text('utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                config[k.strip()] = v.strip().strip("\"'")
    def path(key, default):
        raw = Path(os.environ.get(key, config.get(key, default))).expanduser()
        result = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
        if not result.is_relative_to((root / 'storage').resolve()) or result.is_symlink():
            raise RuntimeError(f'Unsafe {key} path')
        return result
    main = path('SQLITE_PATH', 'storage/data/interview.db')
    study = path('STUDY_SQLITE_PATH', 'storage/data/study_review.db')
    if main == study or not main.is_file():
        raise RuntimeError('Missing main SQLite file or duplicate storage path')
    return root, main, study


def connect(path: Path):
    conn = sqlite3.connect(path, timeout=20)
    conn.execute('PRAGMA busy_timeout=20000')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def table_exists(db: sqlite3.Connection, name: str) -> bool:
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def columns(db, table):
    return {r[1] for r in db.execute('PRAGMA table_info("' + table + '")')}


def owner_id(db):
    users = db.execute('SELECT id,username FROM app_users').fetchall()
    if len(users) != 1 or users[0][1].lower() != 'aslan':
        raise RuntimeError('Single aslan owner required; additional accounts remain disabled')
    return users[0][0]


def preflight(main: Path, study: Path):
    with connect(main) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Main SQLite integrity check failed')
        required = ['app_users', 'app_auth_sessions', 'app_legacy_ownership', 'app_vector_ownership']
        for name in required:
            if not table_exists(db, name):
                raise RuntimeError(f'Stage 8A/8B prerequisite missing: {name}')
        owner_id(db)
        if table_exists(db, 'app_user_profiles'):
            raise RuntimeError('Stage 8C profile table exists: refusing repeated upgrade')
    if study.is_file():
        with connect(study) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Study SQLite integrity check failed')
            if table_exists(db, 'study_knowledge_points') and 'user_id' in columns(db, 'study_knowledge_points'):
                raise RuntimeError('Study user_id already exists: refusing repeated upgrade')


def snapshot(main: Path, study: Path, folder: Path):
    if folder.exists():
        raise RuntimeError('Backup destination already exists')
    folder.mkdir(parents=True)
    info = {'stage': '8C1', 'main_original': str(main), 'study_original': str(study), 'study_existed': study.is_file()}
    for orig, stem in ((main, 'main'), (study, 'study')):
        if not orig.is_file():
            continue
        with connect(orig) as src, sqlite3.connect(folder / (stem + '.sqlite3')) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError(f'Invalid snapshot for {stem}')
    (folder / 'database_snapshot.json').write_text(json.dumps(info, indent=2), encoding='utf-8')


def apply(main: Path, study: Path):
    preflight(main, study)
    with connect(main) as db:
        owner = owner_id(db)
        db.execute('BEGIN IMMEDIATE')
        db.execute('''CREATE TABLE app_user_profiles (
            user_id TEXT PRIMARY KEY REFERENCES app_users(id),
            display_name TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL
        )''')
        db.execute('INSERT INTO app_user_profiles(user_id,display_name,email,updated_at) VALUES(?,?,?,?)',
                   (owner, 'aslan', '', int(datetime.now(timezone.utc).timestamp())))
        db.commit()
    study.parent.mkdir(parents=True, exist_ok=True)
    with connect(study) as db:
        # Reuse the Stage 7 study table schema if this DB has never been opened.
        db.execute('''CREATE TABLE IF NOT EXISTS study_knowledge_points (
            id TEXT PRIMARY KEY, session_id TEXT, material_id TEXT,
            source_name TEXT NOT NULL, source_anchor TEXT NOT NULL,
            source_text TEXT NOT NULL, quote TEXT NOT NULL, title TEXT NOT NULL,
            dimension TEXT NOT NULL, orientation TEXT NOT NULL,
            severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
            important INTEGER NOT NULL CHECK (important IN (0,1)),
            status TEXT NOT NULL CHECK (status IN ('pending','mastered','disputed')),
            note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )''')
        db.execute('ALTER TABLE study_knowledge_points ADD COLUMN user_id TEXT')
        db.execute('UPDATE study_knowledge_points SET user_id=?', (owner,))
        db.execute('CREATE INDEX ix_study_owner_updated ON study_knowledge_points(user_id,updated_at)')
        db.execute('''CREATE TRIGGER study_user_required_insert
            BEFORE INSERT ON study_knowledge_points WHEN NEW.user_id IS NULL OR NEW.user_id = ''
            BEGIN SELECT RAISE(ABORT,'user_id required'); END''')
        db.execute('''CREATE TRIGGER study_user_required_update
            BEFORE UPDATE OF user_id ON study_knowledge_points WHEN NEW.user_id IS NULL OR NEW.user_id = ''
            BEGIN SELECT RAISE(ABORT,'user_id required'); END''')
        db.commit()


def verify(main: Path, study: Path):
    with connect(main) as db:
        owner = owner_id(db)
        if not table_exists(db,'app_user_profiles') or db.execute('SELECT COUNT(*) FROM app_user_profiles WHERE user_id=?', (owner,)).fetchone()[0] != 1:
            raise RuntimeError('Missing profile owner')
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Main SQLite integrity check failed')
    with connect(study) as db:
        if 'user_id' not in columns(db, 'study_knowledge_points'):
            raise RuntimeError('Knowledge ownership column missing')
        if db.execute('SELECT COUNT(*) FROM study_knowledge_points WHERE user_id IS NULL OR user_id!=?', (owner,)).fetchone()[0]:
            raise RuntimeError('Unowned or unexpected knowledge points')
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Review SQLite integrity check failed')
    print('[Stage 8C1] VERIFIED: profile and aslan-owned knowledge records; no registration enabled.')


def restore(main: Path, study: Path, folder: Path, preserve: Path):
    info = json.loads((folder / 'database_snapshot.json').read_text('utf-8'))
    if info['stage'] != '8C1' or info['main_original'] != str(main) or info['study_original'] != str(study):
        raise RuntimeError('Backup does not match this project')
    if preserve.exists():
        raise RuntimeError('Pre-restore preservation destination already exists')
    # Always keep latest data separate first.
    preserve.mkdir(parents=True)
    for current, stem in ((main,'main'),(study,'study')):
        if current.is_file():
            with connect(current) as src, sqlite3.connect(preserve / (stem + '.sqlite3')) as dst:
                src.backup(dst)
    for target, stem, existed in ((main,'main',True),(study,'study',info['study_existed'])):
        if not existed:
            if target.exists():
                target.unlink()
            continue
        source = folder / (stem + '.sqlite3')
        if not source.is_file():
            raise RuntimeError('Snapshot not found: ' + stem)
        with sqlite3.connect(source) as src:
            if src.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Snapshot corrupted: ' + stem)
            with connect(target) as dest:
                src.backup(dest)
    print('[Stage 8C1] DATABASE RESTORED. Current data preserved at: ' + str(preserve))


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--project-root', required=True)
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument('--preflight',action='store_true')
    g.add_argument('--snapshot')
    g.add_argument('--apply',action='store_true')
    g.add_argument('--verify',action='store_true')
    g.add_argument('--restore')
    p.add_argument('--preserve')
    args=p.parse_args()
    _,main_db,study_db=resolve(Path(args.project_root))
    if args.preflight:
        preflight(main_db,study_db)
    elif args.snapshot:
        preflight(main_db,study_db)
        snapshot(main_db,study_db,Path(args.snapshot).resolve())
    elif args.apply:
        apply(main_db,study_db)
    elif args.verify:
        verify(main_db,study_db)
    else:
        if not args.preserve: raise RuntimeError('--preserve is required to restore')
        restore(main_db,study_db,Path(args.restore).resolve(),Path(args.preserve).resolve())

if __name__=='__main__':
    main()
