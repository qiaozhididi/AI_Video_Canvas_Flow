"""AI 服务调用封装：根据 DB 配置动态调用各平台 AI API

支持的 AI 类型：
- LLM（call_llm）：OpenAI Chat Completions 兼容 API
- 文生图（call_image_gen）：OpenAI Images API 兼容格式
- 图生视频（call_video_gen）：预留
- TTS（call_tts）：预留
"""

import logging
import httpx
from uuid import UUID
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


async def call_image_gen(db, model_id: str | UUID, prompt: str, params: dict | None = None) -> dict:
    """文生图：调用兼容 OpenAI Images API 的端点

    Args:
        db: 数据库 session
        model_id: AI Model UUID（model_type 应为 image_gen）
        prompt: 图片描述提示词
        params: 额外参数（size, n 等）

    Returns:
        {"url": "https://...", "revised_prompt": "..."} 生成图片信息
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
        "size": params.get("size", "1024x1024") if params else "1024x1024",
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
        # OpenAI 格式: {"data": [{"url": "...", "revised_prompt": "..."}]}
        if "data" in data and len(data["data"]) > 0:
            image_data = data["data"][0]
            result = {
                "url": image_data.get("url", ""),
                "revised_prompt": image_data.get("revised_prompt", ""),
            }
            logger.info(f"[AI:ImageGen] 生成成功: {result['url'][:80]}")
            return result
        else:
            raise RuntimeError(f"文生图 API 返回格式异常: {str(data)[:300]}")


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
