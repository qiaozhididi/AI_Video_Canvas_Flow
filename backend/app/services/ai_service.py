"""AI 服务调用封装：根据 DB 配置动态调用各平台 AI API

支持的 AI 类型：
- LLM（call_llm）：OpenAI Chat Completions 兼容 API
- 文生图（call_image_gen）：OpenAI Images API 兼容格式
- 图生图（call_img2img）：OpenAI Images Edits API 兼容格式
- 图生视频（call_video_gen）：Ark 异步内容生成 API
- TTS（call_audio_gen）：Ark 异步内容生成 API
"""

import logging
import uuid
import httpx
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy import select

from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel

logger = logging.getLogger("app.services.ai")


async def _get_provider_and_model(db, model_id: str | UUID, expected_type: str | None = None) -> tuple[AiProvider, AiModel]:
    """根据 model_id 获取 Provider 和 Model 配置

    Args:
        expected_type: 期望的 model_type，不匹配时抛出 ValueError
    """
    if isinstance(model_id, str):
        model_id = UUID(model_id)

    result = await db.execute(select(AiModel).where(AiModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise ValueError(f"AI Model {model_id} 不存在")

    if expected_type and model.model_type != expected_type:
        raise ValueError(
            f"模型 {model.display_name} 类型为 {model.model_type}，期望 {expected_type}。"
            f"请在设置页配置 {expected_type} 类型的模型。"
        )

    result = await db.execute(select(AiProvider).where(AiProvider.id == model.provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise ValueError(f"AI Provider {model.provider_id} 不存在")

    if not provider.is_active or not model.is_active:
        raise ValueError(f"AI Provider/Model 已禁用")

    return provider, model


async def call_llm(db, model_id: str | UUID, messages: list[dict], temperature: float = 0.7) -> str:
    """调用 LLM（兼容 OpenAI Chat Completions API 格式）

    Args:
        db: 数据库 session
        model_id: AI Model UUID
        messages: OpenAI 格式消息列表 [{"role": "user", "content": "..."}]
        temperature: 生成温度

    Returns:
        LLM 响应文本
    """
    provider, model = await _get_provider_and_model(db, model_id)

    url = f"{provider.base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model.model_id,
        "messages": messages,
        "temperature": temperature,
    }

    logger.info(f"[AI:LLM] 调用 {provider.name}/{model.display_name}, messages={len(messages)}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"[AI:LLM] 调用失败: HTTP {response.status_code}: {error_text}")
            raise RuntimeError(f"AI API 调用失败: HTTP {response.status_code}: {error_text}")

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        logger.info(f"[AI:LLM] 响应长度: {len(content)}")
        return content


async def _handle_image_response(db, data: dict, owner_id: str | None) -> dict:
    """处理图片生成 API 响应：提取图片 URL 并持久化到 MinIO

    支持 OpenAI Images API 格式: {"data": [{"url": "...", "revised_prompt": "..."}]}

    Returns:
        {"url": "/api/v1/media/{id}/download" 或原始 URL, "revised_prompt": "..."}
    """
    if "data" not in data or not data["data"]:
        raise RuntimeError(f"图片生成 API 返回格式异常: {str(data)[:300]}")

    image_data = data["data"][0]
    remote_url = image_data.get("url", "")
    revised_prompt = image_data.get("revised_prompt", "")

    if remote_url:
        try:
            _, persistent_url = await _download_to_minio(
                db, remote_url, f"{uuid.uuid4()}.png", "image/png", owner_id=owner_id,
            )
            return {"url": persistent_url, "revised_prompt": revised_prompt}
        except Exception as e:
            logger.warning(f"[AI:Image] MinIO 持久化失败，使用原始 URL: {e}")
            return {"url": remote_url, "revised_prompt": revised_prompt}

    return {"url": remote_url, "revised_prompt": revised_prompt}


async def call_image_gen(db, model_id: str | UUID, prompt: str, params: dict | None = None) -> dict:
    """文生图：调用兼容 OpenAI Images API 的端点

    Args:
        db: 数据库 session
        model_id: AI Model UUID（model_type 应为 image_gen）
        prompt: 图片描述提示词
        params: 额外参数（size, n 等）

    Returns:
        {"url": "/api/v1/media/{id}/download", "revised_prompt": "..."} 持久化后的图片信息
    """
    provider, model = await _get_provider_and_model(db, model_id, expected_type="image_gen")

    url = f"{provider.base_url.rstrip('/')}/images/generations"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model.model_id,
        "prompt": prompt,
        "n": params.get("n", 1) if params else 1,
        "size": params.get("size", "2k") if params else "2k",
    }
    # 火山引擎 / OpenAI 兼容格式
    if params and "response_format" in params:
        body["response_format"] = params["response_format"]

    logger.info(f"[AI:ImageGen] 调用 {provider.name}/{model.display_name}, prompt={prompt[:50]}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"[AI:ImageGen] 调用失败: HTTP {response.status_code}: {error_text}")
            raise RuntimeError(f"文生图 API 调用失败: HTTP {response.status_code}: {error_text}")

        data = response.json()
        logger.info(f"[AI:ImageGen] 生成成功")
        owner_id = params.get("_owner_id") if params else None
        return await _handle_image_response(db, data, owner_id)


async def call_img2img(db, model_id: str | UUID, prompt: str, image_url: str, params: dict | None = None) -> dict:
    """图生图：调用兼容 OpenAI Images API 的端点，通过 image 参数传入参考图片

    火山引擎 SeedReam 使用 /images/generations + image 参数实现图生图/图改图

    Args:
        db: 数据库 session
        model_id: AI Model UUID（model_type 应为 image_gen）
        prompt: 图片编辑描述提示词
        image_url: 参考图片 URL（公网可访问或内部 MinIO 路径）
        params: 额外参数（size, n 等）

    Returns:
        {"url": "/api/v1/media/{id}/download", "revised_prompt": "..."} 持久化后的图片信息
    """
    from app.config import settings

    provider, model = await _get_provider_and_model(db, model_id, expected_type="image_gen")

    # 内部 MinIO 路径转为 base64（火山引擎 API 的 image 参数支持 base64）
    api_image = image_url
    if image_url.startswith("/api/v1/media/"):
        try:
            from app.services.media_service import get_presigned_url
            from app.models.media_asset import MediaAsset
            asset_id = image_url.split("/api/v1/media/")[1].split("/")[0]
            asset = await db.get(MediaAsset, uuid.UUID(asset_id))
            if asset:
                # 下载图片并转 base64
                presigned = await get_presigned_url(
                    bucket=settings.MINIO_BUCKET,
                    object_name=asset.storage_key,
                    expires_hours=1,
                )
                async with httpx.AsyncClient(timeout=30.0) as dl_client:
                    dl_resp = await dl_client.get(presigned)
                    if dl_resp.status_code == 200:
                        import base64
                        b64 = base64.b64encode(dl_resp.content).decode("utf-8")
                        mime = asset.file_type or "image/png"
                        api_image = f"data:{mime};base64,{b64}"
                        logger.info(f"[AI:Img2Img] 内部图片转 base64 成功, 大小={len(b64)} chars")
                    else:
                        logger.warning(f"[AI:Img2Img] 下载图片失败: HTTP {dl_resp.status_code}")
                        api_image = f"http://localhost:{settings.PORT}{image_url}"
            else:
                logger.warning(f"[AI:Img2Img] MediaAsset {asset_id} 不存在")
                api_image = f"http://localhost:{settings.PORT}{image_url}"
        except Exception as e:
            logger.warning(f"[AI:Img2Img] 图片转换失败: {e}")
            api_image = f"http://localhost:{settings.PORT}{image_url}"

    url = f"{provider.base_url.rstrip('/')}/images/generations"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model.model_id,
        "prompt": prompt,
        "image": api_image,
        "n": params.get("n", 1) if params else 1,
        "size": params.get("size", "2k") if params else "2k",
    }

    logger.info(f"[AI:Img2Img] 调用 {provider.name}/{model.display_name}, prompt={prompt[:50]}, image={'base64' if api_image.startswith('data:') else api_image[:80]}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"[AI:Img2Img] 调用失败: HTTP {response.status_code}: {error_text}")
            raise RuntimeError(f"图生图 API 调用失败: HTTP {response.status_code}: {error_text}")

        data = response.json()
        logger.info(f"[AI:Img2Img] 生成成功")
        owner_id = params.get("_owner_id") if params else None
        return await _handle_image_response(db, data, owner_id)


async def _poll_ark_task(base_url: str, api_key: str, task_id: str, timeout: float = 300.0, interval: float = 5.0) -> dict:
    """轮询 Ark 异步任务直到完成

    Args:
        base_url: Provider base_url
        api_key: Provider api_key
        task_id: 异步任务 ID
        timeout: 最大等待秒数
        interval: 轮询间隔秒数

    Returns:
        succeeded 时返回完整响应体

    Raises:
        RuntimeError: 任务 failed/expired/cancelled 或超时
    """
    import asyncio

    url = f"{base_url.rstrip('/')}/contents/generations/tasks/{task_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    elapsed = 0.0
    async with httpx.AsyncClient(timeout=30.0) as client:
        while elapsed < timeout:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                raise RuntimeError(f"轮询任务状态失败: HTTP {resp.status_code}: {resp.text[:300]}")

            data = resp.json()
            status = data.get("status", "")

            if status == "succeeded":
                return data
            if status in ("failed", "expired", "cancelled"):
                raise RuntimeError(f"任务 {task_id} 状态异常: {status}, 响应: {str(data)[:500]}")

            await asyncio.sleep(interval)
            elapsed += interval

    raise RuntimeError(f"任务 {task_id} 轮询超时({timeout}s)")


async def _download_to_minio(db, url: str, filename: str, content_type: str, owner_id: str | None = None) -> tuple[str, str]:
    """下载外部 URL 文件到 MinIO 并创建 MediaAsset 记录

    Args:
        db: 数据库 session
        url: 外部文件 URL
        filename: 存储文件名
        content_type: MIME 类型
        owner_id: 所有者用户 ID（字符串）

    Returns:
        (asset_id, persistent_url) persistent_url 格式为 /api/v1/media/{asset_id}/download
    """
    from app.models.media_asset import MediaAsset
    from app.services.media_service import upload_file
    from app.config import settings

    # 下载文件
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise RuntimeError(f"下载文件失败: HTTP {resp.status_code}, url={url[:200]}")
        file_data = resp.content

    # 上传到 MinIO
    asset_id = uuid.uuid4()
    storage_key = f"ai_gen/{owner_id or 'system'}/{asset_id}/{filename}"
    await upload_file(
        bucket=settings.MINIO_BUCKET,
        object_name=storage_key,
        file_data=file_data,
        content_type=content_type,
    )

    # 创建 MediaAsset 记录
    # owner_id 为空时无法创建 MediaAsset（owner_id 有外键约束指向 users 表）
    # 此时只能返回临时 URL（24h 过期）
    if not owner_id:
        logger.warning(f"[MinIO] 无 owner_id，无法持久化到 MediaAsset，使用临时 URL: {url[:100]}")
        return str(asset_id), url

    now = datetime.utcnow()
    asset = MediaAsset(
        id=asset_id,
        owner_id=uuid.UUID(owner_id),
        project_id=None,
        file_name=filename,
        file_type=content_type,
        file_size=len(file_data),
        storage_key=storage_key,
        thumbnail_key=None,
        created_at=now,
        updated_at=now,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    persistent_url = f"/api/v1/media/{asset_id}/download"
    return str(asset_id), persistent_url


async def _extract_ark_media_url(result_data: dict, media_type: str) -> str:
    """从 Ark 异步任务结果中提取媒体 URL

    支持三种响应格式：
    1. content.{media_type}_url（Ark 标准格式）
    2. choices[].message.content（Chat Completions 兼容格式）
    3. data[].url（OpenAI Images API 兼容格式）

    Args:
        result_data: _poll_ark_task 返回的完整响应体
        media_type: "video" 或 "audio"

    Returns:
        媒体文件 URL

    Raises:
        RuntimeError: 未找到媒体 URL
    """
    url_field = f"{media_type}_url"  # video_url / audio_url
    media_url = None

    # 格式1：content.{media_type}_url（Ark 异步内容生成 API 标准格式）
    content = result_data.get("content", {})
    if isinstance(content, dict):
        media_url = content.get(url_field)

    # 格式2：choices[].message.content
    if not media_url:
        choices = result_data.get("choices", [])
        if choices:
            for choice in choices:
                message = choice.get("message", {})
                msg_content = message.get("content", "")
                if isinstance(msg_content, str) and msg_content.startswith("http"):
                    media_url = msg_content
                    break
                if isinstance(msg_content, list):
                    for item in msg_content:
                        if isinstance(item, dict) and item.get("type") == url_field:
                            media_url = item.get(url_field, {}).get("url")
                        elif isinstance(item, dict) and item.get("type") == "file_url":
                            media_url = item.get("file_url", {}).get("url")
                        if media_url:
                            break
                if media_url:
                    break

    # 格式3：data[].url
    if not media_url:
        data_items = result_data.get("data", [])
        if data_items:
            media_url = data_items[0].get("url") or data_items[0].get(url_field)

    if not media_url:
        raise RuntimeError(f"{media_type}生成任务成功但未找到{media_type} URL: {str(result_data)[:500]}")

    return media_url


# media_type → (MIME 类型, 文件后缀)
_ARK_MEDIA_CONFIG: dict[str, tuple[str, str]] = {
    "video": ("video/mp4", ".mp4"),
    "audio": ("audio/mpeg", ".mp3"),
}


async def _call_ark_async(
    db, model_id: str | UUID, prompt: str,
    media_type: str,  # "video" 或 "audio"
    image_url: str | None = None,
    params: dict | None = None,
) -> dict:
    """通用 Ark 异步任务调用（视频/音频生成）

    Args:
        db: 数据库 session
        model_id: AI Model UUID
        prompt: 提示词
        media_type: "video" 或 "audio"
        image_url: 可选参考图片 URL（仅 video 使用）
        params: 额外参数

    Returns:
        {"{media_type}_url": persistent_url, "remote_task_id": "..."}
    """
    expected_type = "video_gen" if media_type == "video" else "tts"
    log_tag = f"AI:{media_type.capitalize()}Gen"

    provider, model = await _get_provider_and_model(db, model_id, expected_type=expected_type)

    base_url = provider.base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }

    # 构建请求体
    content: list[dict] = [{"type": "text", "text": prompt}]
    if image_url:
        content.append({"type": "image_url", "image_url": {"url": image_url}})

    body: dict = {
        "model": model.model_id,
        "content": content,
    }

    logger.info(f"[{log_tag}] 创建任务 {provider.name}/{model.display_name}, prompt={prompt[:50]}")

    # 创建异步任务
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(f"{base_url}/contents/generations/tasks", json=body, headers=headers)
        if resp.status_code != 200:
            error_text = resp.text[:500]
            logger.error(f"[{log_tag}] 创建任务失败: HTTP {resp.status_code}: {error_text}")
            raise RuntimeError(f"{media_type}生成 API 调用失败: HTTP {resp.status_code}: {error_text}")

        task_data = resp.json()
        remote_task_id = task_data.get("id")
        if not remote_task_id:
            raise RuntimeError(f"{media_type}生成 API 未返回任务 ID: {str(task_data)[:300]}")

    logger.info(f"[{log_tag}] 任务已创建: {remote_task_id}, 开始轮询")

    # 轮询任务状态
    result_data = await _poll_ark_task(base_url, provider.api_key, remote_task_id)

    # 提取媒体 URL
    media_url = await _extract_ark_media_url(result_data, media_type)
    logger.info(f"[{log_tag}] {media_type}生成成功, 下载到 MinIO: {media_url[:100]}")

    # 下载到 MinIO 持久化（失败时 fallback 到原始 URL）
    owner_id = params.get("_owner_id") if params else None
    content_type, ext = _ARK_MEDIA_CONFIG[media_type]
    try:
        _, persistent_url = await _download_to_minio(
            db, media_url, f"{remote_task_id}{ext}", content_type, owner_id=owner_id,
        )
    except Exception as e:
        logger.warning(f"[{log_tag}] MinIO 持久化失败，使用原始 URL: {e}")
        persistent_url = media_url

    return {f"{media_type}_url": persistent_url, "remote_task_id": remote_task_id}


async def call_video_gen(db, model_id: str | UUID, prompt: str, image_url: str | None = None, params: dict | None = None) -> dict:
    """图生视频：调用 Ark 异步内容生成 API

    Args:
        db: 数据库 session
        model_id: AI Model UUID（model_type 应为 video_gen）
        prompt: 视频描述提示词
        image_url: 可选参考图片 URL
        params: 额外参数

    Returns:
        {"video_url": "/api/v1/media/{id}/download", "remote_task_id": "..."}
    """
    return await _call_ark_async(db, model_id, prompt, "video", image_url=image_url, params=params)


async def call_audio_gen(db, model_id: str | UUID, text: str, params: dict | None = None) -> dict:
    """TTS：调用 Ark 异步内容生成 API

    Args:
        db: 数据库 session
        model_id: AI Model UUID（model_type 应为 tts）
        text: 待合成文本
        params: 额外参数

    Returns:
        {"audio_url": "/api/v1/media/{id}/download", "remote_task_id": "..."}
    """
    return await _call_ark_async(db, model_id, text, "audio", params=params)


import json
import time
import random
import string
from collections import defaultdict, deque


# ── AI 快速生成:节点白名单(与前端 NODE_TEMPLATES 保持一致) ──

NODE_WHITELIST: dict[str, str] = {
    # subtype → node_type
    "text_input": "input",
    "image_input": "input",
    "audio_input": "input",
    "text_to_image": "ai_inference",
    "image_to_image": "ai_inference",
    "image_to_video": "ai_inference",
    "text_to_speech": "ai_inference",
    "text_to_video": "ai_inference",
    "upscale": "processing",
    "style_transfer": "processing",
    "remove_bg": "processing",
    "extend_image": "processing",
    "if_else": "control",
    "loop": "control",
    "merge": "control",
    "video_output": "output",
    "image_output": "output",
    "audio_output": "output",
}

# 节点默认 label(中文名)
NODE_DEFAULT_LABELS: dict[str, str] = {
    "text_input": "文本输入",
    "image_input": "图片输入",
    "audio_input": "音频输入",
    "text_to_image": "文生图",
    "image_to_image": "图生图",
    "image_to_video": "图生视频",
    "text_to_speech": "文生语音",
    "text_to_video": "文生视频",
    "upscale": "高清放大",
    "style_transfer": "风格化",
    "remove_bg": "抠图",
    "extend_image": "扩图",
    "if_else": "条件分支",
    "loop": "循环",
    "merge": "合并",
    "video_output": "视频输出",
    "image_output": "图片输出",
    "audio_output": "音频输出",
}

# 各 subtype 的默认 params(与 frontend/src/types/canvas.ts 的 NODE_TEMPLATES.defaultParams 保持一致)
# 字段命名以后端执行逻辑为真相源:call_image_gen 读 size(字符串),workflowExecutor 读 model_id/prompt/text。
NODE_DEFAULT_PARAMS: dict[str, dict] = {
    "text_input": {"text": ""},
    "image_input": {"url": ""},
    "audio_input": {"url": ""},
    "text_to_image": {"prompt": "", "size": "1024x1024"},
    "image_to_image": {"prompt": "", "size": "1024x1024"},
    "image_to_video": {"prompt": "", "duration": 5},
    "text_to_speech": {"text": "", "voice": "default"},
    "text_to_video": {"prompt": "", "duration": 5},
    "upscale": {"scale": 2},
    "style_transfer": {"style": ""},
    "remove_bg": {},
    "extend_image": {"direction": "all"},
    "if_else": {"condition": ""},
    "loop": {"count": 1},
    "merge": {},
    "video_output": {"format": "mp4"},
    "image_output": {"format": "png"},
    "audio_output": {"format": "mp3"},
}

# AI 推理节点 model_type 映射(用于查找默认模型)
AI_INFERENCE_MODEL_TYPE: dict[str, str] = {
    "text_to_image": "image_gen",
    "image_to_image": "image_gen",
    "image_to_video": "video_gen",
    "text_to_speech": "tts",
    "text_to_video": "video_gen",
}


SYSTEM_PROMPT = """你是 AI 视频工作流编排助手。根据用户描述生成工作流节点和连接。

合法节点类型(仅可使用以下 subtype):
- 输入:text_input(文本输入), image_input(图片输入), audio_input(音频输入)
- AI 推理:text_to_image(文生图), image_to_image(图生图), image_to_video(图生视频), text_to_speech(文生语音), text_to_video(文生视频)
- 处理:upscale(高清放大), style_transfer(风格化), remove_bg(抠图), extend_image(扩图)
- 控制:if_else(条件分支), loop(循环), merge(合并)
- 输出:video_output(视频输出), image_output(图片输出), audio_output(音频输出)

输出严格 JSON 格式(不要 markdown 代码块,不要额外文字):
{"nodes":[{"id":"n1","subtype":"text_input","label":"文本输入"}],"edges":[{"from":"n1","to":"n2"}]}

规则:
1. 节点 id 用简单标识(n1, n2, n3...)
2. 连接需符合数据流方向:输入 → AI推理/处理 → 输出
3. label 用中文
4. 不要填 params(由系统自动填充)
"""


async def _get_default_model_for_type(db, model_type: str) -> str | None:
    """查找指定 model_type 的首个 active 模型 UUID(字符串)

    用于 AI 推理节点的 model_id 预填。
    """
    if db is None:
        return None
    result = await db.execute(
        select(AiModel).where(
            AiModel.model_type == model_type,
            AiModel.is_active == True,  # noqa: E712
        ).order_by(AiModel.created_at.asc()).limit(1)
    )
    model = result.scalar_one_or_none()
    return str(model.id) if model else None


async def _get_default_llm_model_id(db, model_id: str | None) -> str:
    """获取 LLM 模型 UUID:优先用传入的 model_id,否则取默认 LLM 模型"""
    if model_id:
        return model_id

    if db is None:
        raise RuntimeError("未传入 model_id 且 db 不可用")

    result = await db.execute(
        select(AiModel).where(
            AiModel.model_type == "llm",
            AiModel.is_active == True,  # noqa: E712
        ).order_by(AiModel.created_at.asc()).limit(1)
    )
    model = result.scalar_one_or_none()
    if not model:
        raise RuntimeError("未找到可用的 LLM 模型,请先在设置页配置 model_type='llm' 的 active 模型")
    return str(model.id)


def _parse_llm_json(raw: str) -> dict:
    """解析 LLM 返回的 JSON,容忍 ```json 代码块包裹"""
    text = raw.strip()
    # 去除 markdown 代码块包裹
    if text.startswith("```"):
        # 去掉首行 ```json 或 ```
        lines = text.split("\n")
        if len(lines) >= 2:
            text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
        text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI 返回格式异常,无法解析为 JSON: {e}")

    if not isinstance(data, dict):
        raise RuntimeError("AI 返回格式异常:顶层应为 JSON 对象")
    if "nodes" not in data or not isinstance(data["nodes"], list):
        raise RuntimeError("AI 返回格式异常:缺少 nodes 数组")
    if "edges" not in data or not isinstance(data["edges"], list):
        raise RuntimeError("AI 返回格式异常:缺少 edges 数组")

    return data


def _generate_node_id() -> str:
    """生成节点 ID:node-{timestamp_ms}-{rand6}"""
    ts = int(time.time() * 1000)
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"node-{ts}-{rand}"


def _generate_edge_id() -> str:
    """生成边 ID:edge-{timestamp_ms}-{rand6}"""
    ts = int(time.time() * 1000)
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"edge-{ts}-{rand}"


def _compute_layout(valid_nodes: list[dict]) -> None:
    """按拓扑分层计算 position,直接修改 valid_nodes 中每个元素的 position_x/position_y

    算法:
    1. 根据原始 id(LLM 给的 n1/n2)建邻接表
    2. Kahn 拓扑排序,计算每个节点的层
    3. 第 N 层 x=N*300;同层按索引 y=index*150
    """
    # 原始 id → 节点索引
    id_to_idx = {n["orig_id"]: i for i, n in enumerate(valid_nodes)}

    # 入度 + 邻接表(基于原始 id)
    in_degree = {n["orig_id"]: 0 for n in valid_nodes}
    adj: dict[str, list[str]] = defaultdict(list)
    # 注:edges 此时已绑定到 orig_id(在 _validate_and_map 中处理),但我们在 _validate_and_map 之前计算布局
    # 因此这里用 valid_nodes 之间的 edges(传入参数外的 edges 暂不在此处理)
    # 简化:在调用 _compute_layout 前,先过滤 edges,只保留两端都在 valid_nodes 中的

    # 注:edges 通过闭包传入(见 generate_workflow 实现)
    edges_for_layout = _compute_layout._edges  # type: ignore[attr-defined]
    for e in edges_for_layout:
        src = e["from"]
        tgt = e["to"]
        if src in in_degree and tgt in in_degree:
            adj[src].append(tgt)
            in_degree[tgt] += 1

    # Kahn 分层
    layer: dict[str, int] = {n["orig_id"]: 0 for n in valid_nodes}
    queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
    processed = 0
    while queue:
        nid = queue.popleft()
        processed += 1
        for child in adj[nid]:
            layer[child] = max(layer[child], layer[nid] + 1)
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    # 环检测:若 processed < 节点数,说明有环,用 fallback(按 orig_id 顺序排列)
    if processed < len(valid_nodes):
        logger.warning(f"[AI:Generate] 检测到环,使用 fallback 布局")
        for i, n in enumerate(valid_nodes):
            n["position_x"] = i * 300
            n["position_y"] = 0
        return

    # 按 layer 分组,同层按 orig_id 字典序排序
    by_layer: dict[int, list[dict]] = defaultdict(list)
    for n in valid_nodes:
        by_layer[layer[n["orig_id"]]].append(n)

    for layer_num, nodes_in_layer in by_layer.items():
        nodes_in_layer.sort(key=lambda x: x["orig_id"])
        for idx, n in enumerate(nodes_in_layer):
            n["position_x"] = layer_num * 300
            n["position_y"] = idx * 150


async def generate_workflow(db, description: str, model_id: str | None = None) -> dict:
    """AI 快速生成工作流

    Args:
        db: 数据库 session
        description: 自然语言工作流描述
        model_id: LLM 模型 UUID(可选,不传则取默认 LLM 模型)

    Returns:
        {"nodes": [NodeCreateRequest 兼容 dict], "edges": [EdgeCreateRequest 兼容 dict]}

    Raises:
        RuntimeError: 无可用 LLM 模型 / LLM 调用失败 / JSON 解析失败 / 全部节点非法
    """
    # 1. 获取 LLM 模型
    llm_model_id = await _get_default_llm_model_id(db, model_id)

    # 2. 调 LLM
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": description},
    ]
    logger.info(f"[AI:Generate] 调用 LLM 生成工作流, description={description[:50]}...")
    raw_response = await call_llm(db, llm_model_id, messages, temperature=0.3)

    # 3. 解析 JSON
    data = _parse_llm_json(raw_response)

    # 4. 校验 subtype 白名单 + 生成新 ID + 收集合法节点
    valid_nodes: list[dict] = []  # 每个元素: {orig_id, subtype, label, new_id}
    orig_to_new: dict[str, str] = {}
    skipped = 0
    for n in data["nodes"]:
        orig_id = n.get("id", "")
        subtype = n.get("subtype", "")
        if subtype not in NODE_WHITELIST:
            logger.warning(f"[AI:Generate] 跳过非法 subtype 节点: id={orig_id}, subtype={subtype}")
            skipped += 1
            continue
        if not orig_id:
            orig_id = f"n{len(valid_nodes) + 1}"
        new_id = _generate_node_id()
        valid_nodes.append({
            "orig_id": orig_id,
            "subtype": subtype,
            "label": n.get("label") or NODE_DEFAULT_LABELS.get(subtype, subtype),
            "new_id": new_id,
        })
        orig_to_new[orig_id] = new_id

    if not valid_nodes:
        raise RuntimeError("AI 生成内容无效:全部节点 subtype 非法")

    # 5. 过滤 edges(只保留两端都合法的)+ 重映射 id
    valid_edges: list[dict] = []
    for e in data["edges"]:
        src = e.get("from", "")
        tgt = e.get("to", "")
        if src in orig_to_new and tgt in orig_to_new:
            valid_edges.append({"from": src, "to": tgt})

    # 6. 计算布局(传入 valid_edges 供拓扑分层用)
    _compute_layout._edges = valid_edges  # type: ignore[attr-defined]
    _compute_layout(valid_nodes)

    # 7. 预填参数 + 组装最终 NodeCreateRequest
    result_nodes = []
    for n in valid_nodes:
        subtype = n["subtype"]
        node_type = NODE_WHITELIST[subtype]
        params = dict(NODE_DEFAULT_PARAMS.get(subtype, {}))

        # 预填: text_input.params.text = description
        if subtype == "text_input":
            params["text"] = description
        # 预填: AI 推理节点 params.prompt = description + model_id
        elif subtype in ("text_to_image", "image_to_image", "image_to_video", "text_to_speech"):
            params["prompt"] = description
            model_type = AI_INFERENCE_MODEL_TYPE.get(subtype)
            if model_type:
                default_model = await _get_default_model_for_type(db, model_type)
                if default_model:
                    params["model_id"] = default_model

        result_nodes.append({
            "id": n["new_id"],
            "node_type": node_type,
            "label": n["label"],
            "position_x": n["position_x"],
            "position_y": n["position_y"],
            "config": {
                "type": node_type,
                "subtype": subtype,
                "label": n["label"],
                "params": params,
                "status": "idle",
                "progress": 0,
                "outputArtifacts": [],
            },
        })

    # 8. 组装最终 EdgeCreateRequest
    result_edges = []
    for e in valid_edges:
        result_edges.append({
            "id": _generate_edge_id(),
            "source_node_id": orig_to_new[e["from"]],
            "target_node_id": orig_to_new[e["to"]],
            "source_port": None,
            "target_port": None,
        })

    logger.info(f"[AI:Generate] 生成完成: {len(result_nodes)} 节点, {len(result_edges)} 边, 跳过 {skipped} 非法")

    return {"nodes": result_nodes, "edges": result_edges}
