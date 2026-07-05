"""add is_default to ai_models + cascade on provider_id

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a7b8c9"
down_revision = ("b2c3d4e5f6a7", "c3d4e5f6a7b8")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 添加 is_default 列
    op.add_column(
        "ai_models",
        sa.Column("is_default", sa.Boolean(), nullable=True, server_default=sa.text("false")),
    )
    # 修改 provider_id 外键为 CASCADE
    op.drop_constraint("ai_models_provider_id_fkey", "ai_models", type_="foreignkey")
    op.create_foreign_key(
        "ai_models_provider_id_fkey",
        "ai_models",
        "ai_providers",
        ["provider_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_column("ai_models", "is_default")
    op.drop_constraint("ai_models_provider_id_fkey", "ai_models", type_="foreignkey")
    op.create_foreign_key(
        "ai_models_provider_id_fkey",
        "ai_models",
        "ai_providers",
        ["provider_id"],
        ["id"],
    )
