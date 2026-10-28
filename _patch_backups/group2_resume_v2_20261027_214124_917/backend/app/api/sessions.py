"""Stage 3：创建、查看、回答与提前结束单模型答辩。"""

import logging

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.material import Material
from app.models.resume import Resume
from app.models.session import (
    InterviewSession,
    InterviewTurn,
)

from app.schemas.interview import (
    AdaptationPreviewRequest,
    InterviewConfig,
)

from app.schemas.session import (
    AnswerEvaluation,
    SessionView,
    StartInterviewRequest,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
    TurnView,
)

from app.services.adaptation import adjust_difficulty

from app.services.deepseek_interview import (
    InterviewLLM,
    InterviewLLMError,
    get_interview_llm,
)

from app.services.vector_store import (
    VectorStore,
    get_vector_store,
)


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/interviews",
    tags=["interviews"],
)


def _view(
    session: InterviewSession
) -> SessionView:

    return SessionView(
        id=session.id,
        resume_id=session.resume_id,
        material_ids=session.material_ids,
        config=InterviewConfig.model_validate(
            session.config_data
        ),
        status=session.status,
        current_difficulty=session.current_difficulty,
        main_questions_asked=session.main_questions_asked,
        followups_used=session.followups_used,
        positive_streak=session.positive_streak,
        negative_streak=session.negative_streak,
        created_at=session.created_at,
        turns=[
            TurnView.model_validate(t)
            for t in session.turns
        ],
    )


def _get_session(
    db: Session,
    session_id: str,
) -> InterviewSession:

    session = db.get(
        InterviewSession,
        session_id,
    )

    if session is None:
        raise HTTPException(
            404,
            "答辩会话不存在",
        )

    return session


def _get_evidence(
    store: VectorStore,
    material_ids: list[str],
    query: str,
) -> list[str]:

    if not material_ids:
        return []

    try:
        hits = store.search(
            query[:450],
            material_ids,
            3,
        )

        return [
            (
                f"[{h.original_filename} "
                f"片段 {h.chunk_index}] "
                f"{h.text[:650]}"
            )
            for h in hits
            if h.distance <= 0.65
        ]

    except Exception as exc:

        logger.exception(
            "RAG 资料检索失败"
        )

        raise HTTPException(
            503,
            "补充资料检索失败，请稍后重试",
        ) from exc


def _llm_question(
    llm: InterviewLLM,
    **kwargs,
) -> str:

    try:
        return llm.generate_question(
            **kwargs
        )

    except InterviewLLMError as exc:
        raise HTTPException(
            503,
            str(exc),
        ) from exc

    except Exception as exc:

        logger.exception(
            "生成答辩问题失败"
        )

        raise HTTPException(
            503,
            "答辩问题生成失败，请稍后重试",
        ) from exc


@router.post(
    "",
    response_model=SessionView,
    status_code=201,
)
def start_interview(
    body: StartInterviewRequest,
    db: Session = Depends(get_db),
    llm: InterviewLLM = Depends(get_interview_llm),
    store: VectorStore = Depends(get_vector_store),
) -> SessionView:

    resume = db.get(
        Resume,
        body.resume_id,
    )

    if resume is None:
        raise HTTPException(
            404,
            "简历不存在",
        )

    ids = list(
        dict.fromkeys(
            body.material_ids
        )
    )

    if ids:

        found = set(
            db.scalars(
                select(Material.id).where(
                    Material.id.in_(ids)
                )
            ).all()
        )

        if missing := [
            item
            for item in ids
            if item not in found
        ]:
            raise HTTPException(
                404,
                {
                    "missing_material_ids": missing
                },
            )

    evidence = _get_evidence(
        store,
        ids,
        resume.full_text[:350],
    )

    question = _llm_question(
        llm,
        resume_text=resume.full_text,
        evidence=evidence,
        previous=[],
        style=body.config.reviewer_style,
        difficulty=body.config.initial_difficulty,
        question_number=1,
        followup_number=0,
    )

    session = InterviewSession(
        id=str(uuid4()),
        resume_id=body.resume_id,
        material_ids=ids,
        config_data=body.config.model_dump(),
        status="active",
        current_difficulty=body.config.initial_difficulty,
        main_questions_asked=1,
        followups_used=0,
        positive_streak=0,
        negative_streak=0,
    )

    session.turns.append(
        InterviewTurn(
            question_number=1,
            followup_number=0,
            difficulty=body.config.initial_difficulty,
            question=question,
        )
    )

    db.add(session)
    db.commit()
    db.expire_all()

    return _view(session)


@router.get(
    "/{session_id}",
    response_model=SessionView,
)
def get_interview(
    session_id: str,
    db: Session = Depends(get_db),
) -> SessionView:

    return _view(
        _get_session(
            db,
            session_id,
        )
    )


