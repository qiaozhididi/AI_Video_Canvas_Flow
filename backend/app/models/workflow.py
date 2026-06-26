"""WorkflowNode / WorkflowEdge ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, JSON, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WorkflowNode(Base):
    """工作流节点：对应画布上的一个 AI/媒体/逻辑节点"""

    __tablename__ = "workflow_nodes"

    # 使用前端生成的字符串 ID（如 node-1782476890770-n9ckd6），兼容 ReactFlow
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    node_type: Mapped[str] = mapped_column(String(64))  # 节点类型：input/ai_inference/processing/control/output
    label: Mapped[str | None] = mapped_column(String(128))
    position_x: Mapped[float] = mapped_column(default=0.0)
    position_y: Mapped[float] = mapped_column(default=0.0)
    config: Mapped[dict | None] = mapped_column(JSON)  # 节点完整数据（CanvasNodeData）
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)


class WorkflowEdge(Base):
    """工作流边：连接两个节点，定义数据流向"""

    __tablename__ = "workflow_edges"

    # 使用前端生成的字符串 ID（如 edge-xxx），兼容 ReactFlow
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    source_node_id: Mapped[str] = mapped_column(String(128), ForeignKey("workflow_nodes.id"))
    target_node_id: Mapped[str] = mapped_column(String(128), ForeignKey("workflow_nodes.id"))
    source_port: Mapped[str | None] = mapped_column(String(64))
    target_port: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
