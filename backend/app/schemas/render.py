"""渲染任务 schema"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RenderTaskResponse(BaseModel):
    """渲染任务响应"""
    id: UUID
    project_id: UUID
    owner_id: UUID
    task_type: str
    status: str
    progress: int  # 0-100 整数百分比
    celery_task_id: str | None
    result_url: str | None
    error_message: str | None
    node_id: str | None
    node_label: str | None
    project_name: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
