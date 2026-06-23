"""项目 CRUD schema"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ProjectCreate(BaseModel):
    """创建项目请求"""
    name: str
    description: str | None = None
    cover_url: str | None = None


class ProjectUpdate(BaseModel):
    """更新项目请求"""
    name: str | None = None
    description: str | None = None
    cover_url: str | None = None


class ProjectResponse(BaseModel):
    """项目响应"""
    id: UUID
    name: str
    description: str | None
    cover_url: str | None
    owner_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
