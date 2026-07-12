"""渲染任务：支持 AI 推理 + 工作流渲染，按 task_type 路由

注意：Celery worker 运行在独立进程中，需要创建自己的 async engine 和 session factory，
不能复用 FastAPI 的 async_session_factory（事件循环不匹配）。

progress 范围：0~100（整数百分比）
"""

import asyncio
import logging
import os
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
    from datetime import datetime, timezone

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


def _extract_image_url(artifacts: list[dict] | None) -> str | None:
    """从 input_artifacts 中提取图片 URL"""
    if not artifacts:
        return None
    for artifact in artifacts:
        url = artifact.get("url", "")
        if url and ("/image" in url or "/media" in url or url.startswith("http")):
            return url
    return None


# ── AI 任务配置（配置驱动，替代 _do_text2img 等5个重复函数） ──

AI_TASK_CONFIG = {
    "ai_text2img": {
        "default_prompt": "一张美丽的风景图",
        "needs_image": False,
        "result_key": "url",
        "fallback_msg": "未配置文生图模型",
        "has_size_param": True,
        "has_size_retry": True,
    },
    "ai_img2img": {
        "default_prompt": "在原图基础上进行编辑",
        "needs_image": True,
        "result_key": "url",
        "fallback_msg": "未配置图生图模型或无上游图片",
        "has_size_param": True,
        "has_size_retry": True,
    },
    "ai_img2video": {
        "default_prompt": "一段流畅的视频",
        "needs_image": True,
        "result_key": "video_url",
        "fallback_msg": "未配置图生视频模型",
        "has_size_param": False,
        "has_size_retry": False,
    },
    "ai_text2video": {
        "default_prompt": "一段优美的视频",
        "needs_image": False,
        "result_key": "video_url",
        "fallback_msg": "未配置文生视频模型",
        "has_size_param": False,
        "has_size_retry": False,
    },
    "ai_tts": {
        "default_prompt": "这是一段语音合成示例。",
        "needs_image": False,
        "result_key": "audio_url",
        "fallback_msg": "未配置TTS模型",
        "has_size_param": False,
        "has_size_retry": False,
    },
    "ai_subtitle": {
        "default_prompt": "生成字幕文本",
        "needs_image": False,
        "result_key": "segments",
        "fallback_msg": "未配置LLM模型",
        "has_size_param": False,
        "has_size_retry": False,
    },
}


