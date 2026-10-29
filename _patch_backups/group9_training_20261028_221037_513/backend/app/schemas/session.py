"""答辩会话相关的请求与响应。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.interview import (
    InterviewConfig,
    UserFeedback,
)


class StartInterviewRequest(BaseModel):
    resume_id: str = Field(
        min_length=1,
        max_length=36,
    )

    material_ids: list[str] = Field(
        default_factory=list,
        max_length=10,
    )

    config: InterviewConfig = Field(
        default_factory=InterviewConfig
    )


class SubmitAnswerRequest(BaseModel):
    turn_id: int = Field(ge=1)

    answer: str = Field(
        min_length=1,
        max_length=10000,
    )

    user_feedback: UserFeedback = "none"


class TurnView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_number: int
    followup_number: int
    difficulty: int
    question: str
    answer: str | None
    score: float | None
    feedback: str | None
    user_feedback: str | None


class SessionView(BaseModel):
    id: str
    resume_id: str
    material_ids: list[str]
    config: InterviewConfig

    status: Literal[
        "active",
        "completed",
    ]

    current_difficulty: int
    main_questions_asked: int
    followups_used: int
    positive_streak: int
    negative_streak: int

    created_at: datetime
    turns: list[TurnView]


class AnswerEvaluation(BaseModel):
    score: float = Field(
        ge=0,
        le=100,
    )

    feedback: str = Field(
        min_length=1,
        max_length=1000,
    )

    adaptation_reason: str


class SubmitAnswerResponse(BaseModel):
    session: SessionView
    evaluation: AnswerEvaluation