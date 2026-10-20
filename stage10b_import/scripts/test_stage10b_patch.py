from __future__ import annotations
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PATCHER = Path(__file__).parent / 'stage10b_patch.py'


def fixture(root: Path, with_backend: bool = True, with_frontend: bool = True, build_success: bool = True):
    (root / 'backend/app').mkdir(parents=True)
    (root / 'frontend/src/lib').mkdir(parents=True)
    (root / 'frontend/package.json').write_text(json.dumps({'name':'fixture','version':'1.0.0','scripts':{'build':'node -e "process.exit(' + ('0' if build_success else '1') + ')"'}}))
    (root / 'backend/app/__init__.py').write_text('')
    # A dynamic /api/materials/{id} route before the PPTX endpoint reproduces the collision.
    (root / 'backend/app/main.py').write_text('''from fastapi import FastAPI, HTTPException\napp = FastAPI()\n@app.post("/api/materials/{material_id}")\ndef upload_by_id(material_id: str):\n    raise HTTPException(404)\n''' + ('''@app.post("/api/materials/pptx-import")\ndef pptx_import():\n    return {'ok':True}\n''' if with_backend else ''))
    (root / 'frontend/src/lib/api.ts').write_text(("const url='/api/materials/pptx-import';" if with_frontend else 'const url="/api/materials";'))
    (root / 'PROJECT_GUIDE.md').write_text('# Guide\n')
    (root / 'API_DOCUMENTATION.md').write_text('# API\n')


def invoke(root: Path, *extra: str):
    return subprocess.run([sys.executable, str(PATCHER), '--project', str(root), '--python',sys.executable, '--npm','npm', *extra], text=True, capture_output=True)


def test_basic_and_repeat_and_rollback():
    with tempfile.TemporaryDirectory() as td:
        root=Path(td)/'project';fixture(root)
        old=(root/'backend/app/main.py').read_bytes()
        out=invoke(root)
        assert out.returncode == 0, out.stderr+'\n'+out.stdout
        assert 'POST /api/pptx-import registered: True' in out.stdout
        assert '/api/pptx-import' in (root/'frontend/src/lib/api.ts').read_text()
        assert '/api/materials/pptx-import' not in (root/'backend/app/main.py').read_text()
        assert 'Stage 10B' in (root/'PROJECT_GUIDE.md').read_text()
        again=invoke(root)
        assert again.returncode==0 and 'ALREADY PATCHED' in again.stdout, again.stderr
        backups=list(Path(td).glob('project_stage10b_backup_*'))
        assert len(backups)==1
        undo=invoke(root,'--rollback',str(backups[0]))
        assert undo.returncode==0, undo.stderr
        assert (root/'backend/app/main.py').read_bytes()==old
        assert (root/'PROJECT_GUIDE.md').read_text()=='# Guide\n'


def test_missing_backend_fails_without_edits():
    with tempfile.TemporaryDirectory() as td:
        root=Path(td)/'project';fixture(root,with_backend=False)
        old=(root/'frontend/src/lib/api.ts').read_bytes()
        out=invoke(root,'--skip-build')
        assert out.returncode != 0
        assert (root/'frontend/src/lib/api.ts').read_bytes()==old


def test_failed_build_restores_originals():
    with tempfile.TemporaryDirectory() as td:
        root=Path(td)/'project';fixture(root,build_success=False)
        old=(root/'backend/app/main.py').read_bytes()
        out=invoke(root)
        assert out.returncode != 0
        assert 'automatically restoring' in out.stderr
        assert (root/'backend/app/main.py').read_bytes()==old
        assert (root/'PROJECT_GUIDE.md').read_text() == '# Guide\n'

if __name__=='__main__':
    test_basic_and_repeat_and_rollback();print('PASS: end-to-end install, re-install, rollback')
    test_missing_backend_fails_without_edits();print('PASS: missing Stage 10 route aborts safely')
    test_failed_build_restores_originals();print('PASS: failed build restores source files')
