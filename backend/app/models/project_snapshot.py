"""ProjectSnapshot ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProjectSnapshot(Base):
    """项目快照：用于自动保存与崩溃恢复

    - source='auto'：受 5 条上限约束（插入前清理最旧）
    - source='manual'：命名快照，不计数
    """

    __tablename__ = "project_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE")
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    snapshot_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source: Mapped[str] = mapped_column(String(16))  # auto / manual
    name: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="版本快照名称")
    label: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    __table_args__ = (
        Index(
            "ix_project_snapshots_project_source_created",
            "project_id",
            "source",
            text("created_at DESC"),
        ),
        Index("ix_project_snapshots_owner_id", "owner_id"),
    )
