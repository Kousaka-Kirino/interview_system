"""Group 8: paid AI review remains opt-in; examples and notes are anchored and deduplicated."""
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.reports import router as reports_router
from app.core.database import Base, get_db
from app.models.material import Material  # noqa: F401
from app.models.report import InterviewAIReport
from app.models.resume import Resume
from app.models.session import InterviewSession, InterviewTurn
from app.schemas.report import InterviewReportView
from app.services.ai_study_points import save_weak_points
from app.services.deepseek_interview import InterviewLLMError, get_interview_llm
from app.services.report_ai import create_ai_analysis
from app.stage8b_auth import require_owner_id


def report():
    return InterviewReportView.model_validate({
        "session_id": "test-session", "status": "completed", "reviewer_style": "neutral",
        "planned_main_questions": 3, "main_questions_asked": 2, "answered_count": 2,
        "unanswered_count": 0, "average_score": 66,
        "score_trend": [], "strengths": [], "improvements": [], "suggestions": [],
        "turns": [
            {"turn_id": 5, "question_number": 1, "followup_number": 0, "difficulty": 3,
             "question": "描述你项目中的数据采集方法？", "answer": "用了爬虫。", "score": 54,
             "feedback": "没有解释数据质量控制"},
            {"turn_id": 6, "question_number": 2, "followup_number": 0, "difficulty": 3,
             "question": "解释你的架构选择？", "answer": "用了一种架构。", "score": 82,
             "feedback": "表达基本完整"},
        ],
    })


class FakeLLM:
    def __init__(self):
        self.calls = 0
    def _complete_json(self, system, user, *, max_tokens=700):
        self.calls += 1
        assert "JSON" in system
        assert max_tokens >= 2500
        return {
            "summary": "部分回答缺少证据", "strengths": ["架构选择有依据"],
            "improvements": ["数据质量控制缺少细节"], "next_steps": ["补充验证过程"],
            "example_answers": [
                {"turn_id": 5, "answer": "我会先交代数据来源，再说明清洗标准和抽样校验方法，并使用【需要补充真实数据】补足结果。", "explanation": "具体可验证"},
                {"turn_id": 999, "answer": "这个题目不存在，因此不应纳入生成后的报告，避免凭空编造内容。", "explanation": "需要过滤"},
            ],
            "weak_points": [
                {"turn_id": 5, "title": "缺乏数据验证", "reason": "没有说明采样质量", "dimension": "数据证据"},
                {"turn_id": 6, "title": "优秀题不应自动标成弱点", "reason": "评分已达82", "dimension": "研究方法"},
                {"turn_id": 999, "title": "不存在的题", "reason": "不应保存", "dimension": "答辩表达"},
            ],
        }


def test_ai_output_validated_and_grounded():
    llm = FakeLLM()
    result = create_ai_analysis(llm, report())
    assert llm.calls == 1
    assert [a.turn_id for a in result.example_answers] == [5]
    assert [w.turn_id for w in result.weak_points] == [5]
    assert result.example_answers[0].answer.count("【需要补充真实数据】") == 1


def test_invalid_json_rejected_without_inserting_notes():
    class Malformed:
        def _complete_json(self, *args, **kwargs):
            return {"summary": ""}
    with pytest.raises(InterviewLLMError):
        create_ai_analysis(Malformed(), report())


def test_study_points_are_scoped_and_deduplicated(tmp_path, monkeypatch):
    import app.stage7_review as study
    monkeypatch.setattr(study, "_db_path", lambda: tmp_path / "review.sqlite3")
    # ai_study_points imports the database context manager, which calls stage7._db_path at runtime.
    result = create_ai_analysis(FakeLLM(), report())
    assert save_weak_points("alice", report(), result) == 1
    assert save_weak_points("alice", report(), result) == 0
    assert save_weak_points("bob", report(), result) == 1
    with study._database() as db:
        rows = db.execute("SELECT user_id, source_text, quote FROM study_knowledge_points ORDER BY user_id").fetchall()
    assert [r["user_id"] for r in rows] == ["alice", "bob"]
    assert all(r["quote"] in r["source_text"] for r in rows)
    assert all("数据采集方法" in r["source_text"] for r in rows)


def test_cached_report_does_not_recall_llm_and_stores_points(tmp_path, monkeypatch):
    import app.stage7_review as study
    monkeypatch.setattr(study, "_db_path", lambda: tmp_path / "review.sqlite3")
    engine = create_engine(f"sqlite:///{tmp_path / 'account.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(Resume(id="resume", original_filename="test.docx", stored_filename="test.docx", file_size=1, full_text="简历", structured_data={}))
        db.add(InterviewSession(id="session", resume_id="resume", material_ids=[], config_data={"reviewer_style": "neutral", "question_count": 3},
            status="completed", current_difficulty=3, main_questions_asked=1, followups_used=0, positive_streak=0, negative_streak=0))
        db.flush()
        db.add(InterviewTurn(session_id="session", question_number=1, followup_number=0, difficulty=3,
           question="请解释数据清洗方法", answer="我没有校验。", score=45, feedback="缺少过程"))
        db.commit()
    class Stub:
        calls = 0
        def _complete_json(self, *args, **kwargs):
            self.calls += 1
            return {
                "summary": "需要补充", "strengths": ["继续练习"], "improvements": ["验证细节"], "next_steps": ["补充过程"],
                "example_answers": [{"turn_id": 1, "answer": "首先介绍数据清洗流程，然后使用真实数据说明验证效果。", "explanation": "明确依据"}],
                "weak_points": [{"turn_id": 1, "title": "验证不足", "reason": "缺乏校验步骤", "dimension": "数据证据"}],
            }
    stub = Stub()
    app = FastAPI()
    app.include_router(reports_router)
    def db_override():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[require_owner_id] = lambda: "alice"
    app.dependency_overrides[get_interview_llm] = lambda: stub
    with TestClient(app) as client:
        first = client.post('/api/interviews/session/report/ai')
        assert first.status_code == 200, first.text
        assert len(first.json()['ai_analysis']['example_answers']) == 1
        again = client.post('/api/interviews/session/report/ai')
        assert again.status_code == 200, again.text
        assert stub.calls == 1
        with study._database() as db:
            assert db.execute("SELECT count(*) FROM study_knowledge_points WHERE user_id='alice'").fetchone()[0] == 1
    engine.dispose()
