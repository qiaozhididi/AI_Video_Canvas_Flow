"""RenderTask ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RenderTask(Base):
    """渲染任务：跟踪视频/AI 推理任务的执行状态"""

    __tablename__ = "render_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    task_type: Mapped[str] = mapped_column(String(64))  # render / ai_text2img / ai_img2video / ai_tts
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending / running / completed / failed / cancelled
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0~100 整数百分比
    celery_task_id: Mapped[str | None] = mapped_column(String(256))
    result_url: Mapped[str | None] = mapped_column(String(512))
    error_message: Mapped[str | None] = mapped_column(Text)
    node_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
