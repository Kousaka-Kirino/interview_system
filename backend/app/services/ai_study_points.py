"""Idempotently persist AI review weaknesses to the existing per-user study DB."""

import uuid

from app.schemas.report import AIAnalysis, InterviewReportView
from app.stage7_review import _database, _now


def save_weak_points(user_id: str, report: InterviewReportView, analysis: AIAnalysis) -> int:
    if not user_id:
        raise ValueError("必须取得当前登录用户标识")
    turns = {t.turn_id: t for t in report.turns}
    created = 0
    with _database() as db:
        for point in analysis.weak_points[:5]:
            turn = turns.get(point.turn_id)
            if turn is None:
                continue
            # Stable anchor is unique per user, session and source question.
            anchor = f"ai-review-turn-{point.turn_id}"
            exists = db.execute(
                "SELECT id FROM study_knowledge_points WHERE user_id=? AND session_id=? AND source_anchor=? LIMIT 1",
                (user_id, report.session_id, anchor),
            ).fetchone()
            if exists:
                continue
            source = f"答辩题目：{turn.question}\n你的回答：{turn.answer}\n原始反馈：{turn.feedback or '无'}"
            quote = turn.question[:200]
            if not quote.strip():
                continue
            severity = 4 if turn.score is not None and turn.score < 60 else 3
            now = _now()
            db.execute("""
                INSERT INTO study_knowledge_points (
                    id,user_id,session_id,material_id,source_name,source_anchor,
                    source_text,quote,title,dimension,orientation,severity,important,
                    status,note,created_at,updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                str(uuid.uuid4()), user_id, report.session_id, None,
                "AI 复盘 · 第%d题" % turn.question_number, anchor,
                source[:12000], quote, point.title, point.dimension,
                "依据核验", severity, 1, "pending", point.reason, now, now,
            ))
            created += 1
    return created
