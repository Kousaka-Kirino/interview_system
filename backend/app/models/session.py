"""模拟答辩会话及逐题问答，均保存在 SQLite。"""

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True
    )

    resume_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("resumes.id"),
        nullable=False,
    )

    material_ids: Mapped[list[str]] = mapped_column(
        JSON, nullable=False
    )

    config_data: Mapped[dict] = mapped_column(
        JSON, nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(16),
        default="active",
        nullable=False,
    )

    current_difficulty: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    main_questions_asked: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False
    )

    followups_used: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    positive_streak: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    negative_streak: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        nullable=False,
    )

    turns: Mapped[list["InterviewTurn"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="InterviewTurn.id",
    )


class InterviewTurn(Base):
    __tablename__ = "interview_turns"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("interview_sessions.id"),
        nullable=False,
        index=True,
    )

    question_number: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    followup_number: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    difficulty: Mapped[int] = mapped_column(
        Integer, nullable=False
    )

    question: Mapped[str] = mapped_column(
        Text, nullable=False
    )

    answer: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )

    score: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )

    feedback: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )

    user_feedback: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        nullable=False,
    )

    session: Mapped[InterviewSession] = relationship(
        back_populates="turns"
    )