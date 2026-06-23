"""项目 CRUD 路由"""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.schemas.project import ProjectCreate, ProjectResponse

logger = logging.getLogger("app.api.projects")

router = APIRouter()

# 开发用内存项目存储
_dev_projects: dict[str, dict] = {}


@router.get("/", response_model=list[ProjectResponse], summary="获取项目列表")
async def list_projects():
    """获取当前用户的项目列表"""
    return [
        ProjectResponse(
            id=p["id"],
            name=p["name"],
            description=p.get("description", ""),
            created_at=p["created_at"],
            updated_at=p["updated_at"],
        )
        for p in _dev_projects.values()
    ]


@router.post("/", response_model=ProjectResponse, summary="创建新项目")
async def create_project(body: ProjectCreate):
    """创建新项目"""
    project_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    project = {
        "id": project_id,
        "name": body.name,
        "description": body.description or "",
        "created_at": now,
        "updated_at": now,
    }
    _dev_projects[project_id] = project
    logger.info(f"[Project:Create] id={project_id} name={body.name}")
    return ProjectResponse(**project)


@router.get("/{project_id}", response_model=ProjectResponse, summary="获取项目详情")
async def get_project(project_id: str):
    """获取指定项目详情"""
    project = _dev_projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return ProjectResponse(**project)


@router.delete("/{project_id}", status_code=204, summary="删除项目")
async def delete_project(project_id: str):
    """删除指定项目"""
    if project_id not in _dev_projects:
        raise HTTPException(status_code=404, detail="项目不存在")
    del _dev_projects[project_id]
    logger.info(f"[Project:Delete] id={project_id}")
