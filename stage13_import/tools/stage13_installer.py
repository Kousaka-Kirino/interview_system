"""Conservative Stage 13 installer. Does not mutate business or auth databases."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

RELEASE = Path(__file__).resolve().parents[1]
FILES = RELEASE / 'patches'
MANIFEST = json.loads((RELEASE / 'manifest.json').read_text(encoding='utf-8'))['files']


def say(message: str):
    print(f'[Stage 13] {message}', flush=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_sha256(path: Path) -> str:
    # Git for Windows can checkout text files with CRLF. That is a formatting
    # change, not a code change; keep the preflight safe but portable.
    content = path.read_bytes().replace(b'\r\n', b'\n')
    return hashlib.sha256(content).hexdigest()


def check_no_symlink(root: Path, path: Path):
    node = path
    while node != root:
        if node.is_symlink():
            raise RuntimeError(f'Symlink inside a patch destination: {node}')
        node = node.parent


def check_project(root: Path):
    if not (root / 'backend/app/main.py').is_file() or not (root / 'frontend/package.json').is_file():
        raise RuntimeError('ProjectRoot should contain backend/app/main.py and frontend/package.json.')
    if not (root / 'backend/app/stage8b_auth.py').is_file():
        raise RuntimeError('Missing Stage 8B authentication source.')
    if not (root / 'backend/app/stage11_local.py').is_file():
        raise RuntimeError('Missing Stage 11 per-user workspace source.')


def check_sources(root: Path) -> bool:
    modes = []
    for rel, hashes in MANIFEST.items():
        target = root / rel
        replacement = FILES / rel
        if not replacement.is_file():
            raise RuntimeError(f'Release missing patch: {rel}')
        check_no_symlink(root, target)
        current = source_sha256(target) if target.is_file() else None
        wanted = source_sha256(replacement)
        if hashes.get('after') and hashes['after'] != wanted:
            raise RuntimeError(f'Release manifest inconsistent: {rel}')
        if current == wanted:
            modes.append('already')
        elif current == hashes['before']:
            modes.append('update')
            say(f'Preflight OK: {rel} (will install)')
        else:
            raise RuntimeError(f'Source changed since uploaded version: {rel}. Refusing to overwrite.')
    return 'update' in modes


def db_path(root: Path) -> Path:
    env = root / '.env'
    raw = 'storage/data/interview.db'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            key, value = line.split('=', 1)
            if key.strip() == 'SQLITE_PATH':
                raw = value.strip().strip('"\'')
    raw = os.environ.get('SQLITE_PATH', raw)
    relative = Path(raw).expanduser()
    db = (relative if relative.is_absolute() else root / relative)
    if db.is_symlink():
        raise RuntimeError('Account DB is a symlink; refusing installation.')
    root_storage = root / 'storage'
    if root_storage.is_symlink():
        raise RuntimeError('storage directory is a symlink; refusing installation.')
    final = db.resolve()
    if not final.is_relative_to(root_storage.resolve()):
        raise RuntimeError('SQLITE_PATH must remain within project storage/.')
    return final


def read_only_audit(target: Path) -> str:
    modpath = FILES / 'backend/app/stage13_bootstrap.py'
    spec = importlib.util.spec_from_file_location('stage13_preflight_module', modpath)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod.preflight_account_database(target)


def snapshot_db(target: Path, backup: Path):
    if not target.exists():
        say('No existing authentication database. Fresh installation will create one at app startup.')
        return
    if not target.is_file():
        raise RuntimeError('Existing authentication database is not a file.')
    backup_target = backup / 'account_db_before.sqlite3'
    with closing(sqlite3.connect(target.as_uri() + '?mode=ro', uri=True, timeout=20)) as src:
        with closing(sqlite3.connect(backup_target)) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('SQLite backup failed integrity check.')
    say(f'Preserved existing SQLite snapshot: {backup_target}')


def syntax_check(root: Path):
    n=0
    for p in (root / 'backend/app').rglob('*.py'):
        ast.parse(p.read_text(encoding='utf-8'), filename=str(p))
        n+=1
    say(f'Python syntax OK ({n} app files).')


def verify_regression(root: Path, python: str):
    command=[python, '-m', 'pytest', '-q', 'tests/test_stage13_bootstrap.py']
    say('Running Stage 13 isolated SQLite + 2-user FastAPI registration tests...')
    result=subprocess.run(command,cwd=root/'backend',timeout=180,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    print(result.stdout, end='', flush=True)
    if result.returncode:
        raise RuntimeError('Stage 13 test suite failed; restoring source files.')
    say('All Stage 13 regression checks passed.')


def install(root: Path, python: str, dry_run: bool):
    check_project(root)
    needed = check_sources(root)
    target=db_path(root)
    audit=read_only_audit(target)
    say(f'Read-only auth DB audit: {audit}')
    if dry_run:
        say('DRY RUN OK. No files/database modified.')
        return
    if not needed:
        say('Already installed (all patched files match).')
        return
    backup = root.parent / (root.name + '_stage13_backup_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')+'_'+uuid4().hex[:8])
    backup.mkdir(parents=True, exist_ok=False)
    say(f'Backup: {backup}')
    originals=[]
    applied=[]
    try:
        for rel in MANIFEST:
            path = root / rel
            existed = path.is_file()
            originals.append((rel, existed))
            if existed:
                dest=backup / 'originals' / rel
                dest.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(path,dest)
        snapshot_db(target,backup)
        manifest={'project':str(root),'files':[{'path':r,'existed':x} for r,x in originals],
                  'database':str(target),'note':'This installer does not modify the database. Do not restore old snapshots after registering new accounts.'}
        (backup/'backup_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        for rel, _ in originals:
            path=root/rel
            replacement=FILES/rel
            if path.is_file() and source_sha256(path)==source_sha256(replacement):
                continue
            path.parent.mkdir(parents=True,exist_ok=True)
            staging=path.with_name(path.name+'.stage13partial')
            shutil.copy2(replacement,staging)
            os.replace(staging,path)
            applied.append(rel)
            say(f'Installed: {rel}')
        syntax_check(root)
        verify_regression(root,python)
        say('SUCCESS. Start FastAPI to create or reconcile SQLite account tables.')
    except Exception:
        say('Validation failed. Restoring files changed by this installer...')
        try:
            for rel in reversed(applied):
                path=root/rel
                had_file=dict(originals)[rel]
                if had_file:
                    shutil.copy2(backup/'originals'/rel,path)
                else:
                    path.unlink(missing_ok=True)
                say(f'Restored: {rel}')
            say('ROLLBACK COMPLETE (database was not modified by installer).')
        except Exception as rollback_exc:
            say(f'ROLLBACK NEEDS MANUAL REVIEW: {rollback_exc} (backup {backup})')
        raise


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--project-root',required=True)
    parser.add_argument('--python',default=sys.executable)
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    root=Path(args.project_root).expanduser().resolve()
    say(f'Project: {root}')
    say(f'Python: {args.python}')
    install(root,args.python,args.dry_run)


if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        say(f'ERROR: {type(exc).__name__}: {exc}')
        raise SystemExit(1)
