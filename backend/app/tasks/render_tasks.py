"""渲染任务：支持 AI 推理 + 工作流渲染，按 task_type 路由

注意：Celery worker 运行在独立进程中，需要创建自己的 async engine 和 session factory，
不能复用 FastAPI 的 async_session_factory（事件循环不匹配）。

progress 范围：0~100（整数百分比）
"""

import asyncio
import logging
import uuid

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
        await _update_task(db, task_id, status="failed", error_message=error_message, progress=0)


async def _run_task(task_id: str, model_id: str | None, prompt: str | None, input_artifacts: list[dict] | None, node_params: dict | None = None):
    """完整的异步任务执行流程——在同一个事件循环中运行"""
    from sqlalchemy import select
    from app.models.render_task import RenderTask
    from app.models.workflow import WorkflowNode

    sf = _get_celery_session_factory()

    # 1. 读取 task_type 和 node_id
    async with sf() as db:
        result = await db.execute(
            select(RenderTask.task_type, RenderTask.node_id).where(RenderTask.id == uuid.UUID(task_id))
        )
        row = result.one_or_none()
        if not row:
            raise ValueError(f"任务 {task_id} 不存在")
        task_type, node_id = row

    # 2. 如果未传 node_params 但有 node_id，从 WorkflowNode.config.params 读取
    if not node_params and node_id:
        async with sf() as db:
            node_result = await db.execute(
                select(WorkflowNode.config).where(WorkflowNode.id == node_id)
            )
            config = node_result.scalar_one_or_none()
            if config and isinstance(config, dict):
                node_params = config.get("params")

    # 3. 根据 task_type 路由
    if task_type and task_type.startswith("ai_"):
        return await _execute_ai_task(task_id, model_id, prompt, input_artifacts, node_params)
    else:
        # 查询节点 subtype（用于 image_output 透传逻辑）
        subtype = None
        if node_id:
            async with sf() as db:
                node_result = await db.execute(
                    select(WorkflowNode.config).where(WorkflowNode.id == node_id)
                )
                config = node_result.scalar_one_or_none()
                if config and isinstance(config, dict):
                    subtype = config.get("subtype")
        return await _execute_render_task(task_id, input_artifacts, subtype, node_params)


@celery_app.task(bind=True, name="run_render_task")
def run_render_task(
    self,
    task_id: str,
    model_id: str = None,
    prompt: str = None,
    node_id: str = None,
    input_artifacts: list[dict] | None = None,
    node_params: dict | None = None,
) -> dict:
    """渲染任务

    Args:
        task_id: 渲染任务 ID
        model_id: AI Model UUID（AI 推理时需要）
        prompt: 用户提示词
        node_id: 关联的画布节点 ID
        input_artifacts: 上游节点输出资产列表
        node_params: 节点参数（从 WorkflowNode.config.params 读取或调用方传入）
    """
    loop = _get_celery_loop()
    try:
        result = loop.run_until_complete(
            _run_task(task_id, model_id, prompt, input_artifacts, node_params)
        )
        return result
    except Exception as e:
        logger.error(f"[Render:Task] 任务 {task_id} 失败: {e}", exc_info=True)
        try:
            loop.run_until_complete(_mark_failed(task_id, str(e)[:500]))
        except Exception:
            logger.error(f"[Render:Task] 标记失败也失败: {task_id}")
        return {"task_id": task_id, "status": "failed", "error": str(e)}


def _extract_text_from_artifacts(artifacts: list[dict] | None) -> str:
    """从 input_artifacts 中提取文本内容

    优先提取 text 字段，其次从 filename=text_input 的 artifact 中提取
    """
    if not artifacts:
        return ""
    texts = []
    for a in artifacts:
        text = a.get("text", "")
        filename = a.get("filename", "")
        url = a.get("url", "")
        if text:
            texts.append(text)
        elif filename == "text_input" and url and not url.startswith("http"):
            texts.append(url)
    return " ".join(texts)


async def _execute_ai_task(
    task_id: str, model_id: str | None, prompt: str | None, input_artifacts: list[dict] | None = None, node_params: dict | None = None
) -> dict:
    """执行 AI 推理任务：按 task_type 路由到不同的 AI 服务

    task_type 路由规则：
    - ai_text2img → call_image_gen（文生图）
    - ai_img2video → call_video_gen（图生视频，待实现）
    - ai_tts → call_tts（文生语音，待实现）
    - ai_llm / 其他 → call_llm（文本生成）
    """
    sf = _get_celery_session_factory()

    # 读取 task_type
    async with sf() as db:
        from sqlalchemy import select
        from app.models.render_task import RenderTask
        result = await db.execute(
            select(RenderTask.task_type).where(RenderTask.id == uuid.UUID(task_id))
        )
        task_type = result.scalar_one_or_none() or ""

    # 从 node_params 提取 model_id（当传入的 model_id 为空时）
    if not model_id and node_params:
        model_id = node_params.get("model_id")

    # 构建用户内容：优先 prompt，否则从 node_params 提取，最后从 input_artifacts 提取文本
    user_content = prompt or ""
    if not user_content and node_params:
        user_content = node_params.get("prompt") or node_params.get("text") or ""
    if not user_content:
        user_content = _extract_text_from_artifacts(input_artifacts)

    # 按 task_type 路由
    if task_type == "ai_text2img":
        return await _do_text2img(task_id, model_id, user_content, input_artifacts, node_params)
    elif task_type == "ai_img2video":
        return await _do_img2video(task_id, model_id, user_content, input_artifacts, node_params)
    elif task_type == "ai_tts":
        return await _do_tts(task_id, model_id, user_content, node_params)
    else:
        return await _do_llm(task_id, model_id, user_content)