async def _execute_ai_task(
    task_id: str, model_id: str | None, prompt: str | None, input_artifacts: list[dict] | None = None, node_params: dict | None = None
) -> dict:
    """执行 AI 推理任务：按 task_type 路由到不同的 AI 服务

    task_type 路由规则：
    - ai_text2img → call_image_gen（文生图）
    - ai_img2img → call_img2img（图生图）
    - ai_img2video → call_video_gen（图生视频）
    - ai_tts → call_audio_gen（文生语音）
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
    if task_type in AI_TASK_CONFIG:
        return await _do_ai_call(task_id, task_type, model_id, user_content, input_artifacts, node_params)
    else:
        return await _do_llm(task_id, model_id, user_content)


async def _do_ai_call(
    task_id: str, task_type: str, model_id: str | None,
    prompt: str | None, input_artifacts: list[dict] | None, node_params: dict | None
) -> dict:
    """配置驱动的通用 AI 调用函数，替代 _do_text2img 等5个重复函数

    根据 AI_TASK_CONFIG 中的配置路由到不同的 AI 服务，
    统一处理 owner_id 获取、size 规范化、InvalidParameter 重试和模拟 fallback。
    """
    config = AI_TASK_CONFIG.get(task_type)
    if not config:
        raise ValueError(f"未知的 AI 任务类型: {task_type}")

    sf = _get_celery_session_factory()
    async with sf() as db:
        from app.models.render_task import RenderTask
        from app.services.ai_service import call_image_gen, call_img2img, call_video_gen, call_audio_gen

        await _update_task(db, task_id, status="running", progress=10)

        # 填充默认 prompt
        if not prompt:
            prompt = config["default_prompt"]

        # 提取图片 URL（needs_image 时）
        image_url = None
        if config["needs_image"] and input_artifacts:
            image_url = _extract_image_url(input_artifacts)

        await _update_task(db, task_id, progress=20)

        # 获取 owner_id 用于 MinIO 持久化和 AI 模型归属验证
        render_task = await db.get(RenderTask, uuid.UUID(task_id))
        owner_id = str(render_task.owner_id) if render_task else None

        # 规范化 size 参数（文生图/图生图）
        size = None
        if config["has_size_param"]:
            size = (node_params or {}).get("size", "2k") or "2k"
            if "*" in str(size):
                size = str(size).replace("*", "x")

        result_url = ""
        revised_prompt = ""

        try:
            if model_id:
                # 图生图/图生视频需要 image_url，无图片时跳过 AI 调用走模拟路径
                skip_ai = config["needs_image"] and not image_url
                if skip_ai:
                    logger.warning(f"[AI:Img2Img] 无上游图片 URL，跳过 AI 调用走模拟")
                else:
                    # 调用对应的 AI 服务（传入 user_id=owner_id 验证模型归属）
                    if task_type == "ai_text2img":
                        result = await call_image_gen(db, model_id, prompt, params={"size": size, "_owner_id": owner_id}, user_id=owner_id)
                    elif task_type == "ai_img2img":
                        result = await call_img2img(db, model_id, prompt, image_url, params={"size": size, "_owner_id": owner_id}, user_id=owner_id)
                    elif task_type in ("ai_img2video", "ai_text2video"):
                        result = await call_video_gen(db, model_id, prompt, image_url=image_url, params={**(node_params or {}), "_owner_id": owner_id}, user_id=owner_id)
                    elif task_type == "ai_tts":
                        result = await call_audio_gen(db, model_id, prompt, params={**(node_params or {}), "_owner_id": owner_id}, user_id=owner_id)

                    result_url = result.get(config["result_key"], "")
                    if config["result_key"] == "url":
                        revised_prompt = result.get("revised_prompt", "")
        except ValueError as e:
            # 模型类型不匹配，回退到模拟生成
            logger.warning(f"[AI:{task_type}] 模型不匹配，回退模拟: {e}")
            await _update_task(db, task_id, progress=40)
        except RuntimeError as e:
            err_msg = str(e)
            # size 参数不合法时，回退到 2k 重试
            if config["has_size_retry"] and "InvalidParameter" in err_msg and "size" in err_msg and size != "2k":
                logger.warning(f"[AI:{task_type}] size={size} 不合法，回退到 2k 重试")
                try:
                    if task_type == "ai_text2img":
                        result = await call_image_gen(db, model_id, prompt, params={"size": "2k", "_owner_id": owner_id}, user_id=owner_id)
                    elif task_type == "ai_img2img":
                        result = await call_img2img(db, model_id, prompt, image_url, params={"size": "2k", "_owner_id": owner_id}, user_id=owner_id)
                    result_url = result.get(config["result_key"], "")
                    if config["result_key"] == "url":
                        revised_prompt = result.get("revised_prompt", "")
                except Exception as retry_err:
                    logger.error(f"[AI:{task_type}] 重试也失败: {retry_err}", exc_info=True)
                    await _update_task(db, task_id, status="failed", error_message=str(retry_err)[:500], progress=0)
                    return {"task_id": task_id, "status": "failed", "error": str(retry_err)}
            else:
                logger.error(f"[AI:{task_type}] 调用失败: {e}", exc_info=True)
                await _update_task(db, task_id, status="failed", error_message=err_msg[:500], progress=0)
                return {"task_id": task_id, "status": "failed", "error": err_msg}
        except Exception as e:
            logger.error(f"[AI:{task_type}] 调用失败: {e}", exc_info=True)
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
            return {"task_id": task_id, "status": "failed", "error": str(e)}

        if not result_url:
            # TD-07: 模拟生成时不设 result_url，仅标记 completed + error_message
            for p in [40, 60, 80]:
                await asyncio.sleep(2 if task_type in ("ai_img2video", "ai_text2video") else 1)
                await _update_task(db, task_id, progress=p)
            await _update_task(
                db, task_id, progress=100, status="completed",
                error_message=f"AI 模拟完成: {config['fallback_msg']}",
            )
            return {"task_id": task_id, "status": "completed"}

        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)

        ret: dict = {"task_id": task_id, "status": "completed", "result_url": result_url}
        if revised_prompt:
            ret["revised_prompt"] = revised_prompt[:200]
        return ret


async def _do_llm(task_id: str, model_id: str | None, user_content: str) -> dict:
    """LLM 文本生成"""
    from app.services.ai_service import call_llm
    from app.models.render_task import RenderTask

    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=10)

        # 获取 owner_id 用于 AI 模型归属验证
        render_task = await db.get(RenderTask, uuid.UUID(task_id))
        owner_id = str(render_task.owner_id) if render_task else None

        messages = [
            {"role": "system", "content": "你是一个 AI 视频工作流设计助手。根据用户描述生成工作流内容。"},
            {"role": "user", "content": user_content or "请生成示例内容"},
        ]

        await _update_task(db, task_id, progress=30)

        try:
            response_text = await call_llm(db, model_id, messages, user_id=owner_id) if model_id else "AI 模拟响应（未指定模型）"
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
    audio_output 节点：透传上游音频 URL 作为 result_url
    其他节点：模拟渲染进度（根据节点类型输出正确扩展名）
    """
    sf = _get_celery_session_factory()

    # 根据节点 subtype 确定输出扩展名
    subtype_ext_map = {
        "image_output": ".png",
        "video_output": ".mp4",
        "audio_output": ".mp3",
        "upscale": ".png",
        "remove_bg": ".png",
        "style_transfer": ".png",
        "extend_image": ".png",
    }
    ext = subtype_ext_map.get(subtype, ".mp4")

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

    # audio_output 节点：从上游 artifacts 提取音频 URL 透传
    if subtype == "audio_output" and input_artifacts:
        audio_art = next((a for a in input_artifacts if a.get("type") == "audio" and a.get("url")), None)
        if audio_art:
            result_url = audio_art["url"]
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
                f"render_result/{task_id}/output{ext}" if progress >= 100 else None
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
        "result_url": f"render_result/{task_id}/output{ext}",
    }


