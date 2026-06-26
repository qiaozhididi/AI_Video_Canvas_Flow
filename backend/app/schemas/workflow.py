"""节点/边 schema"""

from datetime import datetime

from pydantic import BaseModel


class NodeCreate(BaseModel):
    """创建节点请求"""
    id: str
    node_type: str
    label: str | None = None
    position_x: float = 0.0
    position_y: float = 0.0
    config: dict | None = None


class NodeResponse(BaseModel):
    """节点响应"""
    id: str
    project_id: str
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
    id: str
    source_node_id: str
    target_node_id: str
    source_port: str | None = None
    target_port: str | None = None


class EdgeResponse(BaseModel):
    """边响应"""
    id: str
    project_id: str
    source_node_id: str
    target_node_id: str
    source_port: str | None
    target_port: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowSaveRequest(BaseModel):
    """批量保存工作流请求：替换项目的全部节点和边"""
    nodes: list[NodeCreate]
    edges: list[EdgeCreate]


class WorkflowSaveResponse(BaseModel):
    """批量保存工作流响应"""
    nodes_count: int
    edges_count: int
