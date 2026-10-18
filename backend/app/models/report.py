"""AI 复盘缓存；离线统计直接从答辩问答实时计算。"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

class InterviewAIReport(Base):
    __tablename__ = "interview_ai_reports"

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("interview_sessions.id"),
        primary_key=True
    )

    analysis: Mapped[dict] = mapped_column(
        JSON,
        nullable=False
    )

    generated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )