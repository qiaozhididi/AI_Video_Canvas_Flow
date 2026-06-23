"""Celery 渲染任务调度"""

from uuid import UUID

from app.tasks.celery_app import celery_app


def submit_render_task(
    project_id: UUID,
    owner_id: UUID,
    task_type: str,
) -> str:
    """提交渲染任务到 Celery 队列，返回 Celery 任务 ID"""
    from app.tasks.ai_tasks import run_ai_task
    from app.tasks.render_tasks import run_render_task

    # 根据任务类型分发到不同的 Celery 任务
    if task_type in ("text2img", "img2video", "tts"):
        result = run_ai_task.delay(
            project_id=str(project_id),
            task_type=task_type,
        )
    else:
        result = run_render_task.delay(
            project_id=str(project_id),
        )

    return result.id


def cancel_render_task(celery_task_id: str) -> bool:
    """取消正在执行的渲染任务"""
    celery_app.control.revoke(celery_task_id, terminate=True)
    return True
