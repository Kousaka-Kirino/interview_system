"""Stage 12 small, fail-closed, format-only installer.

Uses only Python standard library; deliberately does not touch storage data or .env.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from uuid import uuid4

HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_normalized(data: bytes) -> str:
    return digest(data.replace(b"\r\n", b"\n"))


def within(root: Path, rel: str) -> Path:
    path = (root / rel).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Unsafe relative path: " + rel)
    return path


def check_manifest(root: Path):
    if not (root / "backend/app/main.py").is_file() or not (root / "frontend/package.json").is_file():
        raise RuntimeError("Not an interview_system project root")

    todo = []
    for rel, meta in MANIFEST["changes"].items():
        dest = within(root, rel)
        src = HERE / "patches" / rel
        if not src.is_file() or digest(src.read_bytes()) != meta["new_sha256"]:
            raise RuntimeError("Package checksum mismatch: " + rel)
        if dest.exists() and not dest.is_file():
            raise RuntimeError("Expected regular file, found a directory: " + rel)
        old = dest.read_bytes() if dest.exists() else None
        actual = digest_normalized(old) if old is not None else None
        expected = meta["original_sha256"]
        updated = meta["new_sha256"]
        if actual == updated:
            print("[UNCHANGED] Already cleaned:", rel)
            continue
        if actual != expected:
            if old is not None and expected is None:
                raise RuntimeError("File already exists; refusing overwrite: " + rel)
            raise RuntimeError("Local source differs from uploaded ZIP; refusing overwrite: " + rel)
        if meta["kind"] == "format-only" and rel.endswith(".py"):
            before_ast = ast.dump(ast.parse(old.decode("utf-8")), include_attributes=False)
            after_ast = ast.dump(ast.parse(src.read_text(encoding="utf-8")), include_attributes=False)
            if before_ast != after_ast:
                raise RuntimeError("Python AST differs, refusing behavior change: " + rel)
        todo.append(rel)
        print("[PATCH]", rel)
    return todo


def check_syntax(root: Path):
    count = 0
    for relroot in ["backend/app", "backend/tests", "backend/scripts", "scripts"]:
        folder = root / relroot
        if not folder.is_dir():
            continue
        for p in folder.rglob("*.py"):
            ast.parse(p.read_text(encoding="utf-8-sig"), filename=str(p))
            count += 1
    print(f"[CHECK] Python syntax: {count} files passed")


def check_contracts(root: Path):
    main = (root / "backend/app/main.py").read_text(encoding="utf-8")
    api = (root / "frontend/src/lib/api.ts").read_text(encoding="utf-8")
    stage11 = (root / "backend/app/stage11_local.py").read_text(encoding="utf-8")
    auth = (root / "backend/app/stage8b_auth.py").read_text(encoding="utf-8")
    assert '"/api/pptx-import"' in main
    assert "'/api/pptx-import'" in api
    assert "stage8b_install_auth(app)" in main
    assert "stage8c2_install_owner_scope(app)" in main
    assert '"storage" / "users"' in stage11
    assert '"/api/auth/register"' in auth
    print("[CHECK] PPTX, authentication and per-user storage references: OK")


def build_frontend(root: Path):
    exe = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not exe:
        raise RuntimeError("npm.cmd not found; install or enable Node.js first")
    if not (root / "frontend/node_modules/typescript").is_dir():
        raise RuntimeError("frontend/node_modules missing; run npm.cmd ci in the frontend directory")
    print("[CHECK] Running npm build...")
    subprocess.run([exe, "run", "build"], cwd=root / "frontend", check=True)
    print("[CHECK] Frontend TypeScript + Vite build: OK")


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 12 conservative code cleanup")
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = args.project.resolve()
    print("[Stage 12] Project:", root)
    todo = check_manifest(root)
    if args.dry_run:
        print("[Stage 12] DRY-RUN ONLY. No files modified.")
        return 0
    if not todo and not any((root / rel).exists() for rel in MANIFEST["archive"]):
        print("[Stage 12] Already clean. No changes needed.")
        return 0

    # Validate baseline before touching files.
    check_syntax(root)
    check_contracts(root)
    if not (root / "frontend/node_modules/typescript").is_dir():
        raise RuntimeError("frontend dependencies missing. Run 'npm.cmd ci' from frontend first")

    backup = root.parent / f"{root.name}_stage12_backup_{time.strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:8]}"
    originals = backup / "originals"
    originals.mkdir(parents=True)
    state: dict[str, bool] = {}
    for rel in todo:
        src = root / rel
        exists = src.is_file()
        state[rel] = exists
        if exists:
            dst = originals / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    had_dist = (root / "frontend/dist").exists()
    if had_dist:
        shutil.copytree(root / "frontend/dist", backup / "frontend_dist")

    (backup / "INSTALLATION_NOTE.txt").write_text(
        "Stage 12 code cleanup backup. Keep this directory while testing.\n"
        "This backup contains only the few changed source files, archived dev backups,\n"
        "and (if present) the earlier frontend/dist. NO personal storage is copied.\n",
        encoding="utf-8",
    )
    changed = []
    archived = []
    print("[Stage 12] Backup:", backup)
    try:
        for rel in todo:
            dst = root / rel
            src = HERE / "patches" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            temp = dst.parent / f".{dst.name}.stage12tmp"
            try:
                shutil.copy2(src, temp)
                os.replace(temp, dst)
            finally:
                temp.unlink(missing_ok=True)
            changed.append(rel)
        print("[Stage 12] Applied:", len(changed), "files")
        check_syntax(root)
        check_contracts(root)
        build_frontend(root)

        # Archive *only* two known historical backup files after checks pass.
        for rel in MANIFEST["archive"]:
            file = root / rel
            if file.is_file():
                dst = backup / "archived" / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(file), str(dst))
                archived.append(rel)
                print("[ARCHIVED]", rel)
        print("[Stage 12] SUCCESS. No application data or API behavior was changed.")
        print("[Stage 12] Keep backup until you have verified login, PPTX, RAG and interviews.")
        return 0
    except BaseException as exc:
        print("[Stage 12] FAILED:", type(exc).__name__, str(exc), file=sys.stderr)
        print("[Stage 12] Rolling back...", file=sys.stderr)
        for rel in archived:
            archived_src = backup / "archived" / rel
            restored = root / rel
            restored.parent.mkdir(parents=True, exist_ok=True)
            if archived_src.is_file():
                shutil.move(str(archived_src), str(restored))
        for rel in reversed(changed):
            dest = root / rel
            if state[rel]:
                shutil.copy2(originals / rel, dest)
            else:
                dest.unlink(missing_ok=True)
        dist = root / "frontend/dist"
        if had_dist:
            if dist.exists():
                shutil.rmtree(dist)
            shutil.copytree(backup / "frontend_dist", dist)
        elif dist.exists():
            shutil.rmtree(dist)
        print("[Stage 12] ROLLBACK COMPLETE; your source files were restored.", file=sys.stderr)
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[Stage 12] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
