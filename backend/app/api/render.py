"""渲染任务路由"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, DBSession
from app.models.render_task import RenderTask

logger = logging.getLogger("app.api.render")

router = APIRouter()


class RenderTaskCreate(BaseModel):
    project_id: str
    task_type: str = "render"  # render / ai_text2img / ai_img2video / ai_tts
    output_format: str = "mp4"
    model_id: str | None = None  # AI Model UUID
    prompt: str | None = None  # 用户提示词
    node_id: str | None = None  # 关联的画布节点 ID
    input_artifacts: list[dict] | None = None  # 上游输出资产


def _task_to_dict(
    task: RenderTask,
    node_label: str | None = None,
    project_name: str | None = None,
) -> dict:
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
        "node_id": task.node_id,
        "node_label": node_label,
        "project_name": project_name,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


@router.get("/", summary="获取渲染任务列表")
async def list_render_tasks(
    db: DBSession,
    user: CurrentUser,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    owner_id = uuid.UUID(user)
    stmt = select(RenderTask).where(RenderTask.owner_id == owner_id)
    if status:
        stmt = stmt.where(RenderTask.status == status)
    stmt = stmt.order_by(RenderTask.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    # 批量查询关联的节点标签和项目名称，便于渲染中心区分不同节点的任务
    from app.models.workflow import WorkflowNode
    from app.models.project import Project

    node_ids = {t.node_id for t in tasks if t.node_id}
    project_ids = {t.project_id for t in tasks}

    node_labels: dict[str, str] = {}
    if node_ids:
        node_result = await db.execute(
            select(WorkflowNode.id, WorkflowNode.config).where(WorkflowNode.id.in_(node_ids))
        )
        for nid, config in node_result.all():
            label = config.get("label") if isinstance(config, dict) else None
            node_labels[nid] = label or nid

    project_names: dict[str, str] = {}
    if project_ids:
        proj_result = await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(project_ids))
        )
        for pid, name in proj_result.all():
            project_names[str(pid)] = name

    return [
        _task_to_dict(
            t,
            node_label=node_labels.get(t.node_id) if t.node_id else None,
            project_name=project_names.get(str(t.project_id)),
        )
        for t in tasks
    ]


@router.post("/", summary="创建渲染任务")
async def create_render_task(body: RenderTaskCreate, db: DBSession, user: CurrentUser):
    task = RenderTask(
        project_id=uuid.UUID(body.project_id),
        owner_id=uuid.UUID(user),
        task_type=body.task_type,
        status="pending",
        progress=0.0,
        node_id=body.node_id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # 触发 Celery 任务
    from app.tasks.render_tasks import run_render_task
    celery_result = run_render_task.delay(
        str(task.id),
        model_id=body.model_id,
        prompt=body.prompt,
        input_artifacts=body.input_artifacts,
    )

    # 回写 celery_task_id
    task.celery_task_id = celery_result.id
    task.status = "running"
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)

    logger.info(f"[Render:Create] id={task.id} type={body.task_type} celery={celery_result.id}")
    return _task_to_dict(task)


@router.get("/{task_id}", summary="获取渲染任务状态")
async def get_render_task(task_id: str, db: DBSession, user: CurrentUser):
    result = await db.execute(select(RenderTask).where(RenderTask.id == uuid.UUID(task_id)))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    return _task_to_dict(task)


@router.post("/{task_id}/cancel", summary="取消渲染任务")
async def cancel_render_task(task_id: str, db: DBSession, user: CurrentUser):
    result = await db.execute(select(RenderTask).where(RenderTask.id == uuid.UUID(task_id)))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    if task.status not in ("pending", "running"):
        raise HTTPException(status_code=409, detail="任务已完成，无法取消")

    # 撤销 Celery 任务（通过 AsyncResult 发送 revoke 指令，不依赖远程控制）
    if task.celery_task_id:
        from celery.result import AsyncResult
        from app.tasks.celery_app import celery_app
        AsyncResult(task.celery_task_id, app=celery_app).revoke(terminate=True)
        logger.info(f"[Render:Cancel] revoked celery task {task.celery_task_id}")

    task.status = "cancelled"
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)

    logger.info(f"[Render:Cancel] id={task_id}")
    return _task_to_dict(task)
