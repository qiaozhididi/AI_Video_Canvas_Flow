"""add user_id to ai_providers

Revision ID: a2b3c4d5e6f7
Revises: b2c3d4e5f6a7
Create Date: 2026-07-10 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = '18e962ca68fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# qzfrato 用户 ID（现有数据绑定到此用户）
QZFRATO_USER_ID = 'ea148b9e-ecde-4fbc-9335-95edc4b7dec0'


def upgrade() -> None:
    # 1. 添加 user_id 列（先允许 NULL 以便回填数据）
    op.add_column('ai_providers', sa.Column('user_id', sa.UUID(), nullable=True))

    # 2. 将现有数据绑定到 qzfrato 用户
    op.execute(f"UPDATE ai_providers SET user_id = '{QZFRATO_USER_ID}' WHERE user_id IS NULL")

    # 3. 设置为 NOT NULL
    op.alter_column('ai_providers', 'user_id', nullable=False)

    # 4. 添加外键约束
    op.create_foreign_key(
        'ai_providers_user_id_fkey',
        'ai_providers', 'users',
        ['user_id'], ['id'],
        ondelete='CASCADE',
    )

    # 5. 添加索引（按用户查询 Provider 是高频操作）
    op.create_index(
        'ix_ai_providers_user_id',
        'ai_providers',
        ['user_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_ai_providers_user_id', table_name='ai_providers')
    op.drop_constraint('ai_providers_user_id_fkey', 'ai_providers', type_='foreignkey')
    op.drop_column('ai_providers', 'user_id')
