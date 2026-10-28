"""第二组端到端回归：独立测试应用 + 临时 SQLite；不触碰真实认证和 storage。"""
from io import BytesIO

import pytest
from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.resumes import router as resumes_router
from app.api.sessions import router as sessions_router
from app.core.config import Settings
from app.core.database import Base, get_db
from app.models.resume import Resume
from app.models.material import Material  # noqa: F401
from app.models.session import InterviewSession, InterviewTurn  # noqa: F401
from app.stage11_local import get_user_settings
from app.services.deepseek_interview import get_interview_llm
from app.services.vector_store import get_vector_store
from app.services.resume_parser import parse_resume_sections, resume_context, resume_quality


class FakeModel:
    def __init__(self):
        self.generated = []
        self.grades = []

    def generate_question(self, **kwargs):
        self.generated.append(kwargs)
        return "请介绍你实际完成的项目"

    def grade_answer(self, **kwargs):
        from app.services.deepseek_interview import GradeResult
        self.grades.append(kwargs)
        return GradeResult(score=85, feedback="回答较清楚")


class FakeStore:
    def search(self, *_args):
        raise AssertionError("未选择材料时不应触发向量检索")


@pytest.fixture()
def isolated_api(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'only-tests.db').as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    fake_model = FakeModel()
    test_app = FastAPI()
    test_app.include_router(resumes_router)
    test_app.include_router(sessions_router)
    def get_test_db():
        with factory() as db:
            yield db

    test_app.dependency_overrides[get_db] = get_test_db
    test_app.dependency_overrides[get_user_settings] = lambda: Settings(_env_file=None, upload_path=str(tmp_path / 'files'))
    test_app.dependency_overrides[get_interview_llm] = lambda: fake_model
    test_app.dependency_overrides[get_vector_store] = lambda: FakeStore()
    with TestClient(test_app) as client:
        yield client, fake_model, tmp_path, factory
    engine.dispose()


def docx_bytes(content):
    doc = Document()
    for line in content.splitlines():
        doc.add_paragraph(line)
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def sections(**overrides):
    baseline = {key: [] for key in ("profile", "education", "experience", "projects", "skills", "awards", "other")}
    baseline.update(overrides)
    return baseline


def test_parse_chinese_headings_and_inline_values():
    data = parse_resume_sections("姓名：小李\n教育背景：计算机专业\n实习经历：参与后端研发\n项目经历\n校园项目\n专业技能：Python\n获奖情况：校赛二等奖\n其他：志愿活动")
    assert data['sections']['education'] == ['计算机专业']
    assert data['sections']['experience'] == ['参与后端研发']
    assert data['sections']['projects'] == ['校园项目']
    assert data['sections']['skills'] == ['Python']
    assert data['sections']['awards'] == ['校赛二等奖']
    assert data['sections']['other'] == ['志愿活动']
    assert resume_quality(data)['filled'] == 7


def test_upload_edit_reload_and_context_used_in_questions_and_grading(isolated_api):
    api, model, tmp, factory = isolated_api
    uploaded = api.post('/api/resumes', files={'file': ('my.docx', docx_bytes('姓名：小李\n个人简介\n应届生\n技能：Java'))})
    assert uploaded.status_code == 201, uploaded.text
    record = uploaded.json()
    rid = record['id']
    assert record['quality']['total'] == 7
    assert record['quality']['filled'] <= 2
    original_text = record['full_text']

    correction = {
        'name': '小李', 'email': '', 'phone': '',
        'sections': sections(profile=['本科毕业生'], projects=['主持校园客服项目，使用 Python 和 FastAPI'], skills=['Python', 'FastAPI'], experience=['后端实习两个月']),
    }
    patched = api.patch(f'/api/resumes/{rid}', json=correction)
    assert patched.status_code == 200, patched.text
    assert patched.json()['quality']['filled'] == 4
    assert patched.json()['full_text'] == original_text
    assert patched.json()['structured_data']['manual_reviewed'] is True
    assert api.get(f'/api/resumes/{rid}').json()['structured_data']['sections']['projects'] == correction['sections']['projects']
    listed = api.get('/api/resumes')
    assert listed.status_code == 200
    assert listed.json()[0]['quality']['filled'] == 4
    with factory() as session:
        saved = session.get(Resume, rid)
        assert saved.full_text == original_text
        assert saved.structured_data['sections']['projects'] == correction['sections']['projects']
    assert len(list((tmp / 'files' / 'resumes').glob('*.docx'))) == 1

    created = api.post('/api/interviews', json={'resume_id': rid, 'material_ids': [], 'config': {'question_count': 3, 'max_followups': 0}})
    assert created.status_code == 201, created.text
    assert '主持校园客服项目' in model.generated[-1]['resume_text']
    assert model.generated[-1]['resume_text'].index('主持校园客服项目') < model.generated[-1]['resume_text'].index('原始提取文本')
    session = created.json()
    turn = session['turns'][-1]
    answered = api.post(f"/api/interviews/{session['id']}/answer", json={'turn_id': turn['id'], 'answer': '使用 Python 编写接口和测试', 'user_feedback': 'just_right'})
    assert answered.status_code == 200, answered.text
    assert '主持校园客服项目' in model.grades[-1]['resume_text']
    assert '主持校园客服项目' in model.generated[-1]['resume_text']


def test_reject_unknown_fields_missing_or_oversized_content(isolated_api):
    api, _, _, _ = isolated_api
    up = api.post('/api/resumes', files={'file': ('a.docx', docx_bytes('姓名：小王\n项目经历\n开发'))})
    rid = up.json()['id']
    assert api.patch(f'/api/resumes/{rid}', json={'sections': {'projects': ['项目']}}).status_code == 422
    assert api.patch(f'/api/resumes/{rid}', json={'sections': sections(), 'injected': 'secret'}).status_code == 422
    too_long = sections(projects=['a' * 2001])
    assert api.patch(f'/api/resumes/{rid}', json={'sections': too_long}).status_code == 422
    assert api.patch('/api/resumes/not-found', json={'sections': sections()}).status_code == 404
    assert api.get(f'/api/resumes/{rid}').json()['structured_data'].get('manual_reviewed') is None


def test_legacy_resume_context_unchanged():
    assert resume_context('legacy original', {'name': 'x'}) == 'legacy original'
    assert resume_quality({'sections': {'profile': [' ']}})['filled'] == 0
