"""临时数据库测试，绝不使用用户真实 storage/data。"""

from io import BytesIO

import fitz
import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.main import app
from app.models.resume import Resume  # noqa: F401


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    test_settings = Settings(_env_file=None, upload_path=str(tmp_path / "uploads"))

    def override_db():
        with session_factory() as session:
            yield session

    # 防止应用 lifespan 初始化用户真实的 SQLite 数据库。
    monkeypatch.setattr("app.main.init_db", lambda: None)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    with TestClient(app) as test_client:
        yield test_client, tmp_path, session_factory
    app.dependency_overrides.clear()
    engine.dispose()


def docx_bytes(text: str) -> bytes:
    document = Document()
    for line in text.splitlines():
        document.add_paragraph(line)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def pdf_bytes(text: str) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    content = document.tobytes()
    document.close()
    return content


def test_upload_list_detail_delete_docx(client):
    api, temp_dir, session_factory = client
    data = docx_bytes("姓名：张三\n项目经历\n客服助手系统\n技能\nPython")
    response = api.post("/api/resumes", files={"file": ("my-resume.docx", data)})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["structured_data"]["name"] == "张三"
    assert "客服助手系统" in body["structured_data"]["sections"]["projects"]
    resume_id = body["id"]
    assert len(api.get("/api/resumes").json()) == 1
    assert api.get(f"/api/resumes/{resume_id}").json()["id"] == resume_id
    saved_files = list((temp_dir / "uploads" / "resumes").glob("*.docx"))
    assert len(saved_files) == 1
    result = api.delete(f"/api/resumes/{resume_id}")
    assert result.status_code == 204
    assert api.get(f"/api/resumes/{resume_id}").status_code == 404
    assert not saved_files[0].exists()
    with session_factory() as db:
        assert db.get(Resume, resume_id) is None


def test_pdf_upload(client):
    api, _, _ = client
    response = api.post(
        "/api/resumes", files={"file": ("resume.pdf", pdf_bytes("Python engineer"))}
    )
    assert response.status_code == 201, response.text
    assert "Python engineer" in response.json()["full_text"]


def test_invalid_extension(client):
    api, _, _ = client
    response = api.post("/api/resumes", files={"file": ("resume.txt", b"hello")})
    assert response.status_code == 415


def test_invalid_docx(client):
    api, _, _ = client
    response = api.post("/api/resumes", files={"file": ("bad.docx", b"not a docx")})
    assert response.status_code == 422


def test_file_size_limit(client):
    api, _, _ = client
    response = api.post(
        "/api/resumes", files={"file": ("too-big.pdf", b"a" * (8 * 1024 * 1024 + 1))}
    )
    assert response.status_code == 413


def test_empty_pdf_without_text(client):
    api, _, _ = client
    document = fitz.open()
    document.new_page()
    raw = document.tobytes()
    document.close()
    response = api.post("/api/resumes", files={"file": ("scan.pdf", raw)})
    assert response.status_code == 422
    assert "扫描版" in response.json()["detail"]


def test_file_path_traversal_is_not_used(client):
    api, temp_dir, _ = client
    response = api.post(
        "/api/resumes", files={"file": ("../../somebody.docx", docx_bytes("项目经历\n系统开发"))}
    )
    assert response.status_code == 201
    assert response.json()["original_filename"] == "somebody.docx"
    assert not (temp_dir / "somebody.docx").exists()
