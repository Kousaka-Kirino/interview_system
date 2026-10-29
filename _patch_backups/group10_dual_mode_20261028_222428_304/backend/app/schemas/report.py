"""历史查询、离线复盘和可选 AI 复盘的 API 模型。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

class HistoryItem(BaseModel):
    id: str
    resume_id: str
    status: Literal["active", "completed"]
    reviewer_style: str
    created_at: datetime
    answered_count: int
    average_score: float | None

class HistoryPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[HistoryItem]

class OverallStatistics(BaseModel):
    total_sessions: int
    active_sessions: int
    completed_sessions: int
    answered_turns: int
    average_score: float | None

class CompletedScorePoint(BaseModel):
    session_id: str
    created_at: datetime
    average_score: float
    scored_answers: int


class CompletedScoreHistory(BaseModel):
    # Most recent completed sessions with at least one scored answer, chronological.
    points: list[CompletedScorePoint]


class ScorePoint(BaseModel):
    turn_id: int
    question_number: int
    followup_number: int
    difficulty: int
    score: float

class ReviewTurn(BaseModel):
    turn_id: int
    question_number: int
    followup_number: int
    difficulty: int
    question: str
    answer: str
    score: float | None
    feedback: str | None

class ExampleAnswer(BaseModel):
    turn_id: int
    answer: str = Field(min_length=20, max_length=2200)
    explanation: str = Field(min_length=2, max_length=500)


class AIWeakPoint(BaseModel):
    turn_id: int
    title: str = Field(min_length=2, max_length=120)
    reason: str = Field(min_length=2, max_length=500)
    dimension: Literal["理论依据", "论证逻辑", "研究方法", "数据证据", "创新价值", "答辩表达"]


class AIAnalysis(BaseModel):
    example_answers: list[ExampleAnswer] = Field(default_factory=list, max_length=12)
    weak_points: list[AIWeakPoint] = Field(default_factory=list, max_length=8)

    summary: str = Field(
        min_length=1,
        max_length=800
    )

    strengths: list[str] = Field(
        min_length=1,
        max_length=5
    )

    improvements: list[str] = Field(
        min_length=1,
        max_length=5
    )

    next_steps: list[str] = Field(
        min_length=1,
        max_length=5
    )

class InterviewReportView(BaseModel):
    session_id: str
    status: Literal["completed"]
    reviewer_style: str

    planned_main_questions: int
    main_questions_asked: int

    answered_count: int
    unanswered_count: int

    average_score: float | None

    score_trend: list[ScorePoint]
    turns: list[ReviewTurn]

    strengths: list[str]
    improvements: list[str]
    suggestions: list[str]

    ai_analysis: AIAnalysis | None = None
    ai_generated_at: datetime | None = None
    practice_focus: dict | None = None

    scoring_note: str = (
        "评分来自答辩阶段模型，"
        "规则版复盘只汇总已有评分，"
        "并非独立能力认证。"
    )