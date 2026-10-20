#!/usr/bin/env python3
"""Stage 10B route compatibility patch for the interview_system Stage 10 PPTX upload.

Only changes literal route strings in existing Stage 10 code. Fails closed on
unexpected source structure; never invents a route or weakens authentication.
"""
from __future__ import annotations

import argparse
import ast
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

OLD = "/api/materials/pptx-import"
NEW = "/api/pptx-import"
TAG = "<!-- stage10b-pptx-route-fix -->"
DOCS = ("PROJECT_GUIDE.md", "API_DOCUMENTATION.md")
APPENDIX = {
    "PROJECT_GUIDE.md": f"""\n\n{TAG}\n## Stage 10B — PPTX 上传 404 兼容修复\n\n- 先安装 Stage 10 PPTX 上传功能，再安装 Stage 10B。\n- 前端发送 `POST {NEW}`，后端通过相同地址接受上传。\n- 保留 Stage 10 的登录验证、文件大小及格式校验、PPTX 文字提取、DOCX 衍生文件和已有资料索引逻辑。\n- 不改变数据库结构、不删除资料；原始 PPTX 仍不会被保存。\n- 如安装完成后浏览器仍请求 `{OLD}`，请确认重启或刷新 Vite 开发服务，并强制刷新浏览器。\n- 如需恢复，运行修复包中的 `rollback-stage10b.ps1`，根据安装日志传入备份目录。\n""",
    "API_DOCUMENTATION.md": f"""\n\n{TAG}\n## Stage 10B — PPTX import route\n\n**POST `{NEW}`**：Stage 10 PPTX 文字导入端点（修复旧地址 `{OLD}` 404 的兼容问题）。\n\n- 使用 `multipart/form-data`，字段名 `file`；必须保持原有登录认证及资料归属校验。\n- 正常成功响应保持 Stage 10 的返回格式；非法 PPTX、旧版 `.ppt`、过大文件应返回相应 4xx。\n- 本次仅更换路由，不更改认证、文件处理及存储实现。\n""",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_utf8(file: Path) -> str:
    data = file.read_bytes()
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"Not UTF-8 text: {file}") from exc


def validate(root: Path) -> tuple[dict[Path, bytes], list[str]]:
    if not (root / "frontend/package.json").is_file():
        raise RuntimeError("Invalid project: frontend/package.json missing")
    if not (root / "backend/app/main.py").is_file():
        raise RuntimeError("Invalid project: backend/app/main.py missing")
    backend_files = sorted((root / "backend/app").rglob("*.py"))
    frontend_files = sorted((root / "frontend/src").rglob("*.ts")) + sorted((root / "frontend/src").rglob("*.tsx"))
    if not backend_files or not frontend_files:
        raise RuntimeError("Backend or frontend source files were not found")
    backend_old = [p for p in backend_files if OLD in load_utf8(p)]
    backend_new = [p for p in backend_files if NEW in load_utf8(p)]
    frontend_old = [p for p in frontend_files if OLD in load_utf8(p)]
    frontend_new = [p for p in frontend_files if NEW in load_utf8(p)]
    if not backend_old and not backend_new:
        raise RuntimeError(
            f"Stage 10 backend endpoint not found ({OLD}). "
            "Please verify that Stage 10 was installed in this project. "
            "No files were changed."
        )
    if not frontend_old and not frontend_new:
        raise RuntimeError(
            f"Stage 10 frontend endpoint not found ({OLD}). "
            "Please verify Stage 10 was installed. No files were changed."
        )
    if len(backend_old + [p for p in backend_new if p not in backend_old]) != 1:
        raise RuntimeError("Multiple backend files reference the PPTX path; inspect manually before patching")
    if len(frontend_old + [p for p in frontend_new if p not in frontend_old]) > 3:
        raise RuntimeError("Unexpected number of frontend references; inspect manually before patching")
    changes: dict[Path, bytes] = {}
    for file in backend_old + frontend_old:
        src = load_utf8(file)
        updated = src.replace(OLD, NEW)
        # Catch Python parsing issues before modifying anything.
        if file.suffix == ".py":
            ast.parse(updated, filename=str(file))
        if updated != src:
            changes[file] = updated.encode("utf-8")
    for name in DOCS:
        file = root / name
        if file.exists():
            content = load_utf8(file)
            if TAG not in content:
                changes[file] = (content + APPENDIX[name]).encode("utf-8")
    info = [
        f"Backend old references: {len(backend_old)}; new references: {len(backend_new)}",
        f"Frontend old references: {len(frontend_old)}; new references: {len(frontend_new)}",
        f"Files to update: {len(changes)}",
    ]
    return changes, info


def verify_sources(root: Path) -> None:
    back = list((root / "backend/app").rglob("*.py"))
    front = list((root / "frontend/src").rglob("*.ts")) + list((root / "frontend/src").rglob("*.tsx"))
    assert back and front
    if not any(NEW in load_utf8(p) for p in back):
        raise RuntimeError("Backend route path was not updated")
    if not any(NEW in load_utf8(p) for p in front):
        raise RuntimeError("Frontend route path was not updated")
    if any(OLD in load_utf8(p) for p in back + front):
        raise RuntimeError("Old PPTX route string remains in application source")
    for file in back:
        if NEW in load_utf8(file):
            ast.parse(load_utf8(file), filename=str(file))