async def _do_text2img(task_id: str, model_id: str | None, prompt: str, input_artifacts: list[dict] | None = None, node_params: dict | None = None) -> dict:
    """文生图：调用 image_gen API 或模拟"""
    from app.services.ai_service import call_image_gen

    size = (node_params or {}).get("size", "2048x2048")

    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=10)

        if not prompt:
            prompt = "一张美丽的风景图"

        await _update_task(db, task_id, progress=30)

        result_url = ""
        revised_prompt = ""

        try:
            if model_id:
                result = await call_image_gen(db, model_id, prompt, params={"size": size})
                result_url = result["url"]
                revised_prompt = result.get("revised_prompt", "")
        except ValueError as e:
            # 模型类型不匹配（如传入了 LLM 模型），回退到模拟生成
            logger.warning(f"[AI:Text2Img] 模型不匹配，回退模拟: {e}")
            await _update_task(db, task_id, progress=50)
        except Exception as e:
            logger.error(f"[AI:Text2Img] 调用失败: {e}", exc_info=True)
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
            return {"task_id": task_id, "status": "failed", "error": str(e)}

        if not result_url:
            # 模拟生成（无模型或模型不匹配时）
            for p in [50, 70, 90]:
                await asyncio.sleep(1)
                await _update_task(db, task_id, progress=p)
            result_url = f"ai_result/{task_id}/image.png"
            revised_prompt = "模拟生成（未配置文生图模型）"

        await _update_task(
            db, task_id, progress=100, status="completed", result_url=result_url,
        )

        return {
            "task_id": task_id, "status": "completed",
            "result_url": result_url, "revised_prompt": revised_prompt[:200],
        }


async def _do_img2video(task_id: str, model_id: str | None, prompt: str, input_artifacts: list[dict] | None, node_params: dict | None = None) -> dict:
    """图生视频（待实现，当前走模拟）"""
    duration = (node_params or {}).get("duration", 5)

    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=10)
        for p in [30, 60, 90]:
            await asyncio.sleep(2)
            await _update_task(db, task_id, progress=p)
        result_url = f"ai_result/{task_id}/video.mp4"
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)
    return {"task_id": task_id, "status": "completed", "result_url": result_url}


async def _do_tts(task_id: str, model_id: str | None, prompt: str, node_params: dict | None = None) -> dict:
    """文生语音（待实现，当前走模拟）"""
    voice = (node_params or {}).get("voice", "default")

    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=10)
        for p in [30, 60, 90]:
            await asyncio.sleep(1)
            await _update_task(db, task_id, progress=p)
        result_url = f"ai_result/{task_id}/audio.mp3"
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)
    return {"task_id": task_id, "status": "completed", "result_url": result_url}


async def _do_llm(task_id: str, model_id: str | None, user_content: str) -> dict:
    """LLM 文本生成"""
    from app.services.ai_service import call_llm

    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=10)

        messages = [
            {"role": "system", "content": "你是一个 AI 视频工作流设计助手。根据用户描述生成工作流内容。"},
            {"role": "user", "content": user_content or "请生成示例内容"},
        ]

        await _update_task(db, task_id, progress=30)

        try:
            response_text = await call_llm(db, model_id, messages) if model_id else "AI 模拟响应（未指定模型）"
        except Exception as e:
            logger.error(f"[AI:LLM] 任务 {task_id} 失败: {e}", exc_info=True)
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
            return {"task_id": task_id, "status": "failed", "error": str(e)}

        await _update_task(db, task_id, progress=90)

        result_url = f"ai_result/{task_id}"
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)

        return {
            "task_id": task_id, "status": "completed",
            "result_url": result_url, "llm_response": response_text[:200],
        }


async def _execute_render_task(
    task_id: str, input_artifacts: list[dict] | None = None, subtype: str | None = None, node_params: dict | None = None
) -> dict:
    """执行默认渲染任务

    image_output 节点：透传上游图片 URL 作为 result_url
    其他节点：模拟渲染进度
    """
    sf = _get_celery_session_factory()

    # image_output / upscale 节点：从上游 artifacts 提取图片 URL 透传
    if subtype in ("image_output", "upscale") and input_artifacts:
        image_art = next((a for a in input_artifacts if a.get("type") == "image" and a.get("url")), None)
        if image_art:
            result_url = image_art["url"]
            async with sf() as db:
                await _update_task(db, task_id, status="running", progress=50)
                await asyncio.sleep(0.5)
                await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)
            return {"task_id": task_id, "status": "completed", "result_url": result_url}

    # 其他节点：模拟渲染进度
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=0)

        for progress in [20, 40, 60, 80, 100]:
            await asyncio.sleep(2)
            status = "completed" if progress >= 100 else "running"
            result_url = (
                f"render_result/{task_id}/output.mp4" if progress >= 100 else None
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
