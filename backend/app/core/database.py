"""SQLite 连接与数据库会话。"""

from collections.abc import Generator

from sqlalchemy import create_engine

from sqlalchemy.orm import (
    DeclarativeBase,
    Session,
    sessionmaker,
)

from app.core.config import get_settings

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

def get_db() -> Generator[Session, None, None]:

    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()