"""项目业务逻辑"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate


async def create_project(db: AsyncSession, owner_id: UUID, data: ProjectCreate) -> Project:
    """创建新项目"""
    project = Project(
        name=data.name,
        description=data.description,
        cover_url=data.cover_url,
        owner_id=owner_id,
    )
    db.add(project)
    await db.flush()
    return project


async def get_project(db: AsyncSession, project_id: UUID) -> Project | None:
    """根据 ID 获取项目"""
    # TODO: 实现查询
    return None


async def list_projects(db: AsyncSession, owner_id: UUID) -> list[Project]:
    """获取用户的所有项目"""
    # TODO: 实现查询
    return []


async def update_project(db: AsyncSession, project_id: UUID, data: ProjectUpdate) -> Project | None:
    """更新项目信息"""
    # TODO: 实现更新
    return None


async def delete_project(db: AsyncSession, project_id: UUID) -> bool:
    """删除项目"""
    # TODO: 实现删除
    return False
