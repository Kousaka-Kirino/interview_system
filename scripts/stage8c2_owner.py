"""Stage 8C2 offline primary-resource ownership migration and SQLite snapshots.

Single aslan account ONLY. This is NOT multi-tenant release readiness.
No source content, passwords, paths or secret settings in audit JSON.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from contextlib import contextmanager, closing
from pathlib import Path

KINDS = {
    "resume": ("resumes", "resume", "resume_records", "resume_documents", "uploaded_resumes"),
    "material": ("materials", "material", "supplementary_materials", "supplementary_material", "knowledge_materials", "reference_materials"),
    "session": ("interview_sessions", "interviews", "interview_session", "interview_records", "defense_sessions", "sessions"),
}


def root_paths(project: Path):
    root = project.expanduser().resolve()
    if not (root / "backend/app/main.py").is_file() or not (root / "frontend/package.json").is_file():
        raise RuntimeError("Project path must contain backend/app/main.py and frontend/package.json")
    values = {}
    env = root / ".env"
    if env.is_file():
        for raw in env.read_text(encoding="utf-8-sig").splitlines():
            stripped = raw.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key, value = stripped.split("=", 1)
                if key.strip() in ("SQLITE_PATH", "STUDY_SQLITE_PATH"):
                    values[key.strip()] = value.strip().strip('"\'')
    def resolve(key, default):
        raw = Path(os.environ.get(key, values.get(key, default))).expanduser()
        path = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
        if not path.is_relative_to((root / "storage").resolve()) or path.is_symlink():
            raise RuntimeError("Unsafe SQLite path: " + key)
        return path
    main = resolve("SQLITE_PATH", "storage/data/interview.db")
    study = resolve("STUDY_SQLITE_PATH", "storage/data/study_review.db")
    if not main.is_file() or main == study:
        raise RuntimeError("Main SQLite database missing or duplicate paths")
    return root, main, study


@contextmanager
def connect(path: Path):
    if not path.is_file():
        raise RuntimeError("Database not found")
    db = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=20)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=20000")
        db.execute("PRAGMA foreign_keys=ON")
        with db:
            yield db
    finally:
        db.close()


def tables(db):
    return {row[0]: row[1] for row in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table'")
            if not row[0].startswith("sqlite_")}


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def columns(db, table):
    return {r[1]: r for r in db.execute("PRAGMA table_info(" + quote(table) + ")")}


def owner_id(db):
    if "app_users" not in tables(db):
        raise RuntimeError("Stage 8A user account missing")
    users = db.execute("SELECT id,username,is_active FROM app_users").fetchall()
    if len(users) != 1 or users[0]["username"].lower() != "aslan" or not users[0]["is_active"]:
        raise RuntimeError("Only one active 'aslan' account is allowed; registration remains disabled")
    return str(users[0]["id"])


def discover(db):
    found = tables(db)
    mapping = {}
    for kind, names in KINDS.items():
        options = [name for name in names if name in found and "id" in columns(db, name)]
        if len(options) != 1:
            raise RuntimeError(f"Cannot safely identify {kind} table (matched {options}); need exact schema review")
        name = options[0]
        sql = (found[name] or "").upper()
        if "WITHOUT ROWID" in sql or "CREATE VIRTUAL TABLE" in sql:
            raise RuntimeError(f"Unsupported table structure: {name}")
        mapping[kind] = name
    return mapping


def inventory(root: Path):
    _, main, _ = root_paths(root)
    with connect(main) as db:
        details = []
        for table, sql in sorted(tables(db).items()):
            if table.startswith("app_"):
                continue
            details.append({"table": table, "columns": sorted(columns(db, table)),
                            "rows": db.execute("SELECT COUNT(*) FROM " + quote(table)).fetchone()[0]})
    return {"stage": "8C2", "database": "main", "schema_inventory": details,
            "note": "Only table names, column names and counts; no row contents or credentials"}


def inspect(root: Path):
    root, main, study = root_paths(root)
    with connect(main) as db:
        user = owner_id(db)
        found = tables(db)
        detail = []
        for table, sql in sorted(found.items()):
            if table.startswith("app_"):
                continue
            cols = columns(db, table)
            detail.append({"table": table, "columns": sorted(cols),
                           "rows": db.execute("SELECT COUNT(*) FROM " + quote(table)).fetchone()[0]})
        mapping = discover(db)
        for table in mapping.values():
            cols = columns(db, table)
            if "user_id" in cols:
                bad = db.execute("SELECT COUNT(*) FROM " + quote(table) + " WHERE user_id IS NOT NULL AND user_id != ?", (user,)).fetchone()[0]
                if bad:
                    raise RuntimeError("Foreign owners already present in table: " + table)
        if "app_stage8c2_meta" in found:
            raise RuntimeError("Stage 8C2 already applied; repeat install is forbidden")
        if "app_user_profiles" not in found or "app_auth_sessions" not in found:
            raise RuntimeError("Stage 8C-1 account/profile prerequisite missing")
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("Main SQLite integrity check failed")
    if study.is_file():
        with connect(study) as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Study SQLite integrity check failed")
            if "study_knowledge_points" in tables(db) and "user_id" not in columns(db, "study_knowledge_points"):
                raise RuntimeError("Stage 8C-1 study knowledge owner column missing")
    return {"stage": "8C2", "username": "aslan", "mapped_tables": mapping, "schema_inventory": detail}


def snapshot(root: Path, target: Path):
    _, main, study = root_paths(root)
    if target.exists():
        raise RuntimeError("Snapshot folder exists; refusing overwrite")
    target.mkdir(parents=True)
    info = {"stage": "8C2", "root": str(root.resolve()), "main": str(main), "study": str(study), "study_exists": study.is_file()}
    for name, dbfile in (("main", main), ("study", study)):
        if not dbfile.is_file():
            continue
        with connect(dbfile) as src, closing(sqlite3.connect(target / (name + ".sqlite3"))) as dst:
            src.backup(dst)
            assert dst.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    (target / "snapshot.json").write_text(json.dumps(info, indent=2), encoding="utf-8")


def apply(root: Path):
    audit = inspect(root)
    _, main, _ = root_paths(root)
    with connect(main) as db:
        owner = owner_id(db)
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE app_stage8c2_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
        for kind, table in audit["mapped_tables"].items():
            col = columns(db, table)
            if "user_id" not in col:
                db.execute("ALTER TABLE " + quote(table) + " ADD COLUMN user_id TEXT")
            # Reconciliation is explicit; existing rows remain unchanged otherwise.
            db.execute("UPDATE " + quote(table) + " SET user_id=? WHERE user_id IS NULL OR user_id=''", (owner,))
            safe = re.sub(r"[^a-zA-Z0-9_]", "_", table)
            db.execute("CREATE INDEX IF NOT EXISTS " + quote("ix_s8c2_" + safe + "_owner_id") +
                       " ON " + quote(table) + " (user_id, id)")
            # Legacy endpoints do not yet provide owner at insert time. Temporary single-owner
            # triggers keep all new records owned; remove in the full multi-user upgrade.
            db.execute(f'''CREATE TRIGGER {quote("s8c2_"+safe+"_insert_owner")}
                AFTER INSERT ON {quote(table)}
                BEGIN
                  SELECT CASE WHEN NEW.user_id IS NOT NULL AND NEW.user_id != {repr(owner)}
                    THEN RAISE(ABORT,'invalid resource owner') END;
                  UPDATE {quote(table)} SET user_id={repr(owner)} WHERE id=NEW.id AND NEW.user_id IS NULL;
                END''')
            db.execute(f'''CREATE TRIGGER {quote("s8c2_"+safe+"_update_owner")}
                BEFORE UPDATE OF user_id ON {quote(table)}
                WHEN NEW.user_id IS NULL OR NEW.user_id != {repr(owner)}
                BEGIN SELECT RAISE(ABORT,'invalid resource owner'); END''')
        for kind, table in audit["mapped_tables"].items():
            db.execute("INSERT INTO app_stage8c2_meta VALUES(?,?)", (kind + "_table", table))
        db.execute("INSERT INTO app_stage8c2_meta VALUES(?,?)", ("owner_user_id", owner))
        db.execute("INSERT INTO app_stage8c2_meta VALUES(?,?)", ("multiuser_enabled", "0"))
        db.commit()
    verify(root)


def verify(root: Path):
    _, main, study = root_paths(root)
    with connect(main) as db:
        owner = owner_id(db)
        if "app_stage8c2_meta" not in tables(db):
            raise RuntimeError("Stage 8C2 meta missing")
        meta = dict(db.execute("SELECT name,value FROM app_stage8c2_meta").fetchall())
        if meta.get("owner_user_id") != owner or meta.get("multiuser_enabled") != "0":
            raise RuntimeError("Owner or registration lock mismatch")
        for kind in KINDS:
            table = meta.get(kind + "_table")
            if table not in tables(db) or "user_id" not in columns(db, table):
                raise RuntimeError("Missing owner column: " + kind)
            bad = db.execute("SELECT COUNT(*) FROM " + quote(table) + " WHERE user_id IS NULL OR user_id!=?", (owner,)).fetchone()[0]
            if bad:
                raise RuntimeError("Unowned records in " + kind)
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("Main SQLite failed quick_check")
    if study.is_file():
        with connect(study) as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Review SQLite failed quick_check")
    print("[Stage 8C2] Verified primary resource ownership; multiuser DISABLED")


def restore(root: Path, source: Path, preserve: Path):
    _, main, study = root_paths(root)
    info = json.loads((source / "snapshot.json").read_text(encoding="utf-8"))
    if info["stage"] != "8C2" or info["root"] != str(root.resolve()) or info["main"] != str(main) or info["study"] != str(study):
        raise RuntimeError("Snapshot does not match project")
    if preserve.exists():
        raise RuntimeError("Preserve directory already exists")
    preserve.mkdir(parents=True)
    for name, current in (("main", main), ("study", study)):
        if current.is_file():
            with connect(current) as src, closing(sqlite3.connect(preserve / (name + ".sqlite3"))) as dst:
                src.backup(dst)
    for name, current, exists in (("main", main, True), ("study", study, info["study_exists"])):
        if not exists:
            # Remove only if this project created it during upgrade. 8C2 never creates study.
            continue
        source_db = source / (name + ".sqlite3")
        if not source_db.is_file():
            raise RuntimeError("Snapshot missing: " + name)
        with closing(sqlite3.connect(source_db)) as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Corrupt snapshot: " + name)
            with connect(current) as dst:
                db.backup(dst)
    print("[Stage 8C2] Restored pre-upgrade DB; newer DB copy preserved at: " + str(preserve))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--project-root", required=True)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--inventory")
    mode.add_argument("--audit")
    mode.add_argument("--snapshot")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    mode.add_argument("--restore")
    p.add_argument("--preserve")
    args = p.parse_args()
    root = Path(args.project_root).expanduser().resolve()
    if args.inventory:
        report = Path(args.inventory).resolve()
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(inventory(root), ensure_ascii=False, indent=2), encoding="utf-8")
        print("[Stage 8C2] Safe SQLite inventory generated")
    elif args.audit:
        details = inspect(root)
        report = Path(args.audit).resolve()
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[Stage 8C2] Schema preflight OK (table names and counts only)")
    elif args.snapshot:
        inspect(root)
        snapshot(root, Path(args.snapshot).resolve())
    elif args.apply:
        apply(root)
    elif args.verify:
        verify(root)
    else:
        if not args.preserve:
            raise RuntimeError("--preserve required for DB restore")
        restore(root, Path(args.restore).resolve(), Path(args.preserve).resolve())


if __name__ == "__main__":
    main()
