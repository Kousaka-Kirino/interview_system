"""第六组：测试独立 SQLite、只读趋势接口及不同账号数据库隔离。"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.reports import router as reports_router
from app.core.database import Base, get_db
from app.models.material import Material  # noqa: F401 (foreign key registration)
from app.models.report import InterviewAIReport  # noqa: F401
from app.models.resume import Resume
from app.models.session import InterviewSession, InterviewTurn
from app.services.report_service import get_completed_score_history
from app.stage8c2_guard import OwnerScopeMiddleware, _INTERVIEW_STATIC


@pytest.fixture()
def account_databases(tmp_path):
    resources = []
    for name in ('alice', 'bob'):
        engine = create_engine(f"sqlite:///{tmp_path / (name + '.db')}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as db:
            db.add(Resume(id=f'{name}-resume', original_filename='test.docx', stored_filename=f'{name}.docx',
                          file_size=1, full_text='test', structured_data={}))
            db.commit()
        resources.append((factory, engine, f'{name}-resume'))
    yield resources
    for _, engine, _ in resources:
        engine.dispose()


def insert_session(factory, resume_id, *, when, status='completed', answers=()):
    session_id = str(uuid4())
    with factory() as db:
        db.add(InterviewSession(
            id=session_id, resume_id=resume_id, material_ids=[], config_data={'reviewer_style': 'neutral'},
            status=status, current_difficulty=3, main_questions_asked=1, followups_used=0,
            positive_streak=0, negative_streak=0, created_at=when,
        ))
        for score, answer in answers:
            db.add(InterviewTurn(session_id=session_id, question_number=1, followup_number=0,
                                 difficulty=3, question='演示题目', answer=answer, score=score))
        db.commit()
    return session_id


def client_for(factory):
    app = FastAPI()
    app.include_router(reports_router)
    def override_db():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_empty_and_one_valid_session(account_databases):
    factory, _, resume_id = account_databases[0]
    with client_for(factory) as client:
        assert client.get('/api/interviews/score-history').json() == {'points': []}
        when = datetime(2026, 1, 1, tzinfo=timezone.utc)
        sid = insert_session(factory, resume_id, when=when, answers=[(0.0, '真实回答'), (None, '未评分')])
        response = client.get('/api/interviews/score-history')
        assert response.status_code == 200
        assert response.json()['points'][0]['session_id'] == sid
        assert response.json()['points'][0]['average_score'] == 0
        assert response.json()['points'][0]['scored_answers'] == 1


def test_excludes_active_unanswered_and_null_scores_orders_chronologically(account_databases):
    factory, _, resume_id = account_databases[0]
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    earlier = insert_session(factory, resume_id, when=start, answers=[(60.0, 'a'), (80.0, 'b'), (100.0, None)])
    insert_session(factory, resume_id, when=start + timedelta(days=1), status='active', answers=[(99.0, 'c')])
    insert_session(factory, resume_id, when=start + timedelta(days=2), answers=[(None, 'd')])
    later = insert_session(factory, resume_id, when=start + timedelta(days=3), answers=[(77.0, 'e')])
    with client_for(factory) as client:
        data = client.get('/api/interviews/score-history').json()['points']
        assert [p['session_id'] for p in data] == [earlier, later]
        assert [p['average_score'] for p in data] == [70.0, 77.0]
        assert [p['scored_answers'] for p in data] == [2, 1]
        summary = client.get('/api/interviews/statistics').json()
        assert summary['total_sessions'] == 4
        # Existing global mean still includes active scored turns, unlike trend.
        assert summary['average_score'] == 79.0


def test_uses_only_last_twenty_scored_sessions(account_databases):
    factory, _, resume_id = account_databases[0]
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ids = [insert_session(factory, resume_id, when=start + timedelta(days=i), answers=[(float(i), 'answer')]) for i in range(24)]
    with client_for(factory) as client:
        points = client.get('/api/interviews/score-history').json()['points']
        assert len(points) == 20
        assert [p['session_id'] for p in points] == ids[4:]
    with factory() as db:
        assert len(get_completed_score_history(db, limit=2).points) == 2


def test_different_account_databases_never_leak(account_databases):
    alice, _, alice_resume = account_databases[0]
    bob, _, bob_resume = account_databases[1]
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_session(alice, alice_resume, when=start, answers=[(15.0, 'alice')])
    bid = insert_session(bob, bob_resume, when=start, answers=[(90.0, 'bob')])
    with client_for(alice) as a, client_for(bob) as b:
        assert [p['session_id'] for p in a.get('/api/interviews/score-history').json()['points']] == [aid]
        assert [p['session_id'] for p in b.get('/api/interviews/score-history').json()['points']] == [bid]


def test_owner_guard_knows_new_static_route(account_databases, monkeypatch):
    """Real middleware routing must not treat score-history as session UUID."""
    import app.stage8c2_guard as owner_guard
    assert 'score-history' in _INTERVIEW_STATIC
    factory, _, resume_id = account_databases[0]
    insert_session(factory, resume_id, when=datetime(2026, 1, 1, tzinfo=timezone.utc), answers=[(65, 'a')])
    app = FastAPI()
    app.include_router(reports_router)
    app.add_middleware(OwnerScopeMiddleware)
    def override_db():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    checks = []
    def verify(refs, _request):
        checks.append(refs)
        return None
    monkeypatch.setattr(owner_guard, '_verify_references', verify)
    with TestClient(app) as client:
        response = client.get('/api/interviews/score-history')
    assert response.status_code == 200, response.text
    assert checks == [[]], 'static route incorrectly interpreted as an owned session ID'
    assert response.json()['points'][0]['average_score'] == 65.0
