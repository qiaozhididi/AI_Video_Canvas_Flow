"""MediaAsset ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MediaAsset(Base):
    """媒体资产：图片/视频/音频等文件元数据"""

    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id"))
    file_name: Mapped[str] = mapped_column(String(256))
    file_type: Mapped[str] = mapped_column(String(64))  # MIME 类型
    file_size: Mapped[int] = mapped_column(BigInteger)  # 字节
    storage_key: Mapped[str] = mapped_column(String(512))  # MinIO 对象键
    thumbnail_key: Mapped[str | None] = mapped_column(String(512))  # 缩略图对象键
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
