"""No account DB, network access, or real LLM. All data is temporary."""
from uuid import uuid4
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base, get_db
from app.api.sessions import router as sessions_router
from app.api.reports import router as reports_router
from app.api.resumes import router as resumes_router
from app.models.resume import Resume
from app.models.material import Material
from app.models.session import InterviewSession
from app.models.report import InterviewAIReport  # noqa: F401
from app.services.vector_store import get_vector_store
from app.services.deepseek_interview import get_interview_llm, GradeResult, InterviewLLMError
from app.stage11_local import get_user_settings
from app.stage8b_auth import require_owner_id
from app.schemas.material import MaterialHit


class FakeLLM:
    def __init__(self):
        self.question_calls=[]
        self.grade_calls=[]
        self.opening_calls=[]
        self.fail=False
    def generate_question(self, **kwargs):
        self.question_calls.append(kwargs)
        if self.fail: raise InterviewLLMError('LLM 不可用')
        return '请解释你的项目评价指标如何得出？'
    def _complete_json(self, system, user, **kwargs):
        self.opening_calls.append((system, user))
        if self.fail: raise InterviewLLMError('LLM 不可用')
        return {'summary':'项目陈述有清晰目标','strengths':['重点明确'],
                'improvements':['补充对比实验'],
                'followup_question':'根据PPT实验结果，你陈述的误差4.2%如何计算？'}
    def grade_answer(self, **kwargs):
        self.grade_calls.append(kwargs)
        return GradeResult(score=77, feedback='需要补充实验论据')


class FakeStore:
    def __init__(self):
        self.calls=[]
        self.empty=False
    def search(self, query, ids, n):
        self.calls.append((query, ids))
        if self.empty: return []
        return [MaterialHit(material_id=ids[0], original_filename='我的答辩PPT_PPTX文字提取版.docx',
                            chunk_index=2,text='本项目使用Python实现对比实验，实验误差4.2%，样本数500。',distance=.25)]


@pytest.fixture
def env(tmp_path):
    engine=create_engine(f'sqlite:///{tmp_path/"isolated.sqlite"}',connect_args={'check_same_thread':False})
    Base.metadata.create_all(engine)
    factory=sessionmaker(bind=engine,expire_on_commit=False)
    resume_id=str(uuid4());material_id=str(uuid4())
    with factory() as db:
        db.add(Resume(id=resume_id,original_filename='real.docx',stored_filename='real.docx',file_size=1,
                      full_text='真实的技术简历',structured_data={}))
        db.add(Material(id=material_id,original_filename='我的答辩PPT_PPTX文字提取版.docx',
                        stored_filename='pptx-export.docx',file_size=1000,chunk_count=4))
        db.commit()
    model=FakeLLM();store=FakeStore()
    app=FastAPI();app.include_router(reports_router);app.include_router(sessions_router);app.include_router(resumes_router)
    def scoped():
        with factory() as db:yield db
    app.dependency_overrides[get_db]=scoped
    app.dependency_overrides[get_user_settings]=lambda:SimpleNamespace(uploads_dir=tmp_path/"uploads")
    app.dependency_overrides[get_interview_llm]=lambda:model
    app.dependency_overrides[get_vector_store]=lambda:store
    app.dependency_overrides[require_owner_id]=lambda:'test-user'
    with TestClient(app) as client:
        yield client,factory,model,store,resume_id,material_id
    engine.dispose()


def test_legacy_request_defaults_to_interview_and_requires_resume(env):
    client,db,model,store,resume,material=env
    r=client.post('/api/interviews',json={'resume_id':resume})
    assert r.status_code==201,r.text
    assert r.json()['mode']=='interview'
    assert model.question_calls[-1]['mode']=='interview'
    assert client.post('/api/interviews',json={}).status_code==404


