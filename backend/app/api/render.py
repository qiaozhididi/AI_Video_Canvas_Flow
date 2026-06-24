"""渲染任务路由（开发模式：内存存储）"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.deps import CurrentUser

logger = logging.getLogger("app.api.render")

router = APIRouter()

# 开发用内存存储
_dev_render_tasks: dict[str, dict] = {}


class RenderTaskCreateDev(BaseModel):
    """创建渲染任务请求（开发模式）"""
    project_id: str
    output_format: str = "mp4"


@router.post("/", summary="创建渲染任务")
async def create_render_task(body: RenderTaskCreateDev, user: CurrentUser):
    """创建新的渲染任务（开发模式：内存存储）"""
    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    task = {
        "id": task_id,
        "project_id": body.project_id,
        "owner_id": user,
        "task_type": "render",
        "status": "pending",
        "progress": 0.0,
        "celery_task_id": None,
        "result_url": None,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
    }
    _dev_render_tasks[task_id] = task

    logger.info(f"[Render:Create] id={task_id} project={body.project_id} user={user}")
    return task


@router.get("/{task_id}", summary="获取渲染任务状态")
async def get_render_task(task_id: str, user: CurrentUser):
    """获取指定渲染任务的状态和进度"""
    task = _dev_render_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    return task


@router.post("/{task_id}/cancel", summary="取消渲染任务")
async def cancel_render_task(task_id: str, user: CurrentUser):
    """取消正在进行的渲染任务"""
    task = _dev_render_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    if task["status"] not in ("pending", "running"):
        raise HTTPException(status_code=409, detail="任务已完成，无法取消")

    task["status"] = "cancelled"
    task["updated_at"] = datetime.now(timezone.utc).isoformat()
    logger.info(f"[Render:Cancel] id={task_id}")
    return task
