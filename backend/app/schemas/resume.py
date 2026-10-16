"""简历接口响应模型。"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ResumeListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    file_size: int
    created_at: datetime


class ResumeDetail(ResumeListItem):
    full_text: str
    structured_data: dict[str, Any]