def test_defense_requires_materials_not_resume(env):
    client,db,model,store,resume,material=env
    missing=client.post('/api/interviews',json={'mode':'defense'})
    assert missing.status_code==422
    wrong=client.post('/api/interviews',json={'mode':'defense','material_ids':[str(uuid4())]})
    assert wrong.status_code==404
    assert not model.question_calls
    ok=client.post('/api/interviews',json={'mode':'defense','material_ids':[material],
                                          'config':{'question_count':3,'max_followups':0}})
    assert ok.status_code==201,ok.text
    obj=ok.json()
    assert obj['mode']=='defense' and obj['resume_id']!=resume
    assert not model.question_calls and not model.opening_calls
    assert obj['turns'] == [] and obj['main_questions_asked'] == 0
    assert obj['opening_required'] is True and obj['opening_completed'] is False
    with db() as session:
        created=session.get(InterviewSession,obj['id'])
        assert created.config_data['practice_mode']=='defense'
        internal=session.get(Resume,created.resume_id)
        assert internal.structured_data['_internal_defense_context'] is True
    resumes=client.get('/api/resumes')
    assert resumes.status_code==200
    assert len(resumes.json())==1 and resumes.json()[0]['id']==resume
    assert client.get('/api/resumes/'+obj['resume_id']).status_code==404
    assert client.delete('/api/resumes/'+obj['resume_id']).status_code==404
    # No submission is possible without the opening statement.
    assert client.post(f"/api/interviews/{obj['id']}/answer",
        json={'turn_id': 1, 'answer': '尝试提前作答'}).status_code == 409
    opening_text = '本研究使用五百份样本开展对比实验，汇报了误差计算方法与基线差异，并提出改进方案。'
    generated=client.post(f"/api/interviews/{obj['id']}/opening", json={'text': opening_text})
    assert generated.status_code == 200, generated.text
    assert len(model.opening_calls) == 1 and '实验误差4.2%' in model.opening_calls[0][1]
    updated=client.get('/api/interviews/'+obj['id']).json()
    assert updated['opening_completed'] is True and updated['main_questions_asked'] == 1
    assert len(updated['turns']) == 1
    turn=updated['turns'][0]
    answer=client.post(f"/api/interviews/{obj['id']}/answer",json={'turn_id':turn['id'],'answer':'通过500个样本验证。'})
    assert answer.status_code==200,answer.text
    assert model.grade_calls[-1]['mode']=='defense'
    assert client.get('/api/interviews/'+obj['id']).json()['mode']=='defense'
    client.post(f"/api/interviews/{obj['id']}/finish")
    report=client.get(f"/api/interviews/{obj['id']}/report")
    assert report.status_code==200 and report.json()['mode']=='defense'


def test_defense_missing_index_text_fail_closed_without_paid_call(env):
    client,db,model,store,_,material=env
    store.empty=True
    result=client.post('/api/interviews',json={'mode':'defense','material_ids':[material]})
    assert result.status_code==422
    assert not model.question_calls
    with db() as session:
        assert session.query(InterviewSession).count()==0
        assert session.query(Resume).count()==1


def test_model_error_keeps_defense_in_opening_stage(env):
    client,db,model,store,_,material=env
    model.fail=True
    created=client.post('/api/interviews',json={'mode':'defense','material_ids':[material]})
    assert created.status_code==201,created.text
    sid=created.json()['id']
    assert model.question_calls == []
    failed=client.post(f'/api/interviews/{sid}/opening',json={
        'text':'这次项目研究以实际数据为基础，使用多个算法做对照，并对结果和改进空间做了总结。'})
    assert failed.status_code==503
    read=client.get(f'/api/interviews/{sid}').json()
    assert read['turns']==[] and not read['opening_completed']
    with db() as session:
        saved=session.get(InterviewSession,sid)
        assert saved.main_questions_asked==0
        assert not saved.config_data.get('opening_analysis')


def test_mode_validation_and_existing_resume_restriction(env):
    client,db,model,store,resume,material=env
    assert client.post('/api/interviews',json={'mode':'unknown','resume_id':resume}).status_code==422
    assert client.post('/api/interviews',json={'mode':'interview','resume_id':str(uuid4())}).status_code==404
    with db() as session:
        session.get(Material,material).chunk_count=0
        session.commit()
    assert client.post('/api/interviews',json={'mode':'defense','material_ids':[material]}).status_code==422
    assert model.question_calls==[]


def test_defense_draft_can_reuse_materials_no_resume(env):
    client,db,model,store,_,material=env
    first=client.post('/api/interviews',json={'mode':'defense','material_ids':[material]}).json()
    client.post('/api/interviews/'+first['id']+'/finish')
    history=client.get('/api/interviews/history')
    assert history.status_code==200
    assert history.json()['items'][0]['mode']=='defense'
    second=client.post('/api/interviews',json={'mode':'defense','material_ids':[material]})
    assert second.status_code==201
    assert second.json()['id']!=first['id']
