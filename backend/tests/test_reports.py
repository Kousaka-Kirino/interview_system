"""Stage 4 测试：不联网、不需要 DeepSeek Key。"""

from uuid import uuid4

import pytest

from fastapi.testclient import TestClient

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, get_db
from app.main import app

from app.models.report import InterviewAIReport
from app.models.resume import Resume

from app.models.session import (
    InterviewSession,
    InterviewTurn,
)

from app.services.deepseek_interview import (
    InterviewLLMError,
    get_interview_llm,
)

class FakeLLM:

    def __init__(self):
        self.calls = 0
        self.fail = False

    def _complete_json(
        self,
        system,
        user,
    ):

        self.calls += 1

        if self.fail:
            raise InterviewLLMError(
                "模拟 API 失败"
            )

        return {
            "summary": (
                "本次回答整体清晰，"
                "但还应说明关键技术取舍。"
            ),
            "strengths": [
                "能解释基础架构"
            ],
            "improvements": [
                "进一步量化项目结果"
            ],
            "next_steps": [
                "准备项目方案对比"
            ],
        }

@pytest.fixture
def client(
    tmp_path,
    monkeypatch,
):

    engine = create_engine(
        (
            "sqlite:///"
            + (tmp_path / "reports.db").as_posix()
        ),
        connect_args={
            "check_same_thread": False
        },
    )

    Base.metadata.create_all(engine)

    factory = sessionmaker(
        bind=engine,
        expire_on_commit=False,
    )

    rid = str(uuid4())
    done_id = str(uuid4())
    active_id = str(uuid4())
    empty_id = str(uuid4())

    with factory() as db:

        db.add(
            Resume(
                id=rid,
                original_filename="resume.docx",
                stored_filename="test-r.docx",
                file_size=10,
                full_text="Python FastAPI",
                structured_data={},
            )
        )

        for sid, status in [
            (done_id, "completed"),
            (active_id, "active"),
            (empty_id, "completed"),
        ]:

            s = InterviewSession(
                id=sid,
                resume_id=rid,
                material_ids=[],
                config_data={
                    "reviewer_style": "neutral",
                    "question_count": 3,
                },
                status=status,
                current_difficulty=3,
                main_questions_asked=2,
                followups_used=0,
                positive_streak=0,
                negative_streak=0,
            )

            if sid == done_id:

                s.turns.extend(
                    [
                        InterviewTurn(
                            question_number=1,
                            followup_number=0,
                            difficulty=2,
                            question="怎样设计缓存？",
                            answer="Redis+TTL",
                            score=90,
                            feedback="回答不错",
                        ),

                        InterviewTurn(
                            question_number=2,
                            followup_number=0,
                            difficulty=3,
                            question="解释数据库索引",
                            answer="使用B树",
                            score=40,
                            feedback="缺少设计分析",
                        ),

                        InterviewTurn(
                            question_number=2,
                            followup_number=1,
                            difficulty=3,
                            question=(
                                "索引为什么不适合所有列？"
                            ),
                            answer=None,
                        ),
                    ]
                )

            elif sid == active_id:

                s.turns.append(
                    InterviewTurn(
                        question_number=1,
                        followup_number=0,
                        difficulty=3,
                        question="怎么设计API?",
                    )
                )

            else:

                s.turns.append(
                    InterviewTurn(
                        question_number=1,
                        followup_number=0,
                        difficulty=3,
                        question="简述项目",
                    )
                )

            db.add(s)

        db.commit()

    def override_db():

        with factory() as db:
            yield db

    llm = FakeLLM()

    # 不初始化正式数据库
    monkeypatch.setattr(
        "app.main.init_db",
        lambda: None,
    )

    app.dependency_overrides[get_db] = (
        override_db
    )

    app.dependency_overrides[get_interview_llm] = (
        lambda: llm
    )

    with TestClient(app) as api:

        yield (
            api,
            done_id,
            active_id,
            empty_id,
            llm,
            factory,
        )

    app.dependency_overrides.clear()

    engine.dispose()

