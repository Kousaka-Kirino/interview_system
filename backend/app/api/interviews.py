"""面试配置与自适应规则预览接口。"""

from fastapi import APIRouter

from app.schemas.interview import (
    AdaptationPreviewRequest,
    AdaptationPreviewResponse,
)

from app.services.adaptation import adjust_difficulty


router = APIRouter(
    prefix="/api/interviews",
    tags=["interviews"]
)


@router.get("/options")
def get_interview_options() -> dict:
    """获取前端面试配置的可选项。"""

    return {
        "reviewer_styles": [
            {
                "value": "friendly",
                "label": "和善型"
            },
            {
                "value": "neutral",
                "label": "标准型"
            },
            {
                "value": "pressure",
                "label": "压力型"
            },
        ],

        "difficulty_levels": [1, 2, 3, 4, 5],

        "adaptation_levels": [
            {
                "value": 0,
                "label": "关闭自动调难"
            },
            {
                "value": 1,
                "label": "温和调整"
            },
            {
                "value": 2,
                "label": "标准调整"
            },
            {
                "value": 3,
                "label": "积极调整"
            },
        ],

        "defaults": {
            "reviewer_style": "neutral",
            "initial_difficulty": 3,
            "adaptation_level": 2,
            "question_count": 8,
            "max_followups": 1,
        },
    }


@router.post(
    "/adaptation/preview",
    response_model=AdaptationPreviewResponse
)
def preview_adaptation(
    body: AdaptationPreviewRequest
) -> AdaptationPreviewResponse:
    """仅供开发预览；不创建真实面试会话。"""

    return adjust_difficulty(body)