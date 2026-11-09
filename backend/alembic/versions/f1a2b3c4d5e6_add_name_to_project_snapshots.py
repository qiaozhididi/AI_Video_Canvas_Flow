"""add name to project_snapshots

Revision ID: f1a2b3c4d5e6
Revises: a2b3c4d5e6f7
Create Date: 2026-07-12

为 project_snapshots 表添加 name 列，支持手动版本快照命名。
模型层已定义该字段（project_snapshot.py L29），但建表迁移遗漏，此迁移补齐。
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: str | None = 'a2b3c4d5e6f7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'project_snapshots',
        sa.Column('name', sa.String(length=100), nullable=True, comment='版本快照名称'),
    )


def downgrade() -> None:
    op.drop_column('project_snapshots', 'name')
