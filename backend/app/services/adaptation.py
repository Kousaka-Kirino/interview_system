"""可测试的自适应难度规则。"""

from app.schemas.interview import (
    AdaptationPreviewRequest,
    AdaptationPreviewResponse,
    ReviewerStyle,
)


REVIEWER_PROMPTS: dict[ReviewerStyle, str] = {
    "friendly": (
        "你是一位和善、专业的模拟答辩评委。"
        "语气温和，允许候选人思考；"
        "回答不完整时先做简短引导，"
        "再追问关键依据。"
        "不要降低评价标准。"
    ),

    "neutral": (
        "你是一位客观、专业的模拟答辩评委。"
        "提问清晰直接，"
        "根据候选人回答追问关键事实、"
        "工作贡献与决策理由。"
    ),

    "pressure": (
        "你是一位要求严格的压力型模拟答辩评委。"
        "提问简洁、节奏紧凑，"
        "要求候选人给出明确证据"
        "并指出逻辑漏洞；"
        "不得辱骂、贬低、威胁"
        "或使用人身攻击。"
    ),
}


def reviewer_instruction(
    style: ReviewerStyle
) -> str:
    """后续用于构建 DeepSeek 的 system prompt。"""

    return REVIEWER_PROMPTS[style]


def adjust_difficulty(
    data: AdaptationPreviewRequest
) -> AdaptationPreviewResponse:
    """
    根据回答评分和用户反馈调整难度。

    规则：
    1. 用户主动反馈优先。
    2. 自动调难可关闭。
    3. 每次最多升降一级。
    4. 难度限制为 1~5。
    """

    old = data.current_difficulty

    up = data.positive_streak
    down = data.negative_streak

    new = old
    reason = "没有足够证据，保持当前难度"

    # 用户主动反馈优先
    if data.user_feedback == "too_hard":
        new = max(1, old - 1)
        up, down = 0, 0
        reason = "用户主动要求降低难度"

    elif data.user_feedback == "too_easy":
        new = min(5, old + 1)
        up, down = 0, 0
        reason = "用户主动要求提高难度"

    # 关闭自动调难
    elif data.config.adaptation_level == 0:
        up, down = 0, 0
        reason = "自动调难已关闭"

    # 尚无回答评分
    elif data.answer_score is None:
        reason = "当前没有可用的答案评分，保持难度"

    else:
        score = data.answer_score

        # 统计连续高分或低分
        if score >= 80:
            up += 1
            down = 0

        elif score < 50:
            down += 1
            up = 0

        else:
            up, down = 0, 0

        # 不同灵敏度对应不同触发次数
        required_up = {
            1: 3,
            2: 2,
            3: 1
        }[data.config.adaptation_level]

        required_down = {
            1: 2,
            2: 1,
            3: 1
        }[data.config.adaptation_level]

        if up >= required_up:
            new = min(5, old + 1)
            up, down = 0, 0
            reason = "连续高质量回答，适度增加难度"

        elif down >= required_down:
            new = max(1, old - 1)
            up, down = 0, 0
            reason = "连续低分回答，适度降低难度"

        else:
            reason = "继续观察回答表现，暂不调整难度"

    # 处理难度上下限
    if (
        new == old
        and data.user_feedback in ("too_hard", "too_easy")
    ):
        reason = "已达到难度边界，保持当前难度"

    return AdaptationPreviewResponse(
        previous_difficulty=old,
        next_difficulty=new,
        changed=new != old,
        reason=reason,
        positive_streak=up,
        negative_streak=down
    )