"""项目 CRUD 路由"""

import logging
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.deps import DBSession, CurrentUser
from app.models.project import Project
from app.models.render_task import RenderTask
from app.models.media_asset import MediaAsset
from app.models.workflow import WorkflowNode, WorkflowEdge
from app.models.project_snapshot import ProjectSnapshot
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse

logger = logging.getLogger("app.api.projects")

router = APIRouter()


@router.get("/", response_model=list[ProjectResponse], summary="获取项目列表")
async def list_projects(db: DBSession, current_user: CurrentUser):
    """获取当前用户的项目列表"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(select(Project).where(Project.owner_id == owner_id))
    projects = result.scalars().all()
    return [
        ProjectResponse(
            id=str(p.id),
            name=p.name,
            description=p.description,
            cover_url=p.cover_url,
            owner_id=str(p.owner_id),
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in projects
    ]


@router.post("/", response_model=ProjectResponse, summary="创建新项目")
async def create_project(body: ProjectCreate, db: DBSession, current_user: CurrentUser):
    """创建新项目"""
    owner_id = uuid.UUID(current_user)
    project = Project(
        name=body.name,
        description=body.description,
        owner_id=owner_id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    logger.info(f"[Project:Create] id={project.id} name={body.name}")
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        description=project.description,
        cover_url=project.cover_url,
        owner_id=str(project.owner_id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("/{project_id}", response_model=ProjectResponse, summary="获取项目详情")
async def get_project(project_id: str, db: DBSession, current_user: CurrentUser):
    """获取指定项目详情"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(project_id))
    )
    project = result.scalar_one_or_none()
    if not project or project.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        description=project.description,
        cover_url=project.cover_url,
        owner_id=str(project.owner_id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.put("/{project_id}", response_model=ProjectResponse, summary="更新项目")
async def update_project(project_id: str, body: ProjectUpdate, db: DBSession, current_user: CurrentUser):
    """更新指定项目"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(project_id))
    )
    project = result.scalar_one_or_none()
    if not project or project.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="项目不存在")

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    await db.commit()
    await db.refresh(project)
    logger.info(f"[Project:Update] id={project_id}")
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        description=project.description,
        cover_url=project.cover_url,
        owner_id=str(project.owner_id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.delete("/{project_id}", status_code=204, summary="删除项目")
async def delete_project(project_id: str, db: DBSession, current_user: CurrentUser):
    """删除指定项目（级联删除关联的渲染任务和媒体资产）"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(project_id))
    )
    project = result.scalar_one_or_none()
    if not project or project.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 级联删除关联的渲染任务
    render_result = await db.execute(
        select(RenderTask).where(RenderTask.project_id == uuid.UUID(project_id))
    )
    for task in render_result.scalars().all():
        await db.delete(task)

    # 级联删除关联的媒体资产
    media_result = await db.execute(
        select(MediaAsset).where(MediaAsset.project_id == uuid.UUID(project_id))
    )
    for asset in media_result.scalars().all():
        await db.delete(asset)

    # 级联删除关联的工作流边（先于节点，因 edges 引用 nodes）
    edge_result = await db.execute(
        select(WorkflowEdge).where(WorkflowEdge.project_id == uuid.UUID(project_id))
    )
    for edge in edge_result.scalars().all():
        await db.delete(edge)

    # 级联删除关联的工作流节点
    node_result = await db.execute(
        select(WorkflowNode).where(WorkflowNode.project_id == uuid.UUID(project_id))
    )
    for node in node_result.scalars().all():
        await db.delete(node)

    # 级联删除关联的项目快照（auto + manual）
    snapshot_result = await db.execute(
        select(ProjectSnapshot).where(ProjectSnapshot.project_id == uuid.UUID(project_id))
    )
    for snapshot in snapshot_result.scalars().all():
        await db.delete(snapshot)

    await db.delete(project)
    await db.commit()
    logger.info(f"[Project:Delete] id={project_id}")
