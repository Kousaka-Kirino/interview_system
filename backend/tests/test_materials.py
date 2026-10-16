"""Stage 2 自动化测试：使用模拟向量库和临时 SQLite。"""

from io import BytesIO

import fitz
import pytest

from docx import Document
from fastapi.testclient import TestClient

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.main import app

from app.models.material import Material
from app.models.resume import Resume

from app.schemas.material import MaterialHit

from app.services.material_parser import split_text

from app.services.vector_store import get_vector_store


class FakeVectorStore:

    def __init__(self):

        self.saved = {}

        self.fail_add = False
        self.fail_delete = False

    def add_chunks(
        self,
        material_id,
        filename,
        chunks
    ):

        if self.fail_add:
            raise RuntimeError(
                "simulated index error"
            )

        self.saved[material_id] = (
            filename,
            chunks
        )

    def delete_material(
        self,
        material_id
    ):

        if self.fail_delete:
            raise RuntimeError(
                "simulated delete error"
            )

        self.saved.pop(
            material_id,
            None
        )

    def search(
        self,
        query,
        material_ids,
        top_k
    ):

        hits = []

        for material_id in material_ids:

            filename, chunks = (
                self.saved[material_id]
            )

            for index, chunk in enumerate(chunks):

                if query in chunk:

                    hits.append(
                        MaterialHit(
                            material_id=material_id,
                            original_filename=filename,
                            chunk_index=index,
                            text=chunk,
                            distance=0.1
                        )
                    )

        return hits[:top_k]


@pytest.fixture
def client(
    tmp_path,
    monkeypatch
):

    engine = create_engine(
        f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        connect_args={
            "check_same_thread": False
        }
    )

    Base.metadata.create_all(engine)

    session_factory = sessionmaker(
        bind=engine,
        expire_on_commit=False
    )

    settings = Settings(
        _env_file=None,
        upload_path=str(
            tmp_path / "uploads"
        )
    )

    vectors = FakeVectorStore()

    def override_db():

        with session_factory() as db:
            yield db

    # 避免创建或修改真实数据库
    monkeypatch.setattr(
        "app.main.init_db",
        lambda: None
    )

    app.dependency_overrides[get_db] = (
        override_db
    )

    app.dependency_overrides[get_settings] = (
        lambda: settings
    )

    app.dependency_overrides[get_vector_store] = (
        lambda: vectors
    )

    with TestClient(app) as api:

        yield (
            api,
            tmp_path,
            vectors,
            session_factory
        )

    app.dependency_overrides.clear()

    engine.dispose()


def docx_bytes(text: str) -> bytes:

    doc = Document()

    for line in text.splitlines():
        doc.add_paragraph(line)

    out = BytesIO()

    doc.save(out)

    return out.getvalue()


def pdf_bytes(text: str) -> bytes:

    doc = fitz.open()

    page = doc.new_page()

    page.insert_text(
        (72, 72),
        text
    )

    result = doc.tobytes()

    doc.close()

    return result


def upload(
    api,
    name,
    text
):

    return api.post(
        "/api/materials",
        files={
            "file": (
                name,
                docx_bytes(text)
            )
        }
    )


def test_upload_search_delete(client):

    api, tmp_path, vectors, _ = client

    uploaded = upload(
        api,
        "project.docx",
        "项目使用 FastAPI 实现了搜索服务"
    )

    assert uploaded.status_code == 201, uploaded.text

    material_id = uploaded.json()["id"]

    assert uploaded.json()["chunk_count"] >= 1

    assert len(
        api.get("/api/materials").json()
    ) == 1

    response = api.post(
        "/api/materials/search",
        json={
            "query": "FastAPI",
            "material_ids": [material_id],
            "top_k": 3
        }
    )

    assert response.status_code == 200, response.text

    assert (
        response.json()["hits"][0]["material_id"]
        == material_id
    )

    assert "FastAPI" in (
        response.json()["hits"][0]["text"]
    )

    assert api.delete(
        f"/api/materials/{material_id}"
    ).status_code == 204

    assert api.get(
        "/api/materials"
    ).json() == []

    assert material_id not in vectors.saved

    assert not list(
        (
            tmp_path
            / "uploads"
            / "materials"
        ).glob("*.docx")
    )


def test_search_only_selected_material(client):

    api, _, _, _ = client

    a = upload(
        api,
        "a.docx",
        "共有技术：Python"
    ).json()["id"]

    b = upload(
        api,
        "b.docx",
        "别的知识：Python"
    ).json()["id"]

    result = api.post(
        "/api/materials/search",
        json={
            "query": "Python",
            "material_ids": [b],
            "top_k": 5
        }
    )

    assert result.status_code == 200

    returned_ids = {
        item["material_id"]
        for item in result.json()["hits"]
    }

    assert returned_ids == {b}

    assert a != b


def test_invalid_material_id_returns_404(client):

    api, _, _, _ = client

    result = api.post(
        "/api/materials/search",
        json={
            "query": "Python",
            "material_ids": ["not-exist"]
        }
    )

    assert result.status_code == 404


def test_pdf_supported(client):

    api, _, _, _ = client

    response = api.post(
        "/api/materials",
        files={
            "file": (
                "guide.pdf",
                pdf_bytes(
                    "FastAPI documentation"
                )
            )
        }
    )

    assert response.status_code == 201, response.text


def test_invalid_upload(client):

    api, _, _, _ = client

    response = api.post(
        "/api/materials",
        files={
            "file": (
                "hack.exe",
                b"x"
            )
        }
    )

    assert response.status_code == 415

    response = api.post(
        "/api/materials",
        files={
            "file": (
                "bad.pdf",
                b"invalid"
            )
        }
    )

    assert response.status_code == 422

    response = api.post(
        "/api/materials",
        files={
            "file": (
                "huge.pdf",
                b"x" * (12 * 1024 * 1024 + 1)
            )
        }
    )

    assert response.status_code == 413


def test_index_failure_rolls_back(client):

    api, tmp_path, vectors, session_factory = client

    vectors.fail_add = True

    response = upload(
        api,
        "broken.docx",
        "数据知识"
    )

    assert response.status_code == 503

    with session_factory() as db:
        assert db.query(Material).count() == 0

    folder = (
        tmp_path
        / "uploads"
        / "materials"
    )

    assert not list(
        folder.glob("*.docx")
    )


def test_failed_index_delete_preserves_metadata(client):

    api, _, vectors, _ = client

    material_id = upload(
        api,
        "good.docx",
        "基础资料"
    ).json()["id"]

    vectors.fail_delete = True

    response = api.delete(
        f"/api/materials/{material_id}"
    )

    assert response.status_code == 503

    assert len(
        api.get("/api/materials").json()
    )