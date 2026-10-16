"""Stage 3：临时 SQLite + 模拟 DeepSeek/RAG 测试。"""

import json

from types import SimpleNamespace
from uuid import uuid4

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.core.database import Base, get_db
from app.main import app

from app.models.material import Material
from app.models.resume import Resume

from app.models.session import (
    InterviewSession,
    InterviewTurn,
)

from app.schemas.material import MaterialHit

from app.services.deepseek_interview import (
    GradeResult,
    InterviewLLM,
    InterviewLLMError,
    get_interview_llm,
)

from app.services.vector_store import get_vector_store

class FakeLLM:

    def __init__(self):
        self.grades = []
        self.generated = []
        self.fail_question = False
        self.fail_grade = False

    def generate_question(self, **kwargs):

        if self.fail_question:
            raise InterviewLLMError("生成失败")

        self.generated.append(kwargs)

        return (
            f"第{kwargs['question_number']}题，"
            f"追问{kwargs['followup_number']}："
            "介绍一下你的项目实现细节？"
        )

    def grade_answer(self, **kwargs):

        if self.fail_grade:
            raise InterviewLLMError("评分失败")

        score = (
            self.grades.pop(0)
            if self.grades
            else 90
        )

        return GradeResult(
            score=score,
            feedback="解释清晰，可补充量化指标",
        )

class FakeVectors:

    def __init__(self):
        self.calls = []
        self.fail = False

    def search(
        self,
        query,
        material_ids,
        top_k,
    ):

        if self.fail:
            raise RuntimeError("Chroma error")

        self.calls.append(
            (query, material_ids, top_k)
        )

        return [
            MaterialHit(
                material_id=material_ids[0],
                original_filename="材料.docx",
                chunk_index=1,
                text="项目使用 FastAPI 和 SQLite",
                distance=0.2,
            )
        ]

@pytest.fixture
def client(tmp_path, monkeypatch):

    engine = create_engine(
        f"sqlite:///{(tmp_path / 'session.db').as_posix()}",
        connect_args={
            "check_same_thread": False
        },
    )

    Base.metadata.create_all(engine)

    factory = sessionmaker(
        bind=engine,
        expire_on_commit=False,
    )

    resume_id = str(uuid4())
    material_id = str(uuid4())

    with factory() as db:

        db.add(
            Resume(
                id=resume_id,
                original_filename="简历.docx",
                stored_filename="r.docx",
                file_size=256,
                full_text=(
                    "负责Python项目开发，"
                    "使用FastAPI和数据库"
                ),
                structured_data={"name": "测试"},
            )
        )

        db.add(
            Material(
                id=material_id,
                original_filename="材料.docx",
                stored_filename="m.docx",
                file_size=200,
                chunk_count=1,
            )
        )

        db.commit()

    def override_db():

        with factory() as db:
            yield db

    llm = FakeLLM()
    vectors = FakeVectors()

    monkeypatch.setattr(
        "app.main.init_db",
        lambda: None,
    )

    app.dependency_overrides[get_db] = override_db

    app.dependency_overrides[get_interview_llm] = (
        lambda: llm
    )

    app.dependency_overrides[get_vector_store] = (
        lambda: vectors
    )

    with TestClient(app) as api:
        yield (
            api,
            resume_id,
            material_id,
            llm,
            vectors,
            factory,
        )

    app.dependency_overrides.clear()
    engine.dispose()

def start(
    api,
    resume_id,
    material_ids=None,
    config=None,
):

    return api.post(
        "/api/interviews",
        json={
            "resume_id": resume_id,
            "material_ids": material_ids or [],
            "config": config or {
                "question_count": 3,
                "max_followups": 1,
            },
        },
    )

def reply(
    api,
    data,
    answer="我完成了Python后端，实现数据存储",
    feedback="none",
):

    pending = data["turns"][-1]

    return api.post(
        f"/api/interviews/{data['id']}/answer",
        json={
            "turn_id": pending["id"],
            "answer": answer,
            "user_feedback": feedback,
        },
    )

def test_full_flow_and_persistence(client):

    api, resume_id, _, llm, _, factory = client

    response = start(api, resume_id)

    assert response.status_code == 201, response.text

    data = response.json()

    assert data["status"] == "active"
    assert len(data["turns"]) == 1
    assert data["turns"][0]["answer"] is None

    session_id = data["id"]

    first = reply(api, data)

    assert first.status_code == 200, first.text

    data = first.json()["session"]

    assert data["current_difficulty"] == 3
    assert data["positive_streak"] == 1
    assert data["main_questions_asked"] == 2

    second = reply(api, data)

    assert second.status_code == 200, second.text

    data = second.json()["session"]

    assert data["current_difficulty"] == 4
    assert data["main_questions_asked"] == 3

    third = reply(api, data)

    assert third.status_code == 200, third.text

    data = third.json()["session"]

    assert data["status"] == "completed"
    assert len(data["turns"]) == 3

    saved = api.get(
        f"/api/interviews/{session_id}"
    ).json()

    assert saved["turns"][-1]["score"] == 90

    assert reply(api, data).status_code == 409

    with factory() as db:

        assert (
            db.get(InterviewSession, session_id).status
            == "completed"
        )

        assert (
            db.query(InterviewTurn)
            .filter_by(session_id=session_id)
            .count()
            == 3
        )

