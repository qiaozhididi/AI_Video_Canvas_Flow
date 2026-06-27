"""AI Model ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AiModel(Base):
    """AI 模型配置"""

    __tablename__ = "ai_models"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_providers.id"))
    model_id: Mapped[str] = mapped_column(String(128), nullable=False)  # 平台模型标识
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)  # 前端显示名
    model_type: Mapped[str] = mapped_column(String(32), nullable=False)  # llm/image_gen/video_gen/tts
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
