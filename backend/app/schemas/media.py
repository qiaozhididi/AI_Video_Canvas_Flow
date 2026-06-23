"""媒体资产 schema"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class MediaAssetResponse(BaseModel):
    """媒体资产响应"""
    id: UUID
    owner_id: UUID
    project_id: UUID | None
    file_name: str
    file_type: str
    file_size: int
    storage_key: str
    thumbnail_key: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
