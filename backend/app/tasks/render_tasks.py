"""渲染任务：支持 AI 推理 + 工作流渲染"""

import asyncio
import logging
import uuid
import time

from app.tasks.celery_app import celery_app

logger = logging.getLogger("app.tasks.render")


def _run_async(coro):
    """在 Celery 同步任务中运行异步协程"""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _update_task(db, task_id: str, **kwargs):
    """更新渲染任务状态"""
    from sqlalchemy import select
    from app.models.render_task import RenderTask
    from datetime import datetime

    result = await db.execute(select(RenderTask).where(RenderTask.id == uuid.UUID(task_id)))
    task = result.scalar_one_or_none()
    if not task:
        return
    for key, value in kwargs.items():
        setattr(task, key, value)
    task.updated_at = datetime.utcnow()
    await db.commit()


@celery_app.task(bind=True, name="run_render_task")
def run_render_task(self, task_id: str, model_id: str = None, prompt: str = None) -> dict:
    """渲染任务

    Args:
        task_id: 渲染任务 ID
        model_id: AI Model UUID（AI 推理时需要）
        prompt: 用户提示词
    """
    try:
        if model_id and prompt:
            result = _run_async(_execute_ai_task(task_id, model_id, prompt))
        else:
            result = _run_async(_execute_render_task(task_id))
        return result

    except Exception as e:
        logger.error(f"[Render:Task] 任务 {task_id} 失败: {e}", exc_info=True)
        try:
            _run_async(_mark_failed(task_id, str(e)[:500]))
        except Exception:
            logger.error(f"[Render:Task] 标记失败也失败: {task_id}")
        return {"task_id": task_id, "status": "failed", "error": str(e)}


async def _mark_failed(task_id: str, error_message: str):
    """标记任务失败"""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        await _update_task(db, task_id, status="failed", error_message=error_message, progress=0.0)


async def _execute_ai_task(task_id: str, model_id: str, prompt: str) -> dict:
    """执行 AI 推理任务"""
    from app.database import async_session_factory
    from app.services.ai_service import call_llm

    async with async_session_factory() as db:
        await _update_task(db, task_id, status="running", progress=0.1)

        messages = [
            {"role": "system", "content": "你是一个 AI 视频工作流设计助手。用户描述需求，你生成工作流配置 JSON。"},
            {"role": "user", "content": prompt},
        ]

        await _update_task(db, task_id, progress=0.3)

        response_text = await call_llm(db, model_id, messages)

        await _update_task(db, task_id, progress=0.8)

        result_url = f"ai_result/{task_id}"

        await _update_task(
            db, task_id,
            progress=1.0, status="completed",
            result_url=result_url,
        )

        return {
            "task_id": task_id,
            "status": "completed",
            "result_url": result_url,
            "llm_response": response_text[:200],
        }


async def _execute_render_task(task_id: str) -> dict:
    """执行默认渲染任务（模拟进度）"""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        # 初始状态
        await _update_task(db, task_id, status="running", progress=0.0)

        for progress in [0.2, 0.4, 0.6, 0.8, 1.0]:
            time.sleep(2)  # 模拟渲染耗时
            status = "completed" if progress >= 1.0 else "running"
            result_url = f"render_result/{task_id}/output.mp4" if progress >= 1.0 else None
            await _update_task(
                db, task_id,
                progress=progress, status=status,
                result_url=result_url,
            )

    return {
        "task_id": task_id,
        "status": "completed",
        "result_url": f"render_result/{task_id}/output.mp4",
    }