@router.post(
    "/{session_id}/answer",
    response_model=SubmitAnswerResponse,
)
def submit_answer(
    session_id: str,
    body: SubmitAnswerRequest,
    db: Session = Depends(get_db),
    llm: InterviewLLM = Depends(get_interview_llm),
    store: VectorStore = Depends(get_vector_store),
) -> SubmitAnswerResponse:

    session = _get_session(
        db,
        session_id,
    )

    if session.status != "active":
        raise HTTPException(
            409,
            "答辩已经结束",
        )

    if not body.answer.strip():
        raise HTTPException(
            422,
            "回答不能为空",
        )

    turns = session.turns
    current = turns[-1]

    if (
        current.id != body.turn_id
        or current.answer is not None
    ):
        raise HTTPException(
            409,
            "题目已变化，请刷新答辩会话后再提交",
        )

    resume = db.get(
        Resume,
        session.resume_id,
    )

    if resume is None:
        raise HTTPException(
            409,
            "关联的简历已不存在",
        )

    config = InterviewConfig.model_validate(
        session.config_data
    )

    # 先评分；模型失败时不写数据库
    try:
        grade = llm.grade_answer(
            question=current.question,
            answer=body.answer.strip(),
            resume_text=resume.full_text,
        )

    except InterviewLLMError as exc:
        raise HTTPException(
            503,
            str(exc),
        ) from exc

    except Exception as exc:

        logger.exception(
            "回答评分失败"
        )

        raise HTTPException(
            503,
            "回答评分失败，请稍后重试",
        ) from exc

    # 使用原来的 Stage 1A 自适应算法
    decision = adjust_difficulty(
        AdaptationPreviewRequest(
            config=config,
            current_difficulty=session.current_difficulty,
            answer_score=grade.score,
            user_feedback=body.user_feedback,
            positive_streak=session.positive_streak,
            negative_streak=session.negative_streak,
        )
    )

    # 低于 70 分且额度足够时继续追问
    should_followup = (
        grade.score < 70
        and session.followups_used
        < config.max_followups
    )

    if should_followup:

        next_main = (
            session.main_questions_asked
        )

        next_followup = (
            session.followups_used + 1
        )

    else:

        next_main = (
            session.main_questions_asked + 1
        )

        next_followup = 0

    next_question: str | None = None

    # 没有达到题量上限时生成下一题
    if (
        should_followup
        or next_main <= config.question_count
    ):

        dialogue = [
            {
                "question": t.question,
                "answer": t.answer,
            }
            for t in turns[-5:]
        ]

        dialogue[-1]["answer"] = (
            body.answer.strip()
        )

        evidence = _get_evidence(
            store,
            session.material_ids,
            (
                current.question
                + " "
                + body.answer.strip()
            )[:450],
        )

        next_question = _llm_question(
            llm,
            resume_text=resume.full_text,
            evidence=evidence,
            previous=dialogue,
            style=config.reviewer_style,
            difficulty=decision.next_difficulty,
            question_number=next_main,
            followup_number=next_followup,
        )

    # 生成成功后，再写入数据库。
    # SQL 条件更新防止同一道题重复写入。
    changed = db.execute(
        update(InterviewTurn)
        .where(
            InterviewTurn.id == current.id,
            InterviewTurn.answer.is_(None),
        )
        .values(
            answer=body.answer.strip(),
            score=grade.score,
            feedback=grade.feedback,
            user_feedback=body.user_feedback,
        )
    )

    if changed.rowcount != 1:
        db.rollback()

        raise HTTPException(
            409,
            "此题已被提交，请刷新会话",
        )

    session.current_difficulty = (
        decision.next_difficulty
    )

    session.positive_streak = (
        decision.positive_streak
    )

    session.negative_streak = (
        decision.negative_streak
    )

    if next_question is None:

        session.status = "completed"

    else:

        session.main_questions_asked = (
            next_main
        )

        session.followups_used = (
            next_followup
        )

        session.turns.append(
            InterviewTurn(
                question_number=next_main,
                followup_number=next_followup,
                difficulty=decision.next_difficulty,
                question=next_question,
            )
        )

    db.commit()
    db.expire_all()

    return SubmitAnswerResponse(
        session=_view(session),
        evaluation=AnswerEvaluation(
            score=grade.score,
            feedback=grade.feedback,
            adaptation_reason=decision.reason,
        ),
    )


@router.post(
    "/{session_id}/finish",
    response_model=SessionView,
)
def finish_interview(
    session_id: str,
    db: Session = Depends(get_db),
) -> SessionView:

    session = _get_session(
        db,
        session_id,
    )

    if session.status == "active":

        session.status = "completed"

        db.commit()
        db.expire_all()

    return _view(session)