"""render_task_progress_int

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-03 12:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: str | None = 'a1b2c3d4e5f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column('render_tasks', 'progress',
                    existing_type=sa.Float(),
                    type_=sa.Integer(),
                    existing_nullable=True)


def downgrade() -> None:
    op.alter_column('render_tasks', 'progress',
                    existing_type=sa.Integer(),
                    type_=sa.Float(),
                    existing_nullable=True)
