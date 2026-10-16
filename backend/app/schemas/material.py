"""补充资料的 API 数据结构。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MaterialInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    file_size: int
    chunk_count: int
    created_at: datetime


class MaterialSearchRequest(BaseModel):
    query: str = Field(
        min_length=2,
        max_length=500
    )

    material_ids: list[str] = Field(
        min_length=1,
        max_length=10
    )

    top_k: int = Field(
        default=5,
        ge=1,
        le=10
    )


class MaterialHit(BaseModel):
    material_id: str
    original_filename: str
    chunk_index: int
    text: str

    # 余弦距离，越小越相似
    distance: float


class MaterialSearchResponse(BaseModel):
    hits: list[MaterialHit]