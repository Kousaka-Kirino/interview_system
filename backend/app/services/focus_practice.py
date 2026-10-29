"""Validate AI weaknesses against a completed source session before targeted practice."""
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models.report import InterviewAIReport
from app.models.session import InterviewSession
from app.schemas.report import AIAnalysis


def resolve_focus(db: Session, source_id: str, resume_id: str) -> dict:
    # db is the current user's isolated SQLite database; never trust client-provided points.
    source = db.get(InterviewSession, source_id)
    if source is None or source.status != "completed":
        raise HTTPException(404, "找不到已完成的原答辩")
    if source.resume_id != resume_id:
        raise HTTPException(422, "专项再练必须使用原场次的简历")
    cached = db.get(InterviewAIReport, source_id)
    if cached is None:
        raise HTTPException(409, "原场次尚未生成 AI 复盘，请先生成后再进行专项训练")
    try:
        analysis = AIAnalysis.model_validate(cached.analysis)
    except ValueError as exc:
        raise HTTPException(409, "原场次 AI 复盘内容无效，请重新生成") from exc
    scored = {t.id for t in source.turns if t.answer is not None and t.score is not None and t.score < 80}
    points = []
    seen = set()
    for item in analysis.weak_points:
        if item.turn_id not in scored:
            continue
        key = (item.dimension, item.title.strip())
        if key in seen:
            continue
        seen.add(key)
        points.append({"dimension": item.dimension, "title": item.title.strip()[:100],
                       "reason": item.reason.strip()[:240]})
        if len(points) >= 3:
            break
    if not points:
        raise HTTPException(409, "原场次没有有评分依据的薄弱点，请选择普通再练")
    return {"source_session_id": source_id, "weak_points": points}


def focus_of(session: InterviewSession) -> dict | None:
    value = session.config_data.get("practice_focus") if isinstance(session.config_data, dict) else None
    if not isinstance(value, dict) or not isinstance(value.get("weak_points"), list):
        return None
    return value
