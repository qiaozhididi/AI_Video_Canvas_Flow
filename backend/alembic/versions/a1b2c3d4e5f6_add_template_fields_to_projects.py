"""add template fields to projects

Revision ID: a1b2c3d4e5f6
Revises: 7b66d54b0781
Create Date: 2026-06-27 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '7b66d54b0781'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 新增模板相关字段
    op.add_column('projects', sa.Column('is_template', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('projects', sa.Column('template_category', sa.String(length=32), nullable=True))
    op.add_column('projects', sa.Column('template_tags', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.create_index('ix_projects_is_template', 'projects', ['is_template'], unique=False)

    # Seed 3 个官方模板
    bind = op.get_bind()

    # 查询第一个用户作为模板 owner（若无用户则跳过 seed）
    result = bind.execute(sa.text("SELECT id FROM users ORDER BY id LIMIT 1"))
    row = result.fetchone()
    if row is None:
        print("WARNING: no user found, skipping template seed")
        return
    owner_id = row[0]

    import uuid as _uuid
    import json

    templates = [
        {
            "name": "文生图工作流",
            "description": "从文本描述生成图片，基础文生图工作流模板",
            "tags": ["文生图", "图像生成"],
            "nodes": [
                {"id": "tpl-t2i-in", "node_type": "input", "label": "文本输入", "position_x": 100, "position_y": 200, "config": {"params": {"text": "一只可爱的猫咪"}}},
                {"id": "tpl-t2i-gen", "node_type": "ai_inference", "label": "文生图", "position_x": 400, "position_y": 200, "config": {"taskType": "ai_text2img"}},
            ],
            "edges": [
                {"id": "tpl-t2i-e1", "source_node_id": "tpl-t2i-in", "target_node_id": "tpl-t2i-gen", "source_port": "out", "target_port": "in"},
            ],
        },
        {
            "name": "图生视频工作流",
            "description": "从图片生成视频片段，基础图生视频工作流模板",
            "tags": ["图生视频", "视频生成"],
            "nodes": [
                {"id": "tpl-i2v-in", "node_type": "input", "label": "图片输入", "position_x": 100, "position_y": 200, "config": {"params": {"url": ""}}},
                {"id": "tpl-i2v-gen", "node_type": "ai_inference", "label": "图生视频", "position_x": 400, "position_y": 200, "config": {"taskType": "ai_img2video"}},
            ],
            "edges": [
                {"id": "tpl-i2v-e1", "source_node_id": "tpl-i2v-in", "target_node_id": "tpl-i2v-gen", "source_port": "out", "target_port": "in"},
            ],
        },
        {
            "name": "文生图→图生视频",
            "description": "先文生图再图生视频的完整工作流模板",
            "tags": ["文生图", "图生视频", "全流程"],
            "nodes": [
                {"id": "tpl-full-in", "node_type": "input", "label": "文本输入", "position_x": 100, "position_y": 200, "config": {"params": {"text": "一只可爱的猫咪"}}},
                {"id": "tpl-full-t2i", "node_type": "ai_inference", "label": "文生图", "position_x": 400, "position_y": 200, "config": {"taskType": "ai_text2img"}},
                {"id": "tpl-full-i2v", "node_type": "ai_inference", "label": "图生视频", "position_x": 700, "position_y": 200, "config": {"taskType": "ai_img2video"}},
            ],
            "edges": [
                {"id": "tpl-full-e1", "source_node_id": "tpl-full-in", "target_node_id": "tpl-full-t2i", "source_port": "out", "target_port": "in"},
                {"id": "tpl-full-e2", "source_node_id": "tpl-full-t2i", "target_node_id": "tpl-full-i2v", "source_port": "out", "target_port": "in"},
            ],
        },
    ]

    for tpl in templates:
        project_id = _uuid.uuid4()
        # 插入 project（is_template=True）
        bind.execute(sa.text(
            "INSERT INTO projects (id, name, description, cover_url, owner_id, is_template, template_category, template_tags, created_at, updated_at) "
            "VALUES (:id, :name, :description, NULL, :owner_id, TRUE, :category, CAST(:tags AS JSONB), NOW(), NOW())"
        ), {
            "id": project_id,
            "name": tpl["name"],
            "description": tpl["description"],
            "owner_id": owner_id,
            "category": "官方",
            "tags": json.dumps(tpl["tags"], ensure_ascii=False),
        })

        # 插入 nodes
        for node in tpl["nodes"]:
            bind.execute(sa.text(
                "INSERT INTO workflow_nodes (id, project_id, node_type, label, position_x, position_y, config, created_at, updated_at) "
                "VALUES (:id, :project_id, :node_type, :label, :px, :py, CAST(:config AS JSONB), NOW(), NOW())"
            ), {
                "id": node["id"],
                "project_id": project_id,
                "node_type": node["node_type"],
                "label": node["label"],
                "px": node["position_x"],
                "py": node["position_y"],
                "config": json.dumps(node["config"], ensure_ascii=False),
            })

        # 插入 edges
        for edge in tpl["edges"]:
            bind.execute(sa.text(
                "INSERT INTO workflow_edges (id, project_id, source_node_id, target_node_id, source_port, target_port, created_at, updated_at) "
                "VALUES (:id, :project_id, :source, :target, :sp, :tp, NOW(), NOW())"
            ), {
                "id": edge["id"],
                "project_id": project_id,
                "source": edge["source_node_id"],
                "target": edge["target_node_id"],
                "sp": edge["source_port"],
                "tp": edge["target_port"],
            })

    print(f"Seeded {len(templates)} official templates")


def downgrade() -> None:
    # 删除所有官方模板及其工作流（is_template=True 的项目）
    bind = op.get_bind()
    # 先查模板项目 ID
    result = bind.execute(sa.text("SELECT id FROM projects WHERE is_template = TRUE"))
    template_ids = [row[0] for row in result.fetchall()]
    if template_ids:
        # 删除关联的 edges 和 nodes（手动级联，因外键无 ondelete=CASCADE）
        for tid in template_ids:
            bind.execute(sa.text("DELETE FROM workflow_edges WHERE project_id = :pid"), {"pid": tid})
            bind.execute(sa.text("DELETE FROM workflow_nodes WHERE project_id = :pid"), {"pid": tid})
        # 删除模板项目
        bind.execute(sa.text("DELETE FROM projects WHERE is_template = TRUE"))

    op.drop_index('ix_projects_is_template', table_name='projects')
    op.drop_column('projects', 'template_tags')
    op.drop_column('projects', 'template_category')
    op.drop_column('projects', 'is_template')