def test_history_filters_and_paging(client):

    api, done, active, empty, _, _ = client

    res = api.get(
        "/api/interviews/history?limit=2&offset=0"
    )

    assert res.status_code == 200

    assert res.json()["total"] == 3

    assert len(
        res.json()["items"]
    ) == 2

    res = api.get(
        "/api/interviews/history"
        "?status=completed&limit=10"
    )

    assert res.status_code == 200

    assert res.json()["total"] == 2

    by_id = {
        x["id"]: x
        for x in res.json()["items"]
    }

    assert (
        by_id[done]["answered_count"]
        == 2
    )

    assert (
        by_id[done]["average_score"]
        == 65
    )

    assert (
        by_id[empty]["average_score"]
        is None
    )

    assert api.get(
        "/api/interviews/history?limit=101"
    ).status_code == 422

    assert api.get(
        "/api/interviews/history?status=garbage"
    ).status_code == 422

def test_global_statistics(client):

    api, *_ = client

    r = api.get(
        "/api/interviews/statistics"
    )

    assert r.status_code == 200

    stats = r.json()

    assert stats == {
        "total_sessions": 3,
        "active_sessions": 1,
        "completed_sessions": 2,
        "answered_turns": 2,
        "average_score": 65.0,
    }

def test_offline_report_skips_unanswered(client):

    api, done, *_ = client

    r = api.get(
        f"/api/interviews/{done}/report"
    )

    assert r.status_code == 200, r.text

    data = r.json()

    assert data["average_score"] == 65

    assert data["answered_count"] == 2

    assert data["unanswered_count"] == 1

    assert len(data["turns"]) == 2

    assert len(data["score_trend"]) == 2

    assert data["ai_analysis"] is None

    assert "第1题" in data["strengths"][0]

    assert "第2题" in data["improvements"][0]

def test_active_missing_and_empty_completed(client):

    api, done, active, empty, _, _ = client

    assert api.get(
        f"/api/interviews/{active}/report"
    ).status_code == 409

    assert api.get(
        "/api/interviews/no-such-id/report"
    ).status_code == 404

    result = api.get(
        f"/api/interviews/{empty}/report"
    )

    assert result.status_code == 200

    assert (
        result.json()["average_score"]
        is None
    )

    assert (
        result.json()["answered_count"]
        == 0
    )

    assert api.post(
        f"/api/interviews/{empty}/report/ai"
    ).status_code == 422

def test_ai_report_cache_and_refresh(client):

    api, done, _, _, llm, factory = client

    endpoint = (
        f"/api/interviews/{done}/report/ai"
    )

    result = api.post(endpoint)

    assert result.status_code == 200, result.text

    assert (
        result.json()["ai_analysis"]["strengths"]
        == ["能解释基础架构"]
    )

    assert llm.calls == 1

    # 第二次请求复用缓存
    assert api.post(
        endpoint
    ).status_code == 200

    assert llm.calls == 1

    # 普通 GET 也能读取 AI 缓存
    assert api.get(
        f"/api/interviews/{done}/report"
    ).json()["ai_analysis"] is not None

    # 显式刷新才再次调用模型
    assert api.post(
        endpoint + "?refresh=true"
    ).status_code == 200

    assert llm.calls == 2

    with factory() as db:

        assert db.get(
            InterviewAIReport,
            done,
        ) is not None

def test_ai_error_leaves_offline_report_intact(client):

    api, done, _, _, llm, _ = client

    llm.fail = True

    assert api.post(
        f"/api/interviews/{done}/report/ai"
    ).status_code == 503

    r = api.get(
        f"/api/interviews/{done}/report"
    )

    assert r.status_code == 200

    assert r.json()["ai_analysis"] is None

    assert r.json()["average_score"] == 65

def test_ai_invalid_response_is_503(
    client,
    monkeypatch,
):

    api, done, _, _, llm, _ = client

    monkeypatch.setattr(
        llm,
        "_complete_json",
        lambda *a: {
            "summary": "bad"
        },
    )

    assert api.post(
        f"/api/interviews/{done}/report/ai"
    ).status_code == 503

def test_existing_stage3_routes_still_work(client):

    api, done, *_ = client

    r = api.get(
        f"/api/interviews/{done}"
    )

    assert r.status_code == 200

    assert r.json()["id"] == done