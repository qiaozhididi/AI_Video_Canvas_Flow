"""项目 CRUD 路由"""

import logging
import uuid

from fastapi import APIRouter, HTTPException, UploadFile
from sqlalchemy import func, select

from app.deps import DBSession, CurrentUser, CurrentUserWithToken
from app.models.project import Project
from app.models.render_task import RenderTask
from app.models.media_asset import MediaAsset
from app.models.workflow import WorkflowNode, WorkflowEdge
from app.models.project_snapshot import ProjectSnapshot
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from app.services.media_service import upload_file
from app.config import settings

logger = logging.getLogger("app.api.projects")

router = APIRouter()


@router.get("/", response_model=list[ProjectResponse], summary="获取项目列表")
async def list_projects(db: DBSession, current_user: CurrentUser):
    """获取当前用户的项目列表"""
    owner_id = uuid.UUID(current_user)
    result = await db.execute(select(Project).where(Project.owner_id == owner_id))
    projects = result.scalars().all()

    # 批量查询每个项目的节点数
    project_ids = [p.id for p in projects]
    node_count_map: dict[str, int] = {}
    if project_ids:
        nc_result = await db.execute(
            select(WorkflowNode.project_id, func.count(WorkflowNode.id))
            .where(WorkflowNode.project_id.in_(project_ids))
            .group_by(WorkflowNode.project_id)
        )
        node_count_map = {str(pid): cnt for pid, cnt in nc_result.all()}

    return [
        ProjectResponse(
            id=str(p.id),
            name=p.name,
            description=p.description,
            cover_url=p.cover_url,
            node_count=node_count_map.get(str(p.id), 0),
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
        node_count=0,
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
    nc_result = await db.execute(
        select(func.count(WorkflowNode.id)).where(WorkflowNode.project_id == project.id)
    )
    node_count = nc_result.scalar() or 0
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        description=project.description,
        cover_url=project.cover_url,
        node_count=node_count,
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
    if body.cover_url is not None:
        project.cover_url = body.cover_url
    await db.commit()
    await db.refresh(project)
    nc_result = await db.execute(
        select(func.count(WorkflowNode.id)).where(WorkflowNode.project_id == project.id)
    )
    node_count = nc_result.scalar() or 0
    logger.info(f"[Project:Update] id={project_id}")
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        description=project.description,
        cover_url=project.cover_url,
        node_count=node_count,
        owner_id=str(project.owner_id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("/{project_id}/cover", summary="上传项目封面（覆盖旧封面）")
async def upload_cover(project_id: str, file: UploadFile, db: DBSession, current_user: CurrentUser):
    """上传项目封面到 MinIO 的 covers/ 目录，不进媒体库，覆盖旧文件

    封面与项目 1:1 绑定，每次上传覆盖旧文件，不会产生多余的 MediaAsset 记录。
    """
    owner_id = uuid.UUID(current_user)
    result = await db.execute(
        select(Project).where(Project.id == uuid.UUID(project_id))
    )
    project = result.scalar_one_or_none()
    if not project or project.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="项目不存在")

    content = await file.read()
    # 固定路径：covers/{project_id}.png — 每次上传覆盖旧文件
    storage_key = f"covers/{project_id}.png"

    try:
        await upload_file(
            bucket=settings.MINIO_BUCKET,
            object_name=storage_key,
            file_data=content,
            content_type=file.content_type or "image/png",
        )
    except Exception as e:
        logger.error(f"[Project:Cover] MinIO 上传失败: {e}")
        raise HTTPException(status_code=500, detail="封面上传失败")

    # 更新项目 cover_url（使用代理下载路径）
    cover_url = f"/api/v1/projects/{project_id}/cover/download"
    project.cover_url = cover_url
    await db.commit()

    logger.info(f"[Project:Cover] id={project_id} size={len(content)}")
    return {"cover_url": cover_url}


@router.get("/{project_id}/cover/download", summary="下载项目封面")
async def download_cover(project_id: str, user: CurrentUserWithToken):
    """通过后端代理下载项目封面图片"""
    storage_key = f"covers/{project_id}.png"
    from app.services.media_service import get_presigned_url
    from minio import Minio
    import httpx
    from fastapi.responses import StreamingResponse

    # 先检查文件是否存在，避免 httpx 超时等待
    try:
        client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )
        if not client.stat_object(settings.MINIO_BUCKET, storage_key):
            raise HTTPException(status_code=404, detail="封面不存在")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="封面不存在")

    try:
        url = await get_presigned_url(
            bucket=settings.MINIO_BUCKET,
            object_name=storage_key,
            expires_hours=1,
        )
    except Exception as e:
        logger.error(f"[Project:CoverDownload] 预签名 URL 生成失败: {e}")
        raise HTTPException(status_code=500, detail="封面下载失败")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception:
        raise HTTPException(status_code=404, detail="封面不存在")

    return StreamingResponse(
        iter([resp.content]),
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
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
