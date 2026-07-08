"""协作 WebSocket 路由 + 协作者权限管理 API"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, DBSession
from app.models.project import Project
from app.models.project_collaborator import ProjectCollaborator
from app.models.user import User

logger = logging.getLogger("app.api.collaboration")
router = APIRouter()


# ── 协作服务状态 ──


@router.get("/status", summary="协作服务状态")
async def collab_status():
    """协作服务状态检查"""
    return {"status": "ok", "transport": "socket.io"}


# ── 协作者权限管理 ──


class CollaboratorResponse(BaseModel):
    id: str
    project_id: str
    user_id: str
    username: str
    role: str
    joined_at: datetime

    class Config:
        from_attributes = True


class UpdateRoleRequest(BaseModel):
    role: str  # editor/viewer


@router.get("/projects/{project_id}/collaborators", response_model=list[CollaboratorResponse], summary="获取协作者列表")
async def list_collaborators(project_id: str, user: CurrentUser, db: DBSession):
    pid = uuid.UUID(project_id)
    # 验证项目存在且用户有权限
    project = await db.get(Project, pid)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # owner 或协作者均可查看
    is_owner = str(project.owner_id) == user
    if not is_owner:
        collab = await db.execute(
            select(ProjectCollaborator).where(
                ProjectCollaborator.project_id == pid,
                ProjectCollaborator.user_id == uuid.UUID(user),
            )
        )
        if not collab.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="无权查看")

    # owner 隐式拥有 owner 角色
    result = []
    owner_user = await db.get(User, project.owner_id)
    result.append(CollaboratorResponse(
        id="owner",
        project_id=str(pid),
        user_id=str(project.owner_id),
        username=owner_user.username if owner_user else "unknown",
        role="owner",
        joined_at=project.created_at,
    ))

    # 查询显式协作者
    collabs = await db.execute(
        select(ProjectCollaborator).where(ProjectCollaborator.project_id == pid)
    )
    for c in collabs.scalars().all():
        u = await db.get(User, c.user_id)
        result.append(CollaboratorResponse(
            id=str(c.id),
            project_id=str(c.project_id),
            user_id=str(c.user_id),
            username=u.username if u else "unknown",
            role=c.role,
            joined_at=c.joined_at,
        ))

    return result


@router.put("/projects/{project_id}/collaborators/{user_id}", summary="修改协作者权限")
async def update_collaborator_role(project_id: str, user_id: str, body: UpdateRoleRequest, user: CurrentUser, db: DBSession):
    pid = uuid.UUID(project_id)
    uid = uuid.UUID(user_id)

    # 仅 owner 可修改权限
    project = await db.get(Project, pid)
    if not project or str(project.owner_id) != user:
        raise HTTPException(status_code=403, detail="仅项目所有者可修改权限")

    if body.role not in ("editor", "viewer"):
        raise HTTPException(status_code=422, detail="角色必须是 editor 或 viewer")

    result = await db.execute(
        select(ProjectCollaborator).where(
            ProjectCollaborator.project_id == pid,
            ProjectCollaborator.user_id == uid,
        )
    )
    collab = result.scalar_one_or_none()
    if not collab:
        raise HTTPException(status_code=404, detail="协作者不存在")

    collab.role = body.role
    await db.commit()
    logger.info(f"[Collab:UpdateRole] project={project_id} user={user_id} role={body.role}")
    return {"message": f"已将权限修改为 {body.role}"}


@router.delete("/projects/{project_id}/collaborators/{user_id}", summary="移除协作者")
async def remove_collaborator(project_id: str, user_id: str, user: CurrentUser, db: DBSession):
    pid = uuid.UUID(project_id)
    uid = uuid.UUID(user_id)

    # 仅 owner 可移除
    project = await db.get(Project, pid)
    if not project or str(project.owner_id) != user:
        raise HTTPException(status_code=403, detail="仅项目所有者可移除协作者")

    result = await db.execute(
        select(ProjectCollaborator).where(
            ProjectCollaborator.project_id == pid,
            ProjectCollaborator.user_id == uid,
        )
    )
    collab = result.scalar_one_or_none()
    if not collab:
        raise HTTPException(status_code=404, detail="协作者不存在")

    await db.delete(collab)
    await db.commit()
    logger.info(f"[Collab:Remove] project={project_id} user={user_id}")
    return {"message": "已移除协作者"}
