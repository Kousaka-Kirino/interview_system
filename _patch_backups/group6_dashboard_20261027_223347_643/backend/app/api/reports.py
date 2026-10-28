"""Stage 4：答辩历史、全局统计、离线复盘和按需 AI 复盘。"""

import logging

from datetime import datetime, timezone
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
)

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db

from app.models.report import InterviewAIReport
from app.models.session import InterviewSession

from app.schemas.report import (
    HistoryPage,
    InterviewReportView,
    OverallStatistics,
)

from app.services.deepseek_interview import (
    InterviewLLM,
    InterviewLLMError,
    get_interview_llm,
)

from app.services.report_ai import create_ai_analysis

from app.services.report_service import (
    build_report,
    get_history,
    get_statistics,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/interviews",
    tags=["interview-reports"],
)

def completed_session(
    db: Session,
    session_id: str,
) -> InterviewSession:

    session = db.get(
        InterviewSession,
        session_id,
    )

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="答辩会话不存在",
        )

    if session.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="答辩尚未结束，无法生成最终复盘",
        )

    return session

@router.get(
    "/history",
    response_model=HistoryPage,
)
def history(
    status: Literal[
        "active",
        "completed",
    ] | None = None,

    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),

    offset: int = Query(
        default=0,
        ge=0,
    ),

    db: Session = Depends(get_db),
) -> HistoryPage:

    return get_history(
        db,
        status,
        limit,
        offset,
    )

@router.get(
    "/statistics",
    response_model=OverallStatistics,
)
def statistics(
    db: Session = Depends(get_db),
) -> OverallStatistics:

    return get_statistics(db)

@router.get(
    "/{session_id}/report",
    response_model=InterviewReportView,
)
def get_report(
    session_id: str,
    db: Session = Depends(get_db),
) -> InterviewReportView:

    return build_report(
        db,
        completed_session(
            db,
            session_id,
        ),
    )

@router.post(
    "/{session_id}/report/ai",
    response_model=InterviewReportView,
)
def ai_report(
    session_id: str,

    refresh: bool = False,

    db: Session = Depends(get_db),

    llm: InterviewLLM = Depends(
        get_interview_llm
    ),
) -> InterviewReportView:

    session = completed_session(
        db,
        session_id,
    )

    existing = db.get(
        InterviewAIReport,
        session_id,
    )

    # 有缓存且没有要求刷新时，直接返回；
    # 不会重复调用 DeepSeek。
    if existing is not None and not refresh:
        return build_report(
            db,
            session,
        )

    report = build_report(
        db,
        session,
    )

    if not report.turns:
        raise HTTPException(
            status_code=422,
            detail="本场答辩没有已回答题目",
        )

    try:
        analysis = create_ai_analysis(
            llm,
            report,
        )

    except InterviewLLMError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception(
            "生成 AI 复盘失败"
        )

        raise HTTPException(
            status_code=503,
            detail="AI 复盘服务暂不可用",
        ) from exc

    # 保存到 SQLite
    try:

        if existing is None:

            db.add(
                InterviewAIReport(
                    session_id=session_id,
                    analysis=analysis.model_dump(),
                    generated_at=datetime.now(
                        timezone.utc
                    ),
                )
            )

        else:

            existing.analysis = (
                analysis.model_dump()
            )

            existing.generated_at = (
                datetime.now(timezone.utc)
            )

        db.commit()

    except SQLAlchemyError as exc:

        db.rollback()

        logger.exception(
            "AI 复盘保存失败"
        )

        raise HTTPException(
            status_code=500,
            detail="AI 复盘保存失败",
        ) from exc

    db.expire_all()

    return build_report(
        db,
        session,
    )