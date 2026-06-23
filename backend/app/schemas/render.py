"""渲染任务 schema"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RenderTaskCreate(BaseModel):
    """创建渲染任务请求"""
    project_id: UUID
    task_type: str  # text2img / img2video / tts / render


class RenderTaskResponse(BaseModel):
    """渲染任务响应"""
    id: UUID
    project_id: UUID
    owner_id: UUID
    task_type: str
    status: str
    progress: float
    celery_task_id: str | None
    result_url: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
