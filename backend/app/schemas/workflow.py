"""节点/边 schema"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class NodeCreate(BaseModel):
    """创建节点请求"""
    node_type: str
    label: str | None = None
    position_x: float = 0.0
    position_y: float = 0.0
    config: dict | None = None


class NodeResponse(BaseModel):
    """节点响应"""
    id: UUID
    project_id: UUID
    node_type: str
    label: str | None
    position_x: float
    position_y: float
    config: dict | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EdgeCreate(BaseModel):
    """创建边请求"""
    source_node_id: UUID
    target_node_id: UUID
    source_port: str | None = None
    target_port: str | None = None


class EdgeResponse(BaseModel):
    """边响应"""
    id: UUID
    project_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    source_port: str | None
    target_port: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
