"""面试设置与自适应规则的数据模型。"""

from typing import Literal

from pydantic import BaseModel, Field


ReviewerStyle = Literal[
    "friendly",
    "neutral",
    "pressure"
]

UserFeedback = Literal[
    "none",
    "too_hard",
    "too_easy",
    "just_right"
]


class InterviewConfig(BaseModel):
    reviewer_style: ReviewerStyle = "neutral"

    initial_difficulty: int = Field(
        default=3,
        ge=1,
        le=5
    )

    adaptation_level: int = Field(
        default=2,
        ge=0,
        le=3
    )

    question_count: int = Field(
        default=8,
        ge=3,
        le=30
    )

    max_followups: int = Field(
        default=1,
        ge=0,
        le=2
    )


class AdaptationPreviewRequest(BaseModel):
    config: InterviewConfig

    current_difficulty: int = Field(
        ge=1,
        le=5
    )

    answer_score: float | None = Field(
        default=None,
        ge=0,
        le=100
    )

    user_feedback: UserFeedback = "none"

    positive_streak: int = Field(
        default=0,
        ge=0,
        le=30
    )

    negative_streak: int = Field(
        default=0,
        ge=0,
        le=30
    )


class AdaptationPreviewResponse(BaseModel):
    previous_difficulty: int
    next_difficulty: int
    changed: bool
    reason: str
    positive_streak: int
    negative_streak: int