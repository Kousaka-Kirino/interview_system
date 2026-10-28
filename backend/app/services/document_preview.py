"""Only serve a document named by a trusted database row, inside the active user's upload directory."""

import re
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, Response

from app.services.material_parser import extract_material_text
from app.services.resume_parser import extract_resume_text

_SAFE_STORED_NAME = re.compile(r"[0-9a-fA-F-]{36}\.(?:pdf|docx)\Z")
_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}


def preview_document(
    uploads_dir: Path,
    category: str,
    stored_filename: str,
    *,
    max_bytes: int,
) -> Response:
    """Never use client-supplied paths or the original display filename for disk access."""
    if category not in ("resumes", "materials") or not _SAFE_STORED_NAME.fullmatch(stored_filename):
        raise HTTPException(status_code=404, detail="文件不存在或无法预览")
    root = (uploads_dir / category).resolve()
    path = root / stored_filename
    # Even a local symlink cannot redirect a preview outside this user's upload folder.
    if not path.resolve().is_relative_to(root) or path.is_symlink():
        raise HTTPException(status_code=404, detail="文件不存在或无法预览")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="原文件未找到，可能已被移动或删除")
    try:
        size = path.stat().st_size
        if size <= 0 or size > max_bytes:
            raise HTTPException(status_code=422, detail="原文件大小异常，无法安全预览")
        extension = path.suffix.lower()
        if extension == ".pdf":
            # Browser-native PDF viewer, using the user's own stored original.
            return FileResponse(
                path,
                media_type="application/pdf",
                filename="preview.pdf",
                content_disposition_type="inline",
                headers=_HEADERS,
            )
        raw = path.read_bytes()
        text = extract_resume_text(raw, extension) if category == "resumes" else extract_material_text(raw, extension)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"文件文字预览失败：{exc}") from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="原文件暂时无法读取") from exc
    return PlainTextResponse(text, headers=_HEADERS)
