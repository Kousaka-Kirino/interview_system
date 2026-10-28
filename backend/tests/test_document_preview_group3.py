"""Group 3 preview regression: temporary SQLite and uploads only; no real account or AI calls."""
from io import BytesIO
from uuid import uuid4

import fitz
import pytest
from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.responses import JSONResponse

from app.api.materials import router as materials_router
from app.api.resumes import router as resumes_router
from app.core.config import Settings
from app.core.database import Base, get_db
from app.models.resume import Resume
from app.models.material import Material
from app.stage11_local import get_user_settings
from app.stage8c2_guard import OwnerScopeMiddleware
from app.services.document_preview import preview_document


def make_docx(text: str) -> bytes:
    doc = Document()
    for line in text.splitlines():
        doc.add_paragraph(line)
    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def make_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((40, 60), text)
    content = doc.tobytes()
    doc.close()
    return content


@pytest.fixture()
def test_client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'preview-test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    settings = Settings(_env_file=None, upload_path=str(tmp_path / 'user_own_uploads'))
    app = FastAPI()
    app.include_router(resumes_router)
    app.include_router(materials_router)

    def db_dependency():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = db_dependency
    app.dependency_overrides[get_user_settings] = lambda: settings
    with TestClient(app) as client:
        yield client, factory, settings
    engine.dispose()


def add_document(factory, settings, category, extension, raw, name=None):
    document_id = str(uuid4())
    stored_filename = f'{document_id}{extension}'
    folder = settings.uploads_dir / category
    folder.mkdir(parents=True, exist_ok=True)
    (folder / stored_filename).write_bytes(raw)
    with factory() as session:
        if category == 'resumes':
            entry = Resume(
                id=document_id, original_filename=name or f'hello{extension}',
                stored_filename=stored_filename, file_size=len(raw),
                full_text='saved source', structured_data={'sections': {}},
            )
        else:
            entry = Material(
                id=document_id, original_filename=name or f'hello{extension}',
                stored_filename=stored_filename, file_size=len(raw), chunk_count=1,
            )
        session.add(entry)
        session.commit()
    return document_id


def test_pdf_preview_returns_original_and_inline_headers(test_client):
    client, factory, settings = test_client
    pdf = make_pdf('preview pdf')
    resume_id = add_document(factory, settings, 'resumes', '.pdf', pdf)
    material_id = add_document(factory, settings, 'materials', '.pdf', pdf)
    for url in (f'/api/resumes/{resume_id}/preview', f'/api/materials/{material_id}/preview'):
        response = client.get(url)
        assert response.status_code == 200, response.text
        assert response.content == pdf
        assert response.headers['content-type'] == 'application/pdf'
        assert response.headers['content-disposition'].startswith('inline;')
        assert response.headers['cache-control'] == 'private, no-store'
        assert response.headers['x-content-type-options'] == 'nosniff'


def test_docx_preview_reads_original_not_corrected_text(test_client):
    client, factory, settings = test_client
    original = make_docx('实习经历\n实际负责接口开发')
    resume_id = add_document(factory, settings, 'resumes', '.docx', original)
    with factory() as session:
        record = session.get(Resume, resume_id)
        record.full_text = '用户修改后的结构化内容不应替换原文'
        session.commit()
    response = client.get(f'/api/resumes/{resume_id}/preview')
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/plain')
    assert '实际负责接口开发' in response.text
    assert '用户修改后的结构化内容' not in response.text


def test_pptx_derivative_preview_is_text_only(test_client):
    client, factory, settings = test_client
    derivative_name = '答辩演示_PPTX文字提取版.docx'
    material_id = add_document(factory, settings, 'materials', '.docx', make_docx('第 4 页\n实验结果 92%'), name=derivative_name)
    response = client.get(f'/api/materials/{material_id}/preview')
    assert response.status_code == 200
    assert '第 4 页' in response.text
    assert '实验结果 92%' in response.text
    assert response.headers['content-type'].startswith('text/plain')


def test_missing_foreign_and_invalid_stored_path_denied(test_client, tmp_path):
    client, factory, settings = test_client
    assert client.get(f'/api/resumes/{uuid4()}/preview').status_code == 404
    assert client.get(f'/api/materials/{uuid4()}/preview').status_code == 404
    document_id = add_document(factory, settings, 'resumes', '.pdf', make_pdf('missing'))
    (settings.uploads_dir / 'resumes' / f'{document_id}.pdf').unlink()
    assert client.get(f'/api/resumes/{document_id}/preview').status_code == 404
    with pytest.raises(Exception) as exc:
        preview_document(settings.uploads_dir, 'resumes', '../../passwd.pdf', max_bytes=1024)
    assert getattr(exc.value, 'status_code', None) == 404


def test_invalid_docx_does_not_leak_traceback(test_client):
    client, factory, settings = test_client
    document_id = add_document(factory, settings, 'materials', '.docx', b'broken docx')
    response = client.get(f'/api/materials/{document_id}/preview')
    assert response.status_code == 422
    assert '无法解析' in response.json()['detail'] or '不是有效' in response.json()['detail']


def test_account_ownership_middleware_intercepts_preview(test_client, monkeypatch):
    # The deployed app installs OwnerScopeMiddleware; prove its URL matcher sees preview paths.
    from app import stage8c2_guard as guard
    client, factory, settings = test_client
    document_id = add_document(factory, settings, 'resumes', '.pdf', make_pdf('secret'))
    calls = []

    def deny(refs, request):
        calls.append(refs)
        return JSONResponse({'detail': '资源不存在或无权访问'}, status_code=404) if refs else None

    monkeypatch.setattr(guard, '_verify_references', deny)
    app = FastAPI()
    app.include_router(resumes_router)
    app.dependency_overrides[get_db] = client.app.dependency_overrides[get_db]
    app.dependency_overrides[get_user_settings] = client.app.dependency_overrides[get_user_settings]
    app.add_middleware(OwnerScopeMiddleware)
    with TestClient(app) as guarded:
        response = guarded.get(f'/api/resumes/{document_id}/preview')
    assert response.status_code == 404
    assert calls == [[('resume', document_id)]]
