"""Stage 22: real targeted practice, safe review cache, per-account SQLite.
Tests use tmp_path DB + fake LLM, never a user database or paid API.
"""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.sessions import router as sessions_router
from app.api.reports import router as reports_router
from app.core.database import Base, get_db
from app.models.resume import Resume
from app.models.material import Material  # noqa: F401
from app.models.session import InterviewSession, InterviewTurn
from app.models.report import InterviewAIReport
from app.services.deepseek_interview import get_interview_llm, GradeResult
from app.services.vector_store import get_vector_store
from app.stage8b_auth import require_owner_id
from app.services.focus_practice import resolve_focus
from app.services.review_lock import review_lock


class DummyModel:
    def __init__(self):
        self.calls = []
    def generate_question(self, **kwargs):
        self.calls.append(kwargs)
        return "请结合真实实验数据解释你的数据验证策略？"
    def grade_answer(self, **kwargs):
        return GradeResult(score=83, feedback="已给出验证依据")


class EmptyStore:
    def search(self, *a):
        raise AssertionError("没有选择资料，不应检索")


@pytest.fixture
def api(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'user.sqlite3'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    fake = DummyModel()
    source_id = str(uuid4())
    resume_id = str(uuid4())
    with factory() as db:
        db.add(Resume(id=resume_id, original_filename="resume.docx", stored_filename="resume.docx", file_size=1,
                      full_text="Python 数据项目与数据验证实践", structured_data={}))
        db.add(InterviewSession(id=source_id, resume_id=resume_id, material_ids=[],
                                config_data={"reviewer_style":"neutral","question_count":3,"max_followups":0},
                                status="completed",current_difficulty=3,main_questions_asked=2,followups_used=0,
                                positive_streak=0,negative_streak=0))
        db.flush()
        low = InterviewTurn(session_id=source_id, question_number=1, followup_number=0,
                            difficulty=3, question="如何验证数据可靠性？", answer="不知道",score=48,feedback="缺少验证方法")
        high = InterviewTurn(session_id=source_id, question_number=2, followup_number=0,
                             difficulty=3, question="你如何管理接口？", answer="进行了自动化测试",score=89,feedback="有证据")
        db.add_all([low,high]);db.flush()
        low_id,high_id=low.id,high.id
        db.add(InterviewAIReport(session_id=source_id,analysis={
            "summary":"本场有明显提升空间","strengths":["有部分正确思路"],
            "improvements":["验证步骤不足"],"next_steps":["补充实验数据"],
            "weak_points":[
                {"turn_id":low_id,"title":"证据不足","reason":"没有验证过程","dimension":"数据证据"},
                {"turn_id":low_id,"title":"证据不足","reason":"重复建议","dimension":"数据证据"},
                {"turn_id":high_id,"title":"不应该关注高分题","reason":"此题已得高分","dimension":"答辩表达"},
            ],"example_answers":[],
        }))
        db.commit()
    app=FastAPI();app.include_router(sessions_router);app.include_router(reports_router)
    def get_test_db():
        with factory() as db: yield db
    app.dependency_overrides[get_db]=get_test_db
    app.dependency_overrides[get_interview_llm]=lambda:fake
    app.dependency_overrides[get_vector_store]=lambda:EmptyStore()
    app.dependency_overrides[require_owner_id]=lambda:"owner-A"
    with TestClient(app) as client:
        yield client,fake,factory,source_id,resume_id,low_id
    engine.dispose()


def test_focus_is_server_validated_and_anchored_to_low_score(api):
    client, fake, factory, source, resume, low_id = api
    created=client.post('/api/interviews',json={"resume_id":resume,"material_ids":[],
        "config":{"question_count":3,"max_followups":0},"focus_session_id":source})
    assert created.status_code==201, created.text
    obj=created.json()
    focus=obj['practice_focus']
    assert focus['source_session_id']==source
    assert focus['weak_points']==[{"dimension":"数据证据","title":"证据不足","reason":"没有验证过程"}]
    assert fake.calls[0]['focus_points']==focus['weak_points']
    with factory() as db:
        saved=db.get(InterviewSession,obj['id'])
        assert saved.config_data['practice_focus']==focus
        assert db.get(InterviewSession,source).status=='completed'
    turn=obj['turns'][0]
    answered=client.post(f"/api/interviews/{obj['id']}/answer",json={"turn_id":turn['id'],"answer":"我会使用真实数据进行交叉检验并记录指标。","user_feedback":"none"})
    assert answered.status_code==200,answered.text
    assert fake.calls[-1]['focus_points']==focus['weak_points']
    finished=client.post(f"/api/interviews/{obj['id']}/finish")
    assert finished.status_code==200
    report=client.get(f"/api/interviews/{obj['id']}/report")
    assert report.status_code==200
    assert report.json()['practice_focus']==focus


def test_missing_cached_review_or_no_grounded_weakness_prevents_paid_new_session(api):
    client, fake, factory, source, resume, _ = api
    with factory() as db:
        db.delete(db.get(InterviewAIReport,source));db.commit()
    r=client.post('/api/interviews',json={"resume_id":resume,"focus_session_id":source})
    assert r.status_code==409
    assert len(fake.calls)==0
    with factory() as db:
        assert db.query(InterviewSession).count()==1


def test_wrong_resume_and_source_rejected(api):
    client,fake,_,source,resume,_=api
    result=client.post('/api/interviews',json={"resume_id":str(uuid4()),"focus_session_id":source})
    assert result.status_code==404
    result=client.post('/api/interviews',json={"resume_id":resume,"focus_session_id":str(uuid4())})
    assert result.status_code==404
    assert fake.calls==[]


def test_normal_practice_unchanged(api):
    client,fake,_,source,resume,_=api
    r=client.post('/api/interviews',json={"resume_id":resume,"config":{"question_count":3}})
    assert r.status_code==201,r.text
    assert r.json()['practice_focus'] is None
    assert fake.calls[0]['focus_points'] is None


def test_weaknesses_do_not_leak_between_user_databases(api, tmp_path):
    _,_,_,source,resume,_=api
    engine=create_engine(f"sqlite:///{tmp_path / 'another-user.sqlite'}")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        with pytest.raises(Exception) as e:
            resolve_focus(db,source,resume)
        assert getattr(e.value,'status_code',None)==404
    engine.dispose()


def test_review_lock_serializes_same_user_session():
    import time
    events=[]
    def job(n):
        with review_lock('owner-A','session-1'):
            events.append(('enter',n))
            time.sleep(.015)
            events.append(('exit',n))
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(job,range(3)))
    assert [kind for kind,_ in events]==['enter','exit']*3