def check_imported_routes(root: Path, python: str) -> None:
    # Import the application's actual FastAPI instance (not a synthetic mock).
    # This catches cases where a decorator exists but is not registered.
    script = '''from app.main import app
routes = [(getattr(r, 'path', ''), set(getattr(r, 'methods', set()) or set())) for r in app.routes]
found = [p for (p, methods) in routes if p == "/api/pptx-import" and "POST" in methods]
print("[CHECK] POST /api/pptx-import registered:", bool(found))
if not found: raise SystemExit("PPTX POST route absent in the actual FastAPI app")
'''
    try:
        proc = subprocess.run(
            [python, "-c", script], cwd=str(root / "backend"),
            text=True, encoding="utf-8", errors="replace", capture_output=True,
            timeout=90,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Timed out importing actual FastAPI app (90 s)") from exc
    if proc.stdout.strip():
        print(proc.stdout.rstrip())
    if proc.returncode:
        if proc.stderr.strip():
            print(proc.stderr[-7000:], file=sys.stderr)
        raise RuntimeError("Actual FastAPI route registration check FAILED")


def frontend_build(root: Path, npm: str) -> None:
    exe = shutil.which(npm)
    if not exe:
        raise RuntimeError(f"Cannot find {npm}; install Node.js/npm or run the script in a configured terminal")
    print("[Stage 10B] Running frontend production build (npm run build)...", flush=True)
    subprocess.run([exe, "run", "build"], cwd=str(root / "frontend"), check=True, timeout=180)


def patch(root: Path, python: str, npm: str, skip_build: bool) -> None:
    changes, info = validate(root)
    print("[Stage 10B] Source compatibility checks OK.", flush=True)
    for line in info:
        print("[Stage 10B] " + line, flush=True)
    if not changes:
        verify_sources(root)
        check_imported_routes(root, python)
        if not skip_build:
            frontend_build(root, npm)
        print("[Stage 10B] ALREADY PATCHED; route check OK.", flush=True)
        return

    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup = root.parent / f"{root.name}_stage10b_backup_{stamp}"
    backup.mkdir(parents=True, exist_ok=False)
    manifest: list[dict[str, str]] = []
    print(f"[Stage 10B] Backup: {backup}", flush=True)
    try:
        for path, content in changes.items():
            relative = path.relative_to(root)
            before = path.read_bytes()
            dest = backup / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(before)
            manifest.append({"path": relative.as_posix(), "before_sha256": sha256(before), "after_sha256": sha256(content)})
        (backup / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        for path, content in changes.items():
            path.write_bytes(content)
            print("[Stage 10B] Patched " + path.relative_to(root).as_posix(), flush=True)
        verify_sources(root)
        print("[Stage 10B] Checking real FastAPI routes...", flush=True)
        check_imported_routes(root, python)
        if not skip_build:
            frontend_build(root, npm)
    except Exception:
        print("[Stage 10B] Validation/build failed; automatically restoring original files.", file=sys.stderr)
        restore(root, backup, force=True)
        raise
    print("[Stage 10B] SUCCESS. Stop and restart FastAPI; refresh Vite/browser.", flush=True)
    print(f"[Stage 10B] Backup for manual rollback: {backup}", flush=True)


def restore(root: Path, backup: Path, force: bool = False) -> None:
    manifest_file = backup / "manifest.json"
    if not manifest_file.is_file():
        raise RuntimeError(f"No backup manifest: {manifest_file}")
    items = json.loads(manifest_file.read_text(encoding="utf-8"))
    for item in items:
        rel = Path(item["path"])
        if rel.is_absolute() or ".." in rel.parts:
            raise RuntimeError("Invalid backup manifest path")
        source = backup / rel
        target = root / rel
        original = source.read_bytes()
        if sha256(original) != item["before_sha256"]:
            raise RuntimeError(f"Backup corruption detected: {rel}")
        if not force and target.is_file() and sha256(target.read_bytes()) != item["after_sha256"]:
            raise RuntimeError(f"File was edited after installation: {rel}. Refusing to overwrite; use --force only after reviewing.")
    for item in items:
        rel = Path(item["path"])
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((backup / rel).read_bytes())
        print("[Stage 10B] Restored: " + rel.as_posix(), flush=True)
    print("[Stage 10B] ROLLBACK COMPLETE. Restart FastAPI and frontend.", flush=True)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True, help="interview_system root")
    p.add_argument("--python", default=sys.executable)
    p.add_argument("--npm", default="npm.cmd" if os.name == "nt" else "npm")
    p.add_argument("--skip-build", action="store_true", help="for isolated tests only")
    p.add_argument("--rollback", help="backup directory from installation log")
    p.add_argument("--force", action="store_true", help="force rollback changed files")
    args = p.parse_args()
    root = Path(args.project).expanduser().resolve()
    if not root.is_dir():
        raise RuntimeError(f"Project folder not found: {root}")
    if args.rollback:
        restore(root, Path(args.rollback).expanduser().resolve(), force=args.force)
    else:
        patch(root, args.python, args.npm, args.skip_build)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError, OSError, AssertionError) as exc:
        print(f"[Stage 10B] ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
