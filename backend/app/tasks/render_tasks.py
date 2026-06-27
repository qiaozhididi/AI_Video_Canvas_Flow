"""渲染任务：支持 AI 推理 + 工作流渲染，按 task_type 路由

注意：Celery worker 运行在独立进程中，需要创建自己的 async engine 和 session factory，
不能复用 FastAPI 的 async_session_factory（事件循环不匹配）。
"""

import asyncio
import logging
import uuid
import time

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.tasks.celery_app import celery_app
from app.config import settings

logger = logging.getLogger("app.tasks.render")

# ── Celery 专用事件循环 + async engine（整个 worker 进程复用） ──

_celery_loop = None
_celery_engine = None
_celery_session_factory = None


def _get_celery_loop() -> asyncio.AbstractEventLoop:
    """获取 Celery 专用事件循环（全局单例，所有任务复用）"""
    global _celery_loop
    if _celery_loop is None or _celery_loop.is_closed():
        _celery_loop = asyncio.new_event_loop()
        logger.info("[CeleryLoop] 创建了新的事件循环")
    return _celery_loop


def _get_celery_session_factory() -> async_sessionmaker:
    """获取 Celery 专用的 session factory（懒加载单例）"""
    global _celery_engine, _celery_session_factory
    if _celery_session_factory is None:
        _celery_engine = create_async_engine(
            settings.DATABASE_URL,
            pool_size=3,
            max_overflow=5,
            echo=settings.DEBUG,
        )
        _celery_session_factory = async_sessionmaker(
            _celery_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        logger.info("[CeleryDB] 创建了独立的 async engine + session factory")
    return _celery_session_factory


# ── 异步辅助函数 ──


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


async def _mark_failed(task_id: str, error_message: str):
    """标记任务失败"""
    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="failed", error_message=error_message, progress=0.0)


async def _run_task(task_id: str, model_id: str | None, prompt: str | None, input_artifacts: list[dict] | None):
    """完整的异步任务执行流程——在同一个事件循环中运行"""
    from sqlalchemy import select
    from app.models.render_task import RenderTask

    sf = _get_celery_session_factory()

    # 1. 读取 task_type
    async with sf() as db:
        result = await db.execute(
            select(RenderTask.task_type).where(RenderTask.id == uuid.UUID(task_id))
        )
        task_type = result.scalar_one_or_none()

    # 2. 根据 task_type 路由
    if task_type and task_type.startswith("ai_"):
        return await _execute_ai_task(task_id, model_id, prompt, input_artifacts)
    else:
        return await _execute_render_task(task_id, input_artifacts)


@celery_app.task(bind=True, name="run_render_task")
def run_render_task(
    self,
    task_id: str,
    model_id: str = None,
    prompt: str = None,
    node_id: str = None,
    input_artifacts: list[dict] | None = None,
) -> dict:
    """渲染任务

    Args:
        task_id: 渲染任务 ID
        model_id: AI Model UUID（AI 推理时需要）
        prompt: 用户提示词
        node_id: 关联的画布节点 ID
        input_artifacts: 上游节点输出资产列表
    """
    loop = _get_celery_loop()
    try:
        result = loop.run_until_complete(
            _run_task(task_id, model_id, prompt, input_artifacts)
        )
        return result
    except Exception as e:
        logger.error(f"[Render:Task] 任务 {task_id} 失败: {e}", exc_info=True)
        try:
            loop.run_until_complete(_mark_failed(task_id, str(e)[:500]))
        except Exception:
            logger.error(f"[Render:Task] 标记失败也失败: {task_id}")
        return {"task_id": task_id, "status": "failed", "error": str(e)}


async def _execute_ai_task(
    task_id: str, model_id: str, prompt: str, input_artifacts: list[dict] | None = None
) -> dict:
    """执行 AI 推理任务"""
    from app.services.ai_service import call_llm

    sf = _get_celery_session_factory()

    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=0.1)

        # 构建提示词：优先用 prompt，否则从 input_artifacts 提取文本
        user_content = prompt or ""
        if input_artifacts:
            artifact_texts = [
                a.get("url", "") or a.get("text", "") for a in input_artifacts
            ]
            if not user_content and artifact_texts:
                user_content = "输入资产: " + ", ".join(artifact_texts)

        messages = [
            {
                "role": "system",
                "content": "你是一个 AI 视频工作流设计助手。根据用户描述生成工作流内容。",
            },
            {"role": "user", "content": user_content or "请生成示例内容"},
        ]

        await _update_task(db, task_id, progress=0.3)

        response_text = await call_llm(db, model_id, messages) if model_id else "AI 模拟响应（未指定模型）"

        await _update_task(db, task_id, progress=0.8)

        result_url = f"ai_result/{task_id}"

        await _update_task(
            db,
            task_id,
            progress=1.0,
            status="completed",
            result_url=result_url,
        )

        return {
            "task_id": task_id,
            "status": "completed",
            "result_url": result_url,
            "llm_response": response_text[:200],
        }


async def _execute_render_task(
    task_id: str, input_artifacts: list[dict] | None = None
) -> dict:
    """执行默认渲染任务（模拟进度）"""
    sf = _get_celery_session_factory()

    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=0.0)

        for progress in [0.2, 0.4, 0.6, 0.8, 1.0]:
            await asyncio.sleep(2)  # 使用 async sleep 而非 time.sleep
            status = "completed" if progress >= 1.0 else "running"
            result_url = (
                f"render_result/{task_id}/output.mp4" if progress >= 1.0 else None
            )
            await _update_task(
                db,
                task_id,
                progress=progress,
                status=status,
                result_url=result_url,
            )

    return {
        "task_id": task_id,
        "status": "completed",
        "result_url": f"render_result/{task_id}/output.mp4",
    }
