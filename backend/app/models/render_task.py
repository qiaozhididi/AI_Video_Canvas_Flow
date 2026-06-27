"""RenderTask ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RenderTask(Base):
    """渲染任务：跟踪视频/AI 推理任务的执行状态"""

    __tablename__ = "render_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    task_type: Mapped[str] = mapped_column(String(64))  # text2img / img2video / tts / render
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending / running / completed / failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0.0 ~ 1.0
    celery_task_id: Mapped[str | None] = mapped_column(String(256))  # Celery 任务 ID
    result_url: Mapped[str | None] = mapped_column(String(512))  # 结果文件 URL
    error_message: Mapped[str | None] = mapped_column(Text)  # 错误信息
    node_id: Mapped[str | None] = mapped_column(String(36))  # 关联的画布节点 ID
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
