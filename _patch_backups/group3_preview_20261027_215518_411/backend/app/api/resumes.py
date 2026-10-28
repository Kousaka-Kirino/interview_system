"""简历 CRUD：文件保存在本机，结构化数据保存在 SQLite。"""

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.stage11_local import get_user_settings
from app.core.database import get_db
from app.models.resume import Resume
from app.schemas.resume import ResumeCorrections, ResumeDetail, ResumeListItem
from app.services.resume_parser import extract_resume_text, parse_resume_sections, resume_quality

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/resumes", tags=["resumes"])
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx"}


def _resume_or_404(resume_id: str, db: Session) -> Resume:
    resume = db.get(Resume, resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="简历不存在")
    return resume


def _payload(resume: Resume, *, detail: bool = True) -> dict:
    """在响应中按需计算质量，不需要改变现有 SQLite 表。"""
    data = {
        "id": resume.id,
        "original_filename": resume.original_filename,
        "file_size": resume.file_size,
        "created_at": resume.created_at,
        "quality": resume_quality(resume.structured_data),
    }
    if detail:
        data.update(full_text=resume.full_text, structured_data=resume.structured_data)
    return data


@router.post("", response_model=ResumeDetail, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_user_settings),
) -> dict:
    # 文件名仅用于展示；持久化时使用 UUID 文件名，防止路径穿越。
    original_name = Path((file.filename or "").replace("\\", "/")).name
    extension = Path(original_name).suffix.lower()
    if not original_name or extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="只支持 .pdf 或 .docx 简历")

    try:
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="简历不能超过 8 MB")
    if not raw:
        raise HTTPException(status_code=422, detail="上传的文件为空")

    try:
        text = extract_resume_text(raw, extension)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    resume_id = str(uuid4())
    stored_filename = f"{resume_id}{extension}"
    folder = settings.uploads_dir / "resumes"
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / stored_filename
    destination.write_bytes(raw)

    resume = Resume(
        id=resume_id,
        original_filename=original_name[:255],
        stored_filename=stored_filename,
        file_size=len(raw),
        full_text=text,
        structured_data=parse_resume_sections(text),
    )
    try:
        db.add(resume)
        db.commit()
        db.refresh(resume)
    except SQLAlchemyError:
        db.rollback()
        destination.unlink(missing_ok=True)
        logger.exception("简历写入数据库失败")
        raise HTTPException(status_code=500, detail="保存简历失败") from None
    return _payload(resume)


@router.get("", response_model=list[ResumeListItem])
def list_resumes(db: Session = Depends(get_db)) -> list[dict]:
    return [_payload(r, detail=False) for r in db.scalars(select(Resume).order_by(Resume.created_at.desc())).all()]


@router.get("/{resume_id}", response_model=ResumeDetail)
def get_resume(resume_id: str, db: Session = Depends(get_db)) -> dict:
    return _payload(_resume_or_404(resume_id, db))


@router.patch("/{resume_id}", response_model=ResumeDetail)
def update_resume(
    resume_id: str,
    body: ResumeCorrections,
    db: Session = Depends(get_db),
) -> dict:
    resume = _resume_or_404(resume_id, db)
    # 合并原有元数据；不修改原始提取文本或上传文件。
    current = dict(resume.structured_data or {})
    current.update({
        "name": body.name.strip() or None if body.name is not None else None,
        "email": body.email.strip() or None if body.email is not None else None,
        "phone": body.phone.strip() or None if body.phone is not None else None,
        "sections": {key: [line.strip() for line in lines if line.strip()]
                     for key, lines in body.sections.items()},
        "manual_reviewed": True,
    })
    resume.structured_data = current  # 重新赋值，确保 SQLAlchemy JSON 变更被追踪
    try:
        db.commit()
        db.refresh(resume)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("简历修正保存失败")
        raise HTTPException(status_code=500, detail="保存简历修正失败") from None
    return _payload(resume)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_user_settings),
) -> Response:
    resume = _resume_or_404(resume_id, db)
    saved_path = settings.uploads_dir / "resumes" / resume.stored_filename
    db.delete(resume)
    db.commit()
    try:
        saved_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("简历记录已删除，但原文件清理失败：%s", resume_id, exc_info=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
