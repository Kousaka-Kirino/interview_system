"""Stage 3：创建、查看、回答与提前结束单模型答辩。"""

import logging

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.material import Material
from app.models.resume import Resume
from app.services.resume_parser import resume_context
from app.services.practice_mode import INTERNAL_FLAG, is_internal_resume, practice_mode, project_context
from app.services.focus_practice import resolve_focus, focus_of
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
        mode=practice_mode(session.config_data),
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
        practice_focus=focus_of(session),
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

    # Defense uses project materials as the primary context, without requiring
    # a user resume. A hidden internal context row satisfies the legacy NOT NULL
    # resume_id foreign key without schema migration or pretending it is an upload.
    selected_resume = db.get(Resume, body.resume_id) if body.resume_id else None
    if body.mode == "interview" and (selected_resume is None or is_internal_resume(selected_resume)):
        raise HTTPException(404, "请选择有效的简历后开始面试模式")
    if body.resume_id and (selected_resume is None or is_internal_resume(selected_resume)):
        raise HTTPException(404, "简历不存在")

    ids = list(dict.fromkeys(body.material_ids))
    if body.mode == "defense" and not ids:
        raise HTTPException(422, "答辩模式至少需要选择一份已建立索引的项目材料")
    found_materials = db.scalars(select(Material).where(Material.id.in_(ids))).all() if ids else []
    material_by_id = {m.id: m for m in found_materials}
    if missing := [item for item in ids if item not in material_by_id]:
        raise HTTPException(404, {"missing_material_ids": missing})
    if body.mode == "defense" and any(material_by_id[i].chunk_count <= 0 for i in ids):
        raise HTTPException(422, "所选资料没有可检索的文本，请重新建立资料索引")

    # A focused repeat must be scoped to its actual source resume, even when
    # that resume is a hidden internal context record from an earlier defense.
    focus = None
    if body.focus_session_id:
        if body.mode == "defense" and selected_resume is None:
            source = db.get(InterviewSession, body.focus_session_id)
            if source is None:
                raise HTTPException(404, "原答辩会话不存在")
            if practice_mode(source.config_data) != "defense":
                raise HTTPException(422, "专项再练的模式必须与原场次相同")
            source_resume = db.get(Resume, source.resume_id)
            if not is_internal_resume(source_resume):
                raise HTTPException(422, "原场次关联真实简历，请在面试模式中再练")
            focus = resolve_focus(db, body.focus_session_id, source.resume_id)
        else:
            source = db.get(InterviewSession, body.focus_session_id)
            if source is None:
                raise HTTPException(404, "原答辩会话不存在")
            if practice_mode(source.config_data) != body.mode:
                raise HTTPException(422, "专项再练的模式必须与原场次相同")
            focus = resolve_focus(db, body.focus_session_id, body.resume_id)

    names = [material_by_id[item].original_filename for item in ids]
    context = (project_context(names) if body.mode == "defense"
               else resume_context(selected_resume.full_text, selected_resume.structured_data))
    query = ("研究背景 研究方法 技术实现 数据结果 实验验证 项目创新 " + " ".join(names))[:350] if body.mode == "defense" else context[:350]
    evidence = _get_evidence(store, ids, query)
    if body.mode == "defense" and not evidence:
        raise HTTPException(422, "所选项目材料未检索到有效文字片段，请检查索引后再试")

    question = _llm_question(
        llm,
        resume_text=context,
        evidence=evidence,
        previous=[],
        style=body.config.reviewer_style,
        difficulty=body.config.initial_difficulty,
        question_number=1,
        followup_number=0,
        focus_points=focus["weak_points"] if focus else None,
        mode=body.mode,
    )

    if selected_resume is None:
        internal_id = str(uuid4())
        selected_resume = Resume(
            id=internal_id,
            original_filename="系统内部项目上下文",
            stored_filename=f"internal-{internal_id}.txt",
            file_size=0,
            full_text=context,
            structured_data={INTERNAL_FLAG: True},
        )
        db.add(selected_resume)

    session = InterviewSession(
        id=str(uuid4()),
        resume_id=selected_resume.id,
        material_ids=ids,
        config_data={**body.config.model_dump(), "practice_mode": body.mode,
                     **({"practice_focus": focus} if focus else {})},
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
            resume_text=resume_context(resume.full_text, resume.structured_data),
            mode=practice_mode(session.config_data),
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
            resume_text=resume_context(resume.full_text, resume.structured_data),
            evidence=evidence,
            previous=dialogue,
            style=config.reviewer_style,
            difficulty=decision.next_difficulty,
            question_number=next_main,
            followup_number=next_followup,
            focus_points=(focus_of(session) or {}).get("weak_points"),
            mode=practice_mode(session.config_data),
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