"""项目 CRUD 路由"""

from uuid import UUID

from fastapi import APIRouter

from app.deps import CurrentUser, DBSession
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate

router = APIRouter()


@router.get("/", response_model=list[ProjectResponse], summary="获取项目列表")
async def list_projects(user: CurrentUser, db: DBSession):
    """获取当前用户的所有项目"""
    # TODO: 调用 project_service 查询
    return []


@router.post("/", response_model=ProjectResponse, summary="创建项目")
async def create_project(body: ProjectCreate, user: CurrentUser, db: DBSession):
    """创建新项目"""
    # TODO: 调用 project_service 创建
    return None


@router.get("/{project_id}", response_model=ProjectResponse, summary="获取项目详情")
async def get_project(project_id: UUID, user: CurrentUser, db: DBSession):
    """获取指定项目详情"""
    # TODO: 调用 project_service 查询
    return None


@router.patch("/{project_id}", response_model=ProjectResponse, summary="更新项目")
async def update_project(project_id: UUID, body: ProjectUpdate, user: CurrentUser, db: DBSession):
    """更新项目信息"""
    # TODO: 调用 project_service 更新
    return None


@router.delete("/{project_id}", status_code=204, summary="删除项目")
async def delete_project(project_id: UUID, user: CurrentUser, db: DBSession):
    """删除指定项目"""
    # TODO: 调用 project_service 删除
