"""快照 schema"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class SnapshotCreate(BaseModel):
    """创建快照请求"""
    source: Literal["auto", "manual"]
    name: str | None = None
    label: str | None = None
    snapshot_data: dict  # {nodes: [...], edges: [...], timelineData: {...}}


class SnapshotResponse(BaseModel):
    """快照响应"""
    id: UUID
    project_id: UUID
    owner_id: UUID
    source: str
    name: str | None = None
    label: str | None
    snapshot_data: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class SnapshotRestoreResponse(BaseModel):
    """恢复快照响应"""
    restored: bool
    project_id: UUID
    nodes_count: int
    edges_count: int