def test_followup_and_feedback_priority(client):

    api, resume_id, _, llm, _, _ = client

    llm.grades = [35, 90]

    data = start(
        api,
        resume_id,
        config={
            "question_count": 3,
            "max_followups": 2,
            "adaptation_level": 0,
            "initial_difficulty": 3,
        },
    ).json()

    first = reply(
        api,
        data,
        feedback="too_easy",
    )

    assert first.status_code == 200

    data = first.json()["session"]

    assert data["current_difficulty"] == 4
    assert data["turns"][-1]["followup_number"] == 1
    assert data["main_questions_asked"] == 1

    second = reply(api, data)

    assert second.status_code == 200

    data = second.json()["session"]

    assert data["turns"][-1]["followup_number"] == 0
    assert data["main_questions_asked"] == 2

def test_missing_resume_and_material(client):

    api, resume_id, _, _, _, _ = client

    assert start(
        api,
        str(uuid4()),
    ).status_code == 404

    result = start(
        api,
        resume_id,
        material_ids=["missing"],
    )

    assert result.status_code == 404

def test_rag_selected_and_no_material_avoids_search(client):

    api, resume_id, material_id, llm, vectors, _ = client

    assert start(api, resume_id).status_code == 201
    assert vectors.calls == []

    result = start(
        api,
        resume_id,
        material_ids=[
            material_id,
            material_id,
        ],
    )

    assert result.status_code == 201

    assert result.json()["material_ids"] == [
        material_id
    ]

    assert vectors.calls[0][1] == [material_id]

    assert llm.generated[-1]["evidence"]

def test_stale_turn_and_blank_answer(client):

    api, resume_id, _, _, _, _ = client

    data = start(api, resume_id).json()

    url = (
        f"/api/interviews/{data['id']}/answer"
    )

    result = api.post(
        url,
        json={
            "turn_id": data["turns"][0]["id"],
            "answer": "  ",
        },
    )

    assert result.status_code == 422

    good = reply(api, data)

    assert good.status_code == 200

    assert reply(api, data).status_code == 409

    assert api.post(
        url,
        json={
            "turn_id": 999,
            "answer": "xxx",
        },
    ).status_code == 409

def test_llm_failure_no_partial_save(client):

    api, resume_id, _, llm, _, _ = client

    llm.fail_question = True

    assert start(
        api,
        resume_id,
    ).status_code == 503

    llm.fail_question = False

    data = start(api, resume_id).json()

    llm.fail_grade = True

    assert reply(api, data).status_code == 503

    saved = api.get(
        f"/api/interviews/{data['id']}"
    ).json()

    assert saved["turns"][0]["answer"] is None

    llm.fail_grade = False
    llm.fail_question = True

    assert reply(api, data).status_code == 503

    saved = api.get(
        f"/api/interviews/{data['id']}"
    ).json()

    assert saved["turns"][0]["answer"] is None

def test_rag_unavailable_blocks_new_session(client):

    api, resume_id, material_id, _, vectors, _ = client

    vectors.fail = True

    assert start(
        api,
        resume_id,
        [material_id],
    ).status_code == 503

def test_manual_finish_idempotent(client):

    api, resume_id, _, _, _, _ = client

    data = start(api, resume_id).json()

    url = (
        f"/api/interviews/{data['id']}/finish"
    )

    assert api.post(url).json()["status"] == "completed"

    assert api.post(url).json()["status"] == "completed"

    assert reply(api, data).status_code == 409

    assert api.get(
        "/api/interviews/unknown"
    ).status_code == 404

def test_config_validation(client):

    api, resume_id, _, _, _, _ = client

    assert start(
        api,
        resume_id,
        config={
            "question_count": 2
        },
    ).status_code == 422

def test_deepseek_json_contract_without_network():

    seen = {}

    def fake_create(**kwargs):

        seen.update(kwargs)

        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    message=SimpleNamespace(
                        content=json.dumps({
                            "question": (
                                "请描述一个完整的技术项目"
                                "和其中的取舍？"
                            )
                        })
                    ),
                )
            ]
        )

    client = InterviewLLM(
        Settings(
            _env_file=None,
            deepseek_api_key="dummy",
        )
    )

    client._client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=fake_create
            )
        )
    )

    question = client.generate_question(
        resume_text="简历",
        evidence=[],
        previous=[],
        style="neutral",
        difficulty=3,
        question_number=1,
        followup_number=0,
    )

    assert "技术项目" in question

    assert seen["response_format"] == {
        "type": "json_object"
    }

    assert seen["extra_body"] == {
        "thinking": {
            "type": "disabled"
        }
    }

def test_deepseek_no_key_rejected_before_network():

    client = InterviewLLM(
        Settings(
            _env_file=None,
            deepseek_api_key="",
        )
    )

    with pytest.raises(
        InterviewLLMError,
        match="DEEPSEEK_API_KEY",
    ):

        client.generate_question(
            resume_text="简历",
            evidence=[],
            previous=[],
            style="neutral",
            difficulty=3,
            question_number=1,
            followup_number=0,
        )