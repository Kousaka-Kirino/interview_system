"""Stage 8A offline migration: bootstrap one owner + legacy ownership inventory.

This tool is *not* an authentication middleware or user isolation boundary.
It does not modify existing business schemas, RAG collections, or upload paths.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

STAGE = '8A'
USERNAME = 'aslan'
OWNERSHIP_TABLES = ('app_users', 'app_legacy_ownership', 'app_legacy_datasets',
                    'app_file_ownership', 'app_vector_ownership', 'app_stage8a_meta')
SCHEME = 'scrypt-n32768-r8-p1'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def enc(value):
    return base64.b64encode(value).decode('ascii')


def hash_password(password: str, salt: bytes | None = None):
    if not password:
        raise ValueError('A password must be supplied via the local secure prompt.')
    salt = salt or os.urandom(16)
    hashed = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=32768, r=8, p=1,
                            dklen=32, maxmem=64 * 1024 * 1024)
    return enc(hashed), enc(salt)


def _q(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def resolve_project(root: str) -> Path:
    p = Path(root).expanduser().resolve()
    if not (p / 'backend' / 'app' / 'main.py').is_file():
        raise RuntimeError('Missing backend/app/main.py; project root appears incorrect.')
    if not (p / 'frontend' / 'package.json').is_file():
        raise RuntimeError('Missing frontend/package.json; project root appears incorrect.')
    return p


def project_paths(root: Path):
    settings = {}
    env = root / '.env'
    if env.is_file():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            settings[key.strip()] = value.strip().strip('"\'')
    values = {
        'interview': settings.get('SQLITE_PATH', 'storage/data/interview.db'),
        'review': settings.get('STUDY_SQLITE_PATH', 'storage/data/study_review.db'),
        'chroma': settings.get('CHROMA_PATH', 'storage/chroma'),
        'uploads': settings.get('UPLOAD_PATH', 'storage/uploads'),
    }
    storage = (root / 'storage').resolve()
    resolved = {}
    for key, value in values.items():
        p = Path(value).expanduser()
        p = p.resolve() if p.is_absolute() else (root / p).resolve()
        if not p.is_relative_to(storage):
            raise RuntimeError(f'{key} path is outside project storage/; cannot safely back up: {p}')
        resolved[key] = p
    if resolved['review'] == resolved['interview']:
        raise RuntimeError('Main SQLite and review SQLite must be different files.')
    existing_dbs = set((storage / 'data').glob('*.db')) if (storage / 'data').is_dir() else set()
    unknown_dbs = [p.name for p in existing_dbs if p.resolve() not in (resolved['interview'], resolved['review'])]
    if unknown_dbs:
        raise RuntimeError('Unrecognized SQLite databases require an explicit ownership plan: ' + ', '.join(sorted(unknown_dbs)))
    if not resolved['interview'].is_file():
        raise RuntimeError(f'Original SQLite file not found: {resolved["interview"]}')
    return storage, resolved


def ensure_no_symlinks(folder: Path):
    if folder.is_symlink():
        raise RuntimeError(f'Symlink found in storage: {folder}')
    if not folder.exists():
        return
    for base, directories, files in os.walk(folder, followlinks=False):
        for child in directories + files:
            candidate = Path(base) / child
            if candidate.is_symlink():
                raise RuntimeError(f'Symlink found in storage: {candidate}')


def sqlite_connect(path: Path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=rw', uri=True, timeout=15)


def check_integrity(path: Path):
    if not path.is_file():
        return
    with sqlite_connect(path) as db:
        line = db.execute('PRAGMA quick_check').fetchone()
    if not line or line[0] != 'ok':
        raise RuntimeError(f'SQLite quick_check failed: {path}: {line}')


def preflight(root: Path):
    storage, targets = project_paths(root)
    ensure_no_symlinks(storage)
    for key in ('interview', 'review'):
        check_integrity(targets[key])
    with sqlite_connect(targets['interview']) as db:
        present = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'app_users' in present:
            users = db.execute('SELECT id, username FROM app_users').fetchall()
            if users:
                raise RuntimeError('Auth users already exist; Stage 8A refuses to overwrite them or rerun.')
    return storage, targets


def backup(root: Path, backup_dir: Path):
    storage, paths = preflight(root)
    if backup_dir.exists():
        raise RuntimeError('Backup destination already exists; refusing to overwrite.')
    required = sum(f.stat().st_size for f in storage.rglob('*') if f.is_file())
    parent = backup_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    available = shutil.disk_usage(parent).free
    if available < required + 100 * 1024 * 1024:
        raise RuntimeError('Not enough free space for a complete storage backup.')
    print(f'[Stage 8A] Original storage backup: {required / 1024 / 1024:.1f} MiB', flush=True)
    backup_dir.mkdir(parents=True)
    marker = {
        'stage': STAGE, 'project': str(root), 'created_at': now(), 'complete': False,
        'storage_existed': storage.is_dir(),
        'docs': [], 'scripts': []
    }
    try:
        if storage.exists():
            shutil.copytree(storage, backup_dir / 'storage')
        for name in ('PROJECT_GUIDE.md', 'API_DOCUMENTATION.md'):
            src = root / name
            existed = src.is_file()
            marker['docs'].append({'name': name, 'existed': existed})
            if existed:
                shutil.copy2(src, backup_dir / name)
        for name in ('scripts/stage8a_migrate.py',):
            src = root / name
            existed = src.is_file()
            marker['scripts'].append({'name': name, 'existed': existed})
            if existed:
                dest = backup_dir / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
        # Validate the backup's two SQLite files, without writing to their copies.
        if paths['interview'].is_file():
            rel = paths['interview'].relative_to(storage)
            check_integrity(backup_dir / 'storage' / rel)
        if paths['review'].is_file():
            rel = paths['review'].relative_to(storage)
            check_integrity(backup_dir / 'storage' / rel)
        marker['complete'] = True
        (backup_dir / 'stage8a_backup_manifest.json').write_text(
            json.dumps(marker, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'[Stage 8A] Backup completed: {backup_dir}', flush=True)
    except Exception:
        # Keep incomplete snapshots to aid diagnosis; manifest prevents restoring from them.
        (backup_dir / 'INCOMPLETE_BACKUP.txt').write_text('Do not use for restore.', encoding='ascii')
        raise


def key_for_row(cols, row, index):
    if cols:
        return 'pk:' + json.dumps(list(row), ensure_ascii=False, default=str, separators=(',', ':'))
    return 'rowid:' + str(row[0]) if row else f'unknown:{index}'


def row_ownership_scan(db: sqlite3.Connection, dbtag: str, owner: str, output: sqlite3.Connection):
    tables = [x[0] for x in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
              if not x[0].startswith('sqlite_') and x[0] not in OWNERSHIP_TABLES]
    summary = []
    for table in tables:
        column_info = db.execute('PRAGMA table_info(' + _q(table) + ')').fetchall()
        pk = [item[1] for item in sorted((item for item in column_info if item[5]), key=lambda x: x[5])]
        count = int(db.execute('SELECT COUNT(*) FROM ' + _q(table)).fetchone()[0])
        stable = bool(pk)
        output.execute('''INSERT INTO app_legacy_datasets
            (database_name, table_name, owner_user_id, row_count_at_migration, stable_keys)
            VALUES (?,?,?,?,?)''', (dbtag, table, owner, count, int(stable)))
        if count:
            if pk:
                query = 'SELECT ' + ', '.join(_q(col) for col in pk) + ' FROM ' + _q(table)
            else:
                query = 'SELECT rowid FROM ' + _q(table)
            try:
                stream = db.execute(query)
            except sqlite3.OperationalError:
                if not pk:
                    raise RuntimeError(f'Legacy table without PK/rowid requires manual mapping: {dbtag}.{table}')
                raise
            rows = ((dbtag, table, key_for_row(pk, r, n), owner) for n, r in enumerate(stream))
            output.executemany('''INSERT INTO app_legacy_ownership
                (database_name, table_name, record_key, owner_user_id) VALUES (?,?,?,?)''', rows)
        summary.append({'database': dbtag, 'table': table, 'rows': count, 'key_stable': stable})
    return summary


def sha256_file(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def create_tables(db: sqlite3.Connection):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_scheme TEXT NOT NULL,
          must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_legacy_datasets (
          database_name TEXT NOT NULL,
          table_name TEXT NOT NULL,
          owner_user_id TEXT NOT NULL REFERENCES app_users(id),
          row_count_at_migration INTEGER NOT NULL,
          stable_keys INTEGER NOT NULL,
          PRIMARY KEY(database_name, table_name)
        );
        CREATE TABLE IF NOT EXISTS app_legacy_ownership (
          database_name TEXT NOT NULL,
          table_name TEXT NOT NULL,
          record_key TEXT NOT NULL,
          owner_user_id TEXT NOT NULL REFERENCES app_users(id),
          PRIMARY KEY(database_name, table_name, record_key)
        );
        CREATE INDEX IF NOT EXISTS ix_app_owner ON app_legacy_ownership(owner_user_id);
        CREATE TABLE IF NOT EXISTS app_file_ownership (
          relative_path TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL REFERENCES app_users(id),
          file_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_vector_ownership (
          vector_store_path TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL REFERENCES app_users(id),
          status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_stage8a_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
    ''')


def apply(root: Path, backup_dir: Path, password: str):
    storage, paths = preflight(root)
    marker_file = backup_dir / 'stage8a_backup_manifest.json'
    if not marker_file.is_file():
        raise RuntimeError('No verified backup manifest found. Apply aborted.')
    manifest = json.loads(marker_file.read_text(encoding='utf-8'))
    if not manifest.get('complete') or manifest.get('project') != str(root):
        raise RuntimeError('Backup is incomplete or belongs to a different project.')
    hashed, salt = hash_password(password)
    owner = str(uuid.uuid4())
    summary = []
    db = sqlite_connect(paths['interview'])
    try:
        db.execute('PRAGMA busy_timeout=15000')
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        # executescript implicitly commits: only schema creation before later data transaction.
        db.execute('ROLLBACK')
        create_tables(db)
        db.execute('BEGIN IMMEDIATE')
        db.execute('''INSERT INTO app_users
            (id,username,password_hash,password_salt,password_scheme,must_change_password,is_active,created_at)
            VALUES (?,?,?,?,?,1,1,?)''', (owner, USERNAME, hashed, salt, SCHEME, now()))
        # Must scan main separately because destination inserts are happening in the same db.
        summary.extend(row_ownership_scan(db, 'interview', owner, db))
        if paths['review'].is_file():
            with sqlite_connect(paths['review']) as review:
                summary.extend(row_ownership_scan(review, 'review', owner, db))
        uploads = paths['uploads']
        files = []
        if uploads.is_dir():
            for file in sorted(uploads.rglob('*')):
                if not file.is_file():
                    continue
                rel = file.relative_to(uploads).as_posix()
                db.execute('INSERT INTO app_file_ownership VALUES (?,?,?,?)',
                           (rel, owner, file.stat().st_size, sha256_file(file)))
                files.append(rel)
        if paths['chroma'].is_dir():
            db.execute('INSERT INTO app_vector_ownership VALUES (?,?,?)',
                       (paths['chroma'].relative_to(storage).as_posix(), owner,
                        'legacy-folder-owned; user-collection-migration-pending'))
        data = {
            'stage': STAGE,
            'initial_username': USERNAME,
            'initial_user_id': owner,
            'migrated_at': now(),
            'legacy_tables': summary,
            'legacy_upload_file_count': len(files),
            'chroma_migration_pending': paths['chroma'].is_dir(),
            'login_enabled': False,
            'isolation_enforced': False,
            'password_change_required_at_first_login': True,
        }
        db.execute('INSERT INTO app_stage8a_meta(key,value) VALUES (?,?)',
                   ('stage8a_summary', json.dumps(data, ensure_ascii=False)))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    report = backup_dir / 'stage8a_migration_report.json'
    report.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print('[Stage 8A] Initial user created: aslan (must change password at first login).', flush=True)
    print(f'[Stage 8A] Legacy tables inventoried: {len(summary)}; uploaded files: {len(files)}', flush=True)
    print('[Stage 8A] Login and cross-user isolation are NOT enabled at this stage.', flush=True)
    print(f'[Stage 8A] Report: {report}', flush=True)


def verify(root: Path):
    _, paths = project_paths(root)
    with sqlite_connect(paths['interview']) as db:
        users = db.execute('SELECT id,username,must_change_password,password_scheme FROM app_users').fetchall()
        if len(users) != 1 or users[0][1] != USERNAME or users[0][2] != 1 or users[0][3] != SCHEME:
            raise RuntimeError('Initial user verification failed.')
        owner = users[0][0]
        rows = db.execute('SELECT database_name,table_name,row_count_at_migration FROM app_legacy_datasets').fetchall()
        for database_name, table_name, count in rows:
            recorded = db.execute('''SELECT COUNT(*) FROM app_legacy_ownership
                        WHERE database_name=? AND table_name=? AND owner_user_id=?''',
                                  (database_name, table_name, owner)).fetchone()[0]
            if count != recorded:
                raise RuntimeError(f'Ownership mismatch for {database_name}.{table_name}: {count} vs {recorded}')
        if not db.execute('PRAGMA quick_check').fetchone()[0] == 'ok':
            raise RuntimeError('Database integrity check failed after migration.')
        print(f'[Stage 8A] VERIFIED: user aslan, {len(rows)} legacy tables, mapped to UUID {owner}.')
        print('[Stage 8A] This is an ownership inventory, NOT an authorization layer.')


def get_password():
    first = getpass.getpass('Initial password for local user aslan (hidden): ')
    again = getpass.getpass('Confirm initial password: ')
    if first != again:
        raise RuntimeError('Passwords do not match; no account created.')
    if not first:
        raise RuntimeError('Empty password not permitted.')
    if len(first) < 12:
        print('[Stage 8A] WARNING: short initial password. First login MUST require change.', flush=True)
    return first


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-root', required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--preflight', action='store_true')
    group.add_argument('--backup-dir')
    group.add_argument('--apply-from-backup')
    group.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    root = resolve_project(args.project_root)
    if args.preflight:
        _, paths = preflight(root)
        print('[Stage 8A] PREFLIGHT OK. Primary SQLite:', paths['interview'])
    elif args.backup_dir:
        backup(root, Path(args.backup_dir).resolve())
    elif args.apply_from_backup:
        apply(root, Path(args.apply_from_backup).resolve(), get_password())
    elif args.verify:
        verify(root)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('[Stage 8A] ERROR:', exc, file=sys.stderr)
        sys.exit(1)
