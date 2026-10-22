"""Stage 13 fresh install and compatibility regression checks. No real project DB used."""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.stage13_bootstrap import REQUIRED, bootstrap_auth_schema


def test_new_sqlite_bootstrap_and_idempotence(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    first = bootstrap_auth_schema(target)
    assert first['created'] and first['changed']
    with sqlite3.connect(target) as db:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert set(REQUIRED) <= tables
        assert db.execute('SELECT COUNT(*) FROM app_users').fetchone()[0] == 0
        assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    second = bootstrap_auth_schema(target)
    assert not second['created'] and not second['changed']


def test_no_legacy_data_is_auto_claimed(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    target.parent.mkdir(parents=True)
    with sqlite3.connect(target) as db:
        db.execute('CREATE TABLE resumes (id TEXT PRIMARY KEY, full_text TEXT)')
        db.execute("INSERT INTO resumes VALUES ('old-id', 'private resume')")
    with pytest.raises(RuntimeError, match='legacy database'):
        bootstrap_auth_schema(target)
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT COUNT(*) FROM resumes').fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='app_users'").fetchone()[0] == 0


def test_empty_existing_sqlite_gets_account_tables_and_backup(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    target.parent.mkdir(parents=True)
    with sqlite3.connect(target) as db:
        db.execute('CREATE TABLE resumes (id TEXT PRIMARY KEY)')
    result = bootstrap_auth_schema(target)
    assert result['changed'] and not result['created']
    backups = list((tmp_path / 'storage' / 'backups').glob('stage13_auth_before_*.sqlite3'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('SELECT name FROM sqlite_master WHERE name="app_users"').fetchone() is None


def test_partial_incompatible_auth_table_rejected_without_changes(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    target.parent.mkdir(parents=True)
    with sqlite3.connect(target) as db:
        db.execute('CREATE TABLE app_users (username TEXT)')
    with pytest.raises(RuntimeError, match='incompatible'):
        bootstrap_auth_schema(target)
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE name='app_auth_sessions'").fetchone() is None


def test_legacy_aslan_without_ownership_ledger_is_not_claimed(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    bootstrap_auth_schema(target)
    with sqlite3.connect(target) as db:
        db.execute('''INSERT INTO app_users (id,username,password_hash,password_salt,password_scheme,created_at)
            VALUES ('legacy-id','aslan','h','s','scrypt-n32768-r8-p1','2026')''')
    with pytest.raises(RuntimeError, match='Stage 8C2 ownership metadata'):
        bootstrap_auth_schema(target)


def test_actual_app_new_account_can_register_and_see_isolated_data(tmp_path):
    """Run the real app from an isolated project root; never touch user's storage."""
    app_source = Path(__file__).resolve().parents[1] / 'app'
    isolated_backend = tmp_path / 'backend'
    isolated_backend.mkdir()
    shutil.copytree(app_source, isolated_backend / 'app', ignore=shutil.ignore_patterns('__pycache__'))
    script = r'''
import asyncio
import httpx
import sqlite3
from pathlib import Path
from app.main import app

async def run():
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8000',
            headers={'Origin':'http://127.0.0.1:5173'}) as alice:
            r=await alice.post('/api/auth/register',json={'username':'alice_123','password':'a safe test passphrase 123!'})
            assert r.status_code==201,(r.status_code,r.text)
            assert (await alice.get('/api/resumes')).status_code==200
            assert (await alice.get('/api/materials')).status_code==200
            assert (await alice.get('/api/health')).status_code==200
            assert (await alice.get('/api/resumes')).json()==[]
        async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8000',
            headers={'Origin':'http://127.0.0.1:5173'}) as bob:
            r=await bob.post('/api/auth/register',json={'username':'bob_123','password':'another safe test passphrase 999!'})
            assert r.status_code==201,(r.status_code,r.text)
            assert (await bob.get('/api/materials')).status_code==200
            assert (await bob.get('/api/resumes')).json()==[]
            assert (await bob.get('/api/resumes/not-an-id')).status_code==404
        async with httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8000') as anon:
            assert (await anon.get('/api/resumes')).status_code==401
        root=Path.cwd().parent
        auth=root/'storage/data/interview.db'
        with sqlite3.connect(auth) as db:
            assert db.execute('SELECT COUNT(*) FROM app_users').fetchone()[0]==2
            assert db.execute('SELECT COUNT(*) FROM app_user_profiles').fetchone()[0]==2
        assert len(list((root/'storage/users').glob('*/interview.db')))==2
    print('STAGE13_INTEGRATION_OK')
asyncio.run(run())
'''
    env = os.environ.copy()
    env.pop('SQLITE_PATH', None)
    env['PYTHONPATH'] = str(isolated_backend)
    env['HF_HUB_OFFLINE'] = '1'
    result = subprocess.run([sys.executable, '-c', script], cwd=isolated_backend,
                            env=env, capture_output=True, text=True, timeout=95)
    assert result.returncode == 0, result.stdout + '\n' + result.stderr
    assert 'STAGE13_INTEGRATION_OK' in result.stdout


def test_empty_auth_table_does_not_claim_legacy_rows(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    bootstrap_auth_schema(target)
    with sqlite3.connect(target) as db:
        db.execute('CREATE TABLE resumes (id TEXT PRIMARY KEY)')
        db.execute("INSERT INTO resumes VALUES ('old-private')")
    with pytest.raises(RuntimeError, match='without any owner account'):
        bootstrap_auth_schema(target)


def test_existing_aslan_with_valid_ledger_is_preserved(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    bootstrap_auth_schema(target)
    with sqlite3.connect(target) as db:
        db.execute('''INSERT INTO app_users (id,username,password_hash,password_salt,password_scheme,created_at)
            VALUES ('owner-uuid','aslan','original-hash','original-salt','scrypt-n32768-r8-p1','2026')''')
        db.execute('CREATE TABLE app_stage8c2_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.execute("INSERT INTO app_stage8c2_meta VALUES ('owner_user_id','owner-uuid')")
        db.execute("INSERT INTO app_stage8c2_meta VALUES ('multiuser_enabled','0')")
        db.execute("INSERT INTO app_user_profiles VALUES ('owner-uuid','Legacy User','',12345)")
    assert bootstrap_auth_schema(target)['changed'] is False
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT password_hash FROM app_users WHERE username="aslan"').fetchone()[0] == 'original-hash'
        assert db.execute('SELECT display_name FROM app_user_profiles WHERE user_id="owner-uuid"').fetchone()[0] == 'Legacy User'


def test_partial_existing_auth_schema_repairs_missing_tables_and_profiles(tmp_path):
    target = tmp_path / 'storage' / 'data' / 'interview.db'
    target.parent.mkdir(parents=True)
    with sqlite3.connect(target) as db:
        db.execute('''CREATE TABLE app_users (
            id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,password_scheme TEXT NOT NULL,
            must_change_password INTEGER NOT NULL DEFAULT 1,is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL)''')
        db.execute("INSERT INTO app_users VALUES ('u1','student','hash','salt','scrypt-n32768-r8-p1',0,1,'2026')")
    result = bootstrap_auth_schema(target)
    assert result['changed'] is True
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT password_hash FROM app_users').fetchone()[0] == 'hash'
        assert db.execute('SELECT display_name FROM app_user_profiles').fetchone()[0] == 'student'
        assert db.execute('SELECT COUNT(*) FROM app_auth_attempts').fetchone()[0] == 0
    assert len(list((tmp_path/'storage/backups').glob('stage13_auth_before_*.sqlite3'))) == 1
