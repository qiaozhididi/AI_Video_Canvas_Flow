"""邀请链接路由"""
import logging
import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, DBSession
from app.models.project import Project
from app.models.project_invitation import ProjectInvitation
from app.models.project_collaborator import ProjectCollaborator
from app.models.user import User

logger = logging.getLogger("app.api.invitations")
router = APIRouter()


class CreateInvitationRequest(BaseModel):
    role: str = "editor"  # editor/viewer
    expires_in_hours: int | None = 24  # None=永不过期

class InvitationInfoResponse(BaseModel):
    id: str
    project_id: str
    project_name: str
    role: str
    created_by_username: str
    expires_at: str | None
    is_valid: bool

class CreateInvitationResponse(BaseModel):
    id: str
    token: str
    role: str
    expires_at: str | None

class AcceptInvitationResponse(BaseModel):
    project_id: str
    project_name: str
    role: str


@router.post("/projects/{project_id}/invitations", response_model=CreateInvitationResponse, summary="生成邀请链接")
async def create_invitation(project_id: str, body: CreateInvitationRequest, user: CurrentUser, db: DBSession):
    pid = uuid.UUID(project_id)
    project = await db.get(Project, pid)
    if not project or str(project.owner_id) != user:
        raise HTTPException(status_code=403, detail="仅项目所有者可生成邀请链接")

    if body.role not in ("editor", "viewer"):
        raise HTTPException(status_code=422, detail="角色必须是 editor 或 viewer")

    token = secrets.token_urlsafe(32)
    expires_at = None
    if body.expires_in_hours:
        expires_at = datetime.utcnow() + timedelta(hours=body.expires_in_hours)

    invitation = ProjectInvitation(
        project_id=pid,
        token=token,
        role=body.role,
        expires_at=expires_at,
        created_by=uuid.UUID(user),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    logger.info(f"[Invitation:Create] project={project_id} role={body.role} expires={expires_at}")
    return CreateInvitationResponse(
        id=str(invitation.id),
        token=invitation.token,
        role=invitation.role,
        expires_at=invitation.expires_at.isoformat() if invitation.expires_at else None,
    )


@router.get("/invitations/{token}", response_model=InvitationInfoResponse, summary="查看邀请信息")
async def get_invitation(token: str, db: DBSession):
    """查看邀请信息（无需登录）"""
    result = await db.execute(
        select(ProjectInvitation).where(ProjectInvitation.token == token)
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="邀请不存在")

    is_valid = (inv.used_by is None) and (inv.expires_at is None or inv.expires_at > datetime.utcnow())
    project = await db.get(Project, inv.project_id)
    creator = await db.get(User, inv.created_by)

    return InvitationInfoResponse(
        id=str(inv.id),
        project_id=str(inv.project_id),
        project_name=project.name if project else "未知项目",
        role=inv.role,
        created_by_username=creator.username if creator else "未知用户",
        expires_at=inv.expires_at.isoformat() if inv.expires_at else None,
        is_valid=is_valid,
    )


@router.post("/invitations/{token}/accept", response_model=AcceptInvitationResponse, summary="接受邀请")
async def accept_invitation(token: str, user: CurrentUser, db: DBSession):
    """接受邀请，加入项目"""
    result = await db.execute(
        select(ProjectInvitation).where(ProjectInvitation.token == token)
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="邀请不存在")

    if inv.used_by:
        raise HTTPException(status_code=410, detail="邀请已被使用")

    if inv.expires_at and inv.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="邀请已过期")

    # 项目所有者不能接受自己项目的邀请
    project = await db.get(Project, inv.project_id)
    if project and str(project.owner_id) == user:
        raise HTTPException(status_code=409, detail="不能接受自己项目的邀请")

    # 创建协作者记录
    existing = await db.execute(
        select(ProjectCollaborator).where(
            ProjectCollaborator.project_id == inv.project_id,
            ProjectCollaborator.user_id == uuid.UUID(user),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="已是项目协作者")

    collab = ProjectCollaborator(
        project_id=inv.project_id,
        user_id=uuid.UUID(user),
        role=inv.role,
    )
    db.add(collab)

    # 标记邀请已使用
    inv.used_by = uuid.UUID(user)
    await db.commit()

    project = await db.get(Project, inv.project_id)
    logger.info(f"[Invitation:Accept] user={user} project={inv.project_id} role={inv.role}")

    return AcceptInvitationResponse(
        project_id=str(inv.project_id),
        project_name=project.name if project else "未知项目",
        role=inv.role,
    )
