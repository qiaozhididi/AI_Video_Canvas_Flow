"""expand node_id length from 36 to 128

Revision ID: c3d4e5f6a7b8
Revises: f0a9bdfe0c55
Create Date: 2026-07-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'f0a9bdfe0c55'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('render_tasks', 'node_id',
                    existing_type=sa.String(36),
                    type_=sa.String(128),
                    existing_nullable=True)


def downgrade() -> None:
    op.alter_column('render_tasks', 'node_id',
                    existing_type=sa.String(128),
                    type_=sa.String(36),
                    existing_nullable=True)
