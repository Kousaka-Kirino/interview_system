"""不依赖 API Key 的答辩统计、历史和规则复盘。"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.report import InterviewAIReport
from app.models.session import InterviewSession, InterviewTurn
from app.services.focus_practice import focus_of
from app.services.practice_mode import practice_mode

from app.schemas.report import (
    AIAnalysis,
    HistoryItem,
    CompletedScoreHistory,
    CompletedScorePoint,
    HistoryPage,
    InterviewReportView,
    OverallStatistics,
    ReviewTurn,
    ScorePoint,
)

def rounded_mean(
    scores: list[float]
) -> float | None:

    return (
        round(sum(scores) / len(scores), 2)
        if scores
        else None
    )

def get_history(
    db: Session,
    status: str | None,
    limit: int,
    offset: int,
) -> HistoryPage:

    conditions = (
        []
        if status is None
        else [InterviewSession.status == status]
    )

    total = db.scalar(
        select(func.count())
        .select_from(InterviewSession)
        .where(*conditions)
    ) or 0

    sessions = db.scalars(
        select(InterviewSession)
        .where(*conditions)
        .options(
            selectinload(InterviewSession.turns)
        )
        .order_by(
            InterviewSession.created_at.desc(),
            InterviewSession.id.desc()
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = []

    for s in sessions:

        scored = [
            float(t.score)
            for t in s.turns
            if (
                t.answer is not None
                and t.score is not None
            )
        ]

        items.append(
            HistoryItem(
                id=s.id,
                mode=practice_mode(s.config_data),
                resume_id=s.resume_id,
                status=s.status,
                reviewer_style=(
                    s.config_data.get(
                        "reviewer_style",
                        "neutral"
                    )
                ),
                created_at=s.created_at,
                answered_count=sum(
                    t.answer is not None
                    for t in s.turns
                ),
                average_score=rounded_mean(scored),
            )
        )

    return HistoryPage(
        total=total,
        limit=limit,
        offset=offset,
        items=items
    )

def get_statistics(
    db: Session
) -> OverallStatistics:

    total = db.scalar(
        select(func.count())
        .select_from(InterviewSession)
    ) or 0

    active = db.scalar(
        select(func.count())
        .select_from(InterviewSession)
        .where(
            InterviewSession.status == "active"
        )
    ) or 0

    completed = db.scalar(
        select(func.count())
        .select_from(InterviewSession)
        .where(
            InterviewSession.status == "completed"
        )
    ) or 0

    answered = db.scalar(
        select(func.count())
        .select_from(InterviewTurn)
        .where(
            InterviewTurn.answer.is_not(None)
        )
    ) or 0

    average = db.scalar(
        select(func.avg(InterviewTurn.score))
        .where(
            InterviewTurn.answer.is_not(None),
            InterviewTurn.score.is_not(None)
        )
    )

    return OverallStatistics(
        total_sessions=total,
        active_sessions=active,
        completed_sessions=completed,
        answered_turns=answered,
        average_score=(
            round(float(average), 2)
            if average is not None
            else None
        ),
    )

def get_completed_score_history(db: Session, limit: int = 20) -> CompletedScoreHistory:
    """Last N scored completed sessions. SQLite user isolation comes from get_db().

    Skip active/zero-scored sessions. Unanswered turns and scores of None
    never contribute; an actual score of zero *does* contribute.
    """
    scored_count = func.count(InterviewTurn.id).label("scored_count")
    average = func.avg(InterviewTurn.score).label("average")
    rows = db.execute(
        select(
            InterviewSession.id,
            InterviewSession.created_at,
            average,
            scored_count,
        )
        .join(InterviewTurn, InterviewTurn.session_id == InterviewSession.id)
        .where(
            InterviewSession.status == "completed",
            InterviewTurn.answer.is_not(None),
            InterviewTurn.score.is_not(None),
        )
        .group_by(InterviewSession.id, InterviewSession.created_at)
        .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
        .limit(limit)
    ).all()
    # API returns chronological order; last item is the most recent session.
    return CompletedScoreHistory(points=[
        CompletedScorePoint(
            session_id=row.id,
            created_at=row.created_at,
            average_score=round(float(row.average), 2),
            scored_answers=int(row.scored_count),
        )
        for row in reversed(rows)
    ])


def build_report(
    db: Session,
    session: InterviewSession,
) -> InterviewReportView:

    config = session.config_data

    # 未回答的题目不参与评分
    answered = [
        t
        for t in session.turns
        if t.answer is not None
    ]

    scored = [
        t
        for t in answered
        if t.score is not None
    ]

    scores = [
        float(t.score)
        for t in scored
    ]

    # 从高分题目中提取优势
    strengths = [
        (
            f"第{t.question_number}题"
            f"{'追问' if t.followup_number else '主问'}"
            f"得分较高（{t.score:g}分）："
            f"{t.question[:65]}"
        )
        for t in scored
        if t.score >= 80
    ][:3]

    # 从低分题目中提取待加强内容
    improvements = [
        (
            f"第{t.question_number}题"
            f"{'追问' if t.followup_number else '主问'}"
            f"建议复习（{t.score:g}分）："
            f"{t.question[:65]}"
        )
        for t in scored
        if t.score < 60
    ][:3]


    if not improvements:
        improvements = [
            "本次没有低于60分的已评分题目；"
            "仍可逐题检查反馈并补充实例。"
        ]

    suggestions = [
        "对照每道题的反馈，"
        "整理一版更清楚的回答。",

        "选取一个真实项目，"
        "用背景、职责、实现、结果四部分复述。",
    ]

    if any(
        t.followup_number > 0
        for t in answered
    ):
        suggestions.append(
            "特别复习出现追问的知识点，"
            "准备设计取舍与可验证细节。"
        )

    if not answered:
        suggestions = [
            "本场答辩没有已提交回答，"
            "建议完成至少一题后再查看评分分析。"
        ]

    saved_ai = db.get(
        InterviewAIReport,
        session.id
    )

    return InterviewReportView(
        session_id=session.id,
        mode=practice_mode(session.config_data),
        status="completed",
        practice_focus=focus_of(session),
        reviewer_style=config.get(
            "reviewer_style",
            "neutral"
        ),
        planned_main_questions=int(
            config.get("question_count", 8)
        ),
        main_questions_asked=(
            session.main_questions_asked
        ),
        answered_count=len(answered),
        unanswered_count=(
            len(session.turns) - len(answered)
        ),
        average_score=rounded_mean(scores),

        score_trend=[
            ScorePoint(
                turn_id=t.id,
                question_number=t.question_number,
                followup_number=t.followup_number,
                difficulty=t.difficulty,
                score=float(t.score),
            )
            for t in scored
        ],

        turns=[
            ReviewTurn(
                turn_id=t.id,
                question_number=t.question_number,
                followup_number=t.followup_number,
                difficulty=t.difficulty,
                question=t.question,
                answer=t.answer or "",
                score=t.score,
                feedback=t.feedback,
            )
            for t in answered
        ],

        strengths=strengths,
        improvements=improvements,
        suggestions=suggestions,

        ai_analysis=(
            AIAnalysis.model_validate(
                saved_ai.analysis
            )
            if saved_ai
            else None
        ),

        ai_generated_at=(
            saved_ai.generated_at
            if saved_ai
            else None
        ),
    )