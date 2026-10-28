"""简历响应与手动纠正的数据契约。"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SectionKey = Literal["profile", "education", "experience", "projects", "skills", "awards", "other"]


class ResumeQuality(BaseModel):
    filled: int
    total: int
    missing_sections: list[SectionKey]


class ResumeListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    file_size: int
    created_at: datetime
    quality: ResumeQuality


class ResumeDetail(ResumeListItem):
    full_text: str
    structured_data: dict[str, Any]


class ResumeCorrections(BaseModel):
    """完整提交可编辑字段，前端不会覆盖原始文档及只读元数据。"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=50)
    sections: dict[SectionKey, list[str]] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def validate_text(self) -> "ResumeCorrections":
        if sum(len(line) for values in self.sections.values() for line in values) > 30000:
            raise ValueError("简历修正内容不能超过 30000 字")
        for values in self.sections.values():
            if len(values) > 150 or any(len(line) > 2000 for line in values):
                raise ValueError("单个章节最多 150 行，每行不超过 2000 字")
        return self
