"""SQLite 连接与数据库会话。"""

from collections.abc import Generator
from functools import lru_cache
from pathlib import Path
from fastapi import Request

from sqlalchemy import create_engine

from sqlalchemy.orm import (
    DeclarativeBase,
    Session,
    sessionmaker,
)

from app.core.config import get_settings
from app.stage11_local import is_legacy_owner, user_root
from app.stage8b_auth import require_owner_id

settings = get_settings()

settings.sqlite_file.parent.mkdir(
    parents=True,
    exist_ok=True,
)

engine = create_engine(
    settings.database_url,
    connect_args={
        "check_same_thread": False
    },
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)

class Base(DeclarativeBase):
    pass

def init_db() -> None:
    """注册所有 SQLAlchemy 模型并创建缺失的数据表。"""

    # Stage 1B
    from app.models.resume import Resume

    # Stage 2
    from app.models.material import Material

    # Stage 3
    from app.models.session import (
        InterviewSession,
        InterviewTurn,
    )

    # Stage 4
    from app.models.report import InterviewAIReport

    Base.metadata.create_all(
        bind=engine
    )

@lru_cache(maxsize=128)
def _personal_session_factory(user_id: str):
    target = user_root(user_id) / "interview.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    local_engine = create_engine(
        "sqlite:///" + target.as_posix(),
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    # Exactly the same ORM tables as the original application, but a distinct DB.
    init_models()
    Base.metadata.create_all(bind=local_engine)
    return sessionmaker(bind=local_engine, autoflush=False, expire_on_commit=False)


def init_models():
    from app.models.resume import Resume
    from app.models.material import Material
    from app.models.session import InterviewSession, InterviewTurn
    from app.models.report import InterviewAIReport


def ensure_user_database(user_id: str):
    """Prepare isolated data tables before committing a new account registration."""
    _personal_session_factory(user_id)


def get_db(request: Request) -> Generator[Session, None, None]:
    user_id = require_owner_id(request)
    factory = SessionLocal if is_legacy_owner(user_id) else _personal_session_factory(user_id)
    db = factory()

    try:
        yield db

    finally:
        db.close()