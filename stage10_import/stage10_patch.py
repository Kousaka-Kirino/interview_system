"""Apply minimal source changes to the existing (versioned) React/FastAPI project.
Only called after the PowerShell installer has backed up every tracked file.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re
import sys

MARK = 'stage10:pptx-import'


def replace_once(content: str, before: str, after: str, where: str) -> str:
    n = content.count(before)
    if n != 1:
        raise RuntimeError(f'{where}: expected exactly 1 anchor, found {n}: {before!r}')
    return content.replace(before, after, 1)


def patch_materials(content: str) -> str:
    if MARK in content:
        raise RuntimeError('MaterialsPage.tsx already contains Stage 10 marker.')
    content = replace_once(content,
        'const invalid = validateDocument(file, 12)',
        'const invalid = validateStage10Material(file)',
        'MaterialsPage.tsx')
    content = replace_once(content,
        'accept=".pdf,.docx"',
        'accept=".pdf,.docx,.pptx"',
        'MaterialsPage.tsx')
    # Keep existing form/page intact and add one scoped helper.
    helper = '''// stage10:pptx-import -- PPTX is for supplementary material uploads only.\nfunction validateStage10Material(file: File | null): string | null {\n  if (file?.name.toLowerCase().endsWith('.pptx')) {\n    if (file.size === 0) return 'PPTX 文件为空。'\n    if (file.size > 12 * 1024 * 1024) return 'PPTX 大小不能超过 12 MiB。'\n    return null\n  }\n  return validateDocument(file, 12)\n}\n\n'''
    content = replace_once(content, 'export default function MaterialsPage() {',
                           helper + 'export default function MaterialsPage() {', 'MaterialsPage.tsx')
    # Update guidance only when old copy is present; preserve user's changes otherwise.
    content = content.replace('支持 .pdf / .docx，不超过 12 MiB', '支持 .pdf / .docx / .pptx，不超过 12 MiB')
    return content


def patch_api(content: str) -> str:
    if MARK in content:
        raise RuntimeError('lib/api.ts already contains Stage 10 marker.')
    pattern = re.compile(r"(upload:\s*\(file:\s*File\)\s*=>\s*request<MaterialInfo>\()\s*'/api/materials'(?=\s*,\s*\{\s*method:\s*'POST'\s*,\s*body:\s*fileBody\(file\))")
    found = pattern.findall(content)
    if len(found) != 1:
        raise RuntimeError(f'lib/api.ts: cannot identify unique materialApi.upload target, found {len(found)}')
    return pattern.sub(lambda m: m.group(1) + "\n      // stage10:pptx-import -- DOCX derivative uses existing RAG pipeline\n      file.name.toLowerCase().endsWith('.pptx') ? '/api/materials/pptx-import' : '/api/materials'", content, count=1)


def patch_main(content: str) -> str:
    if MARK in content:
        raise RuntimeError('backend/app/main.py already contains Stage 10 marker.')
    if not re.search(r'\bapp\s*=\s*FastAPI\s*\(', content):
        raise RuntimeError('backend/app/main.py: expected FastAPI instance named app.')
    return content.rstrip() + '\n\n# stage10:pptx-import -- reuse existing DOCX material indexing route\nfrom app.stage10_pptx import router as stage10_pptx_router\napp.include_router(stage10_pptx_router)\n'


def plan(root: Path) -> dict[Path, str]:
    files = {
      root / 'backend/app/main.py': patch_main,
      root / 'frontend/src/lib/api.ts': patch_api,
      root / 'frontend/src/pages/MaterialsPage.tsx': patch_materials,
    }
    result: dict[Path, str] = {}
    for target, transform in files.items():
        if not target.is_file():
            raise RuntimeError(f'Missing required project file: {target}')
        text = target.read_text(encoding='utf-8-sig')
        result[target] = transform(text)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.check == args.apply:
        parser.error('choose exactly one of --check or --apply')
    updates = plan(Path(args.project_root).resolve())
    if args.apply:
        for file, text in updates.items():
            file.write_text(text, encoding='utf-8', newline='\n')
        print('[Stage 10] Applied 3 minimal source patches.')
    else:
        print('[Stage 10] Source compatibility preflight OK (3 files).')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, UnicodeError) as exc:
        print('[Stage 10] COMPATIBILITY ERROR:', exc, file=sys.stderr)
        sys.exit(2)
