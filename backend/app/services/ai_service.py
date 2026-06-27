"""AI 服务调用封装：根据 DB 配置动态调用各平台 AI API"""

import logging
import httpx
from uuid import UUID
from sqlalchemy import select

from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel

logger = logging.getLogger("app.services.ai")


async def _get_provider_and_model(db, model_id: str | UUID) -> tuple[AiProvider, AiModel]:
    """根据 model_id 获取 Provider 和 Model 配置"""
    if isinstance(model_id, str):
        model_id = UUID(model_id)

    result = await db.execute(select(AiModel).where(AiModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise ValueError(f"AI Model {model_id} 不存在")

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

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"[AI:LLM] 调用失败: HTTP {response.status_code}: {error_text}")
            raise RuntimeError(f"AI API 调用失败: HTTP {response.status_code}: {error_text}")

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        logger.info(f"[AI:LLM] 响应长度: {len(content)}")
        return content


async def call_image_gen(db, model_id: str | UUID, prompt: str, params: dict | None = None) -> str:
    """文生图（预留接口）

    Returns:
        生成图片的 URL
    """
    raise NotImplementedError("文生图功能待实现，请接入 Stable Diffusion / DALL-E 等")


async def call_video_gen(db, model_id: str | UUID, image_url: str, params: dict | None = None) -> str:
    """图生视频（预留接口）

    Returns:
        生成视频的 URL
    """
    raise NotImplementedError("图生视频功能待实现，请接入 Kling / Runway 等")


async def call_tts(db, model_id: str | UUID, text: str, params: dict | None = None) -> str:
    """TTS（预留接口）

    Returns:
        生成音频的 URL
    """
    raise NotImplementedError("TTS 功能待实现，请接入 CosyVoice 等")
