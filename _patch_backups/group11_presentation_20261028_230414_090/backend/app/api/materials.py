"""资料上传、索引、检索、列表及删除接口。"""

import logging

from pathlib import Path
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)

from starlette.concurrency import run_in_threadpool

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.stage11_local import get_user_settings
from app.core.database import get_db

from app.models.material import Material

from app.schemas.material import (
    MaterialHit,
    MaterialInfo,
    MaterialSearchRequest,
    MaterialSearchResponse,
)

from app.services.document_preview import preview_document

from app.services.material_parser import (
    extract_material_text,
    split_text,
)

from app.services.vector_store import (
    VectorStore,
    get_vector_store,
)


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/materials",
    tags=["materials"]
)

MAX_UPLOAD_BYTES = 12 * 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".docx"
}


@router.post(
    "",
    response_model=MaterialInfo,
    status_code=status.HTTP_201_CREATED
)
async def upload_material(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_user_settings),
    store: VectorStore = Depends(get_vector_store),
) -> Material:

    original_name = Path(
        (file.filename or "").replace("\\", "/")
    ).name

    extension = Path(
        original_name
    ).suffix.lower()

    if (
        not original_name
        or extension not in ALLOWED_EXTENSIONS
    ):
        raise HTTPException(
            status_code=415,
            detail="资料仅支持 .pdf 或 .docx"
        )

    try:
        raw = await file.read(
            MAX_UPLOAD_BYTES + 1
        )
    finally:
        await file.close()

    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="资料不能超过 12 MiB"
        )

    if not raw:
        raise HTTPException(
            status_code=422,
            detail="上传文件为空"
        )

    # 提取资料文本
    try:
        text = await run_in_threadpool(
            extract_material_text,
            raw,
            extension
        )

    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc)
        ) from exc

    # 文本切分
    chunks = split_text(text)

    # 使用 UUID 存储文件
    material_id = str(uuid4())

    stored_filename = (
        f"{material_id}{extension}"
    )

    folder = (
        settings.uploads_dir / "materials"
    )

    destination = (
        folder / stored_filename
    )

    # 保存原文件
    try:
        folder.mkdir(
            parents=True,
            exist_ok=True
        )

        await run_in_threadpool(
            destination.write_bytes,
            raw
        )

    except OSError as exc:

        logger.exception(
            "保存资料原文件失败"
        )

        raise HTTPException(
            status_code=500,
            detail="资料文件保存失败"
        ) from exc

    # 写入 ChromaDB
    try:
        await run_in_threadpool(
            store.add_chunks,
            material_id,
            original_name[:255],
            chunks
        )

    except Exception as exc:

        logger.exception(
            "建立资料向量索引失败"
        )

        # 尝试清理不完整的索引
        try:
            await run_in_threadpool(
                store.delete_material,
                material_id
            )

        except Exception:
            logger.warning(
                "向量索引清理失败：%s",
                material_id,
                exc_info=True
            )

        destination.unlink(
            missing_ok=True
        )

        raise HTTPException(
            status_code=503,
            detail=(
                "资料索引失败，请检查 "
                "Embedding 模型及 ChromaDB"
            )
        ) from exc

    # 保存 SQLite 元数据
    material = Material(
        id=material_id,
        original_filename=original_name[:255],
        stored_filename=stored_filename,
        file_size=len(raw),
        chunk_count=len(chunks)
    )

    try:
        db.add(material)
        db.commit()
        db.refresh(material)

    except SQLAlchemyError as exc:

        db.rollback()

        try:
            await run_in_threadpool(
                store.delete_material,
                material_id
            )

        except Exception:
            logger.warning(
                "回滚向量失败：%s",
                material_id,
                exc_info=True
            )

        destination.unlink(
            missing_ok=True
        )

        logger.exception(
            "资料元数据写入失败"
        )

        raise HTTPException(
            status_code=500,
            detail="资料元数据保存失败"
        ) from exc

    return material


@router.get(
    "",
    response_model=list[MaterialInfo]
)
def list_materials(
    db: Session = Depends(get_db)
) -> list[Material]:

    return list(
        db.scalars(
            select(Material).order_by(
                Material.created_at.desc()
            )
        ).all()
    )


@router.post(
    "/search",
    response_model=MaterialSearchResponse
)
async def search_materials(
    body: MaterialSearchRequest,
    db: Session = Depends(get_db),
    store: VectorStore = Depends(get_vector_store),
) -> MaterialSearchResponse:

    if not body.query.strip():
        raise HTTPException(
            status_code=422,
            detail="检索问题不能为空"
        )

    # 去除重复的资料 ID
    ids = list(
        dict.fromkeys(
            body.material_ids
        )
    )

    # 检查资料是否真实存在
    known_ids = set(
        db.scalars(
            select(Material.id).where(
                Material.id.in_(ids)
            )
        ).all()
    )

    missing_ids = [
        id_
        for id_ in ids
        if id_ not in known_ids
    ]

    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail={
                "missing_material_ids": missing_ids
            }
        )

    try:
        hits: list[MaterialHit] = (
            await run_in_threadpool(
                store.search,
                body.query.strip(),
                ids,
                body.top_k
            )
        )

    except Exception as exc:

        logger.exception(
            "资料检索失败"
        )

        raise HTTPException(
            status_code=503,
            detail="向量检索暂不可用"
        ) from exc

    return MaterialSearchResponse(
        hits=hits
    )


@router.get("/{material_id}/preview")
def preview_material(
    material_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_user_settings),
) -> Response:
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="资料不存在")
    return preview_document(settings.uploads_dir, "materials", material.stored_filename, max_bytes=MAX_UPLOAD_BYTES)


@router.delete(
    "/{material_id}",
    status_code=status.HTTP_204_NO_CONTENT
)
async def delete_material(
    material_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_user_settings),
    store: VectorStore = Depends(get_vector_store),
) -> Response:

    material = db.get(
        Material,
        material_id
    )

    if material is None:
        raise HTTPException(
            status_code=404,
            detail="资料不存在"
        )

    # 先删除向量索引
    try:
        await run_in_threadpool(
            store.delete_material,
            material_id
        )

    except Exception as exc:

        logger.exception(
            "删除资料向量失败"
        )

        raise HTTPException(
            status_code=503,
            detail="无法删除向量索引，请稍后重试"
        ) from exc

    # 再删除 SQLite 元数据
    db.delete(material)

    try:
        db.commit()

    except SQLAlchemyError as exc:

        db.rollback()

        logger.exception(
            "删除资料元数据失败"
        )

        raise HTTPException(
            status_code=500,
            detail="删除资料记录失败"
        ) from exc

    # 最后尝试删除原文件
    try:
        (
            settings.uploads_dir
            / "materials"
            / material.stored_filename
        ).unlink(missing_ok=True)

    except OSError:

        logger.warning(
            "资料已删除，但原文件清理失败：%s",
            material_id,
            exc_info=True
        )

    return Response(
        status_code=204
    )