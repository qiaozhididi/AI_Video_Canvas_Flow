"""模板市场路由：列表/克隆/发布/取消发布"""

import logging
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, Text

from app.deps import DBSession, CurrentUser
from app.models.project import Project
from app.models.workflow import WorkflowNode, WorkflowEdge
from app.schemas.project import TemplateResponse, TemplatePublishRequest, ProjectResponse

logger = logging.getLogger("app.api.templates")

router = APIRouter()


def _to_template_response(p: Project) -> TemplateResponse:
    return TemplateResponse(
        id=str(p.id),
        name=p.name,
        description=p.description,
        cover_url=p.cover_url,
        owner_id=str(p.owner_id),
        created_at=p.created_at,
        updated_at=p.updated_at,
        is_template=p.is_template,
        template_category=p.template_category,
        template_tags=p.template_tags,
    )


def _to_project_response(p: Project) -> ProjectResponse:
    return ProjectResponse(
        id=str(p.id),
        name=p.name,
        description=p.description,
        cover_url=p.cover_url,
        owner_id=str(p.owner_id),
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("/templates/", response_model=list[TemplateResponse], summary="获取模板列表")
async def list_templates(
    db: DBSession,
    current_user: CurrentUser,
    q: str | None = None,
    category: str | None = None,
):
    """获取模板列表（支持 q 搜索 name/tags，category 筛选）"""
    stmt = select(Project).where(Project.is_template == True)
    if category:
        stmt = stmt.where(Project.template_category == category)
    if q:
        # name 模糊匹配 OR tags 包含 q（JSON 数组）
        stmt = stmt.where(
            Project.name.ilike(f"%{q}%")
            | Project.template_tags.cast(Text).ilike(f"%{q}%")
        )
    stmt = stmt.order_by(Project.created_at.desc())
    result = await db.execute(stmt)
    templates = result.scalars().all()
    return [_to_template_response(t) for t in templates]


@router.post("/templates/{template_id}/clone", response_model=ProjectResponse, summary="克隆模板为新项目")
async def clone_template(template_id: str, db: DBSession, current_user: CurrentUser):
    """克隆模板为新项目（复制 nodes/edges，新节点 ID 加前缀避免冲突）"""
    owner_id = uuid.UUID(current_user)

    # 查询模板
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(template_id), Project.is_template == True)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")

    # 创建新项目
    new_project = Project(
        name=f"{template.name} 副本",
        description=template.description,
        cover_url=template.cover_url,
        owner_id=owner_id,
        is_template=False,
    )
    db.add(new_project)
    await db.flush()  # 获取 new_project.id

    # 复制 nodes（新节点 ID 加项目前缀）
    new_project_prefix = str(new_project.id)[:8]
    node_result = await db.execute(
        select(WorkflowNode).where(WorkflowNode.project_id == template.id)
    )
    node_id_map = {}  # 旧 ID → 新 ID
    for node in node_result.scalars().all():
        new_node_id = f"{new_project_prefix}_{node.id}"
        node_id_map[node.id] = new_node_id
        new_node = WorkflowNode(
            id=new_node_id,
            project_id=new_project.id,
            node_type=node.node_type,
            label=node.label,
            position_x=node.position_x,
            position_y=node.position_y,
            config=node.config,
        )
        db.add(new_node)

    await db.flush()  # 确保 nodes 已插入，再插 edges

    # 复制 edges
    edge_result = await db.execute(
        select(WorkflowEdge).where(WorkflowEdge.project_id == template.id)
    )
    for edge in edge_result.scalars().all():
        new_edge_id = f"{new_project_prefix}_{edge.id}"
        new_edge = WorkflowEdge(
            id=new_edge_id,
            project_id=new_project.id,
            source_node_id=node_id_map[edge.source_node_id],
            target_node_id=node_id_map[edge.target_node_id],
            source_port=edge.source_port,
            target_port=edge.target_port,
        )
        db.add(new_edge)

    await db.commit()
    await db.refresh(new_project)
    logger.info(f"[Template:Clone] from={template_id} to={new_project.id}")
    return _to_project_response(new_project)


@router.post("/projects/{project_id}/publish", response_model=TemplateResponse, summary="发布项目为模板")
async def publish_project(
    project_id: str,
    body: TemplatePublishRequest,
    db: DBSession,
    current_user: CurrentUser,
):
    """将项目发布为模板"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(project_id))
    )
    project = result.scalar_one_or_none()
    if not project or project.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="项目不存在")

    project.is_template = True
    project.template_category = body.category
    project.template_tags = body.tags
    await db.commit()
    await db.refresh(project)
    logger.info(f"[Template:Publish] project_id={project_id}")
    return _to_template_response(project)


@router.delete("/templates/{template_id}", status_code=204, summary="取消模板发布")
async def unpublish_template(template_id: str, db: DBSession, current_user: CurrentUser):
    """取消模板发布（仅 owner）"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(template_id), Project.is_template == True)
    )
    project = result.scalar_one_or_none()
    if not project or project.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="模板不存在")

    project.is_template = False
    project.template_category = None
    project.template_tags = None
    await db.commit()
    logger.info(f"[Template:Unpublish] template_id={template_id}")