@celery_app.task(name="run_export_task")
def run_export_task(task_id: str):
    """视频导出任务：FFmpeg 混流合成"""
    async def _run():
        from app.services.export_service import compose_video
        from app.services.media_service import get_minio_client, upload_file
        from app.config import settings
        from app.models.media_asset import MediaAsset

        sf = _get_celery_session_factory()
        async with sf() as db:
            task = await db.get(RenderTask, uuid.UUID(task_id))
            if not task:
                return

            task.status = "running"
            await db.commit()

            try:
                params = task.node_params or {}
                timeline_data = params.get('timeline_data', {})
                tracks = timeline_data.get('tracks', [])
                duration = timeline_data.get('duration', 30)

                # 从 tracks 收集所有 clip
                clips = []
                for track in tracks:
                    if not track.get('visible', True):
                        continue
                    for clip in track.get('clips', []):
                        if clip.get('mediaUrl'):
                            clips.append({
                                'url': clip['mediaUrl'],
                                'start': clip.get('start', 0),
                                'end': clip.get('end', 5),
                                'track_type': track.get('type', 'video'),
                                'media_type': clip.get('mediaType', 'video'),
                            })

                if not clips:
                    task.status = "failed"
                    task.error_message = "时间轴上没有素材"
                    await db.commit()
                    return

                output_path = await compose_video(
                    clips=clips,
                    output_format=params.get('format', 'mp4'),
                    resolution=params.get('resolution', '1080p'),
                    duration=duration,
                    task_id=task_id,
                    session_factory=sf,
                    subtitles=params.get('subtitles'),
                )

                # 上传到 MinIO
                object_name = f"exports/{task.project_id}/{task_id}{output_path.suffix}"
                with open(str(output_path), 'rb') as f:
                    file_data = f.read()
                await upload_file(
                    bucket=settings.MINIO_BUCKET,
                    object_name=object_name,
                    file_data=file_data,
                    content_type="video/mp4",
                )

                # 创建 MediaAsset
                file_size = os.path.getsize(str(output_path))
                asset = MediaAsset(
                    file_name=f"export_{task_id}{output_path.suffix}",
                    file_type="video/mp4",
                    file_size=file_size,
                    storage_key=object_name,
                    owner_id=task.owner_id,
                )
                db.add(asset)
                await db.flush()

                task.result_url = f"/api/v1/media/{asset.id}/download"
                task.status = "completed"
                task.progress = 100
                await db.commit()

                # 清理临时文件
                import shutil
                shutil.rmtree(str(output_path.parent), ignore_errors=True)

            except Exception as e:
                task.status = "failed"
                task.error_message = str(e)[:500]
                task.progress = 0
                await db.commit()
                logger.error(f"[Export:Error] task={task_id} error={e}")

    _get_celery_loop().run_until_complete(_run())
