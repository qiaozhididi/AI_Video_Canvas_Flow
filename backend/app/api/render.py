"""渲染任务路由"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, DBSession
from app.models.render_task import RenderTask

import logging

logger = logging.getLogger("app.api.render")

router = APIRouter()


class RenderTaskCreateDev(BaseModel):
    """创建渲染任务请求（开发模式）"""
    project_id: str
    output_format: str = "mp4"


@router.post("/", summary="创建渲染任务")
async def create_render_task(body: RenderTaskCreateDev, db: DBSession, user: CurrentUser):
    """创建新的渲染任务"""
    task = RenderTask(
        project_id=uuid.UUID(body.project_id),
        owner_id=uuid.UUID(user),
        task_type="render",
        status="pending",
        progress=0.0,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    logger.info(f"[Render:Create] id={task.id} project={body.project_id} user={user}")
    return {
        "id": str(task.id),
        "project_id": str(task.project_id),
        "owner_id": str(task.owner_id),
        "task_type": task.task_type,
        "status": task.status,
        "progress": task.progress,
        "celery_task_id": task.celery_task_id,
        "result_url": task.result_url,
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


@router.get("/{task_id}", summary="获取渲染任务状态")
async def get_render_task(task_id: str, db: DBSession, user: CurrentUser):
    """获取指定渲染任务的状态和进度"""
    result = await db.execute(select(RenderTask).where(RenderTask.id == uuid.UUID(task_id)))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    return {
        "id": str(task.id),
        "project_id": str(task.project_id),
        "owner_id": str(task.owner_id),
        "task_type": task.task_type,
        "status": task.status,
        "progress": task.progress,
        "celery_task_id": task.celery_task_id,
        "result_url": task.result_url,
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


@router.post("/{task_id}/cancel", summary="取消渲染任务")
async def cancel_render_task(task_id: str, db: DBSession, user: CurrentUser):
    """取消正在进行的渲染任务"""
    result = await db.execute(select(RenderTask).where(RenderTask.id == uuid.UUID(task_id)))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    if task.status not in ("pending", "running"):
        raise HTTPException(status_code=409, detail="任务已完成，无法取消")

    task.status = "cancelled"
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)

    logger.info(f"[Render:Cancel] id={task_id}")
    return {
        "id": str(task.id),
        "project_id": str(task.project_id),
        "owner_id": str(task.owner_id),
        "task_type": task.task_type,
        "status": task.status,
        "progress": task.progress,
        "celery_task_id": task.celery_task_id,
        "result_url": task.result_url,
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }
