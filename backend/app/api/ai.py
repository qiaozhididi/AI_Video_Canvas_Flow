"""AI Provider/Model 配置路由"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func

from app.deps import CurrentUser, DBSession
from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel
from app.config import settings

logger = logging.getLogger("app.api.ai")

router = APIRouter()


# ── Pydantic Schemas ──

class ProviderCreate(BaseModel):
    name: str
    platform: str
    base_url: str
    api_key: str
    is_active: bool = True

class ProviderUpdate(BaseModel):
    name: str | None = None
    platform: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    is_active: bool | None = None

class ModelCreate(BaseModel):
    provider_id: str
    model_id: str
    display_name: str
    model_type: str
    is_active: bool = True

class ModelUpdate(BaseModel):
    provider_id: str | None = None
    model_id: str | None = None
    display_name: str | None = None
    model_type: str | None = None
    is_active: bool | None = None


def _provider_to_dict(p: AiProvider) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "platform": p.platform,
        "base_url": p.base_url,
        "api_key": p.api_key[:8] + "..." if len(p.api_key) > 8 else p.api_key,
        "is_active": p.is_active,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }

def _model_to_dict(m: AiModel) -> dict:
    return {
        "id": str(m.id),
        "provider_id": str(m.provider_id),
        "model_id": m.model_id,
        "display_name": m.display_name,
        "model_type": m.model_type,
        "is_active": m.is_active,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


# ── Provider CRUD ──

@router.post("/providers", summary="创建 AI Provider")
async def create_provider(body: ProviderCreate, db: DBSession, user: CurrentUser):
    provider = AiProvider(
        name=body.name,
        platform=body.platform,
        base_url=body.base_url,
        api_key=body.api_key,
        is_active=body.is_active,
    )
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    logger.info(f"[AI:Provider:Create] id={provider.id} name={body.name}")
    return _provider_to_dict(provider)


@router.get("/providers", summary="列出 AI Providers")
async def list_providers(db: DBSession, user: CurrentUser):
    result = await db.execute(select(AiProvider).order_by(AiProvider.created_at.desc()))
    providers = result.scalars().all()
    return [_provider_to_dict(p) for p in providers]


@router.put("/providers/{provider_id}", summary="更新 AI Provider")
async def update_provider(provider_id: str, body: ProviderUpdate, db: DBSession, user: CurrentUser):
    result = await db.execute(select(AiProvider).where(AiProvider.id == uuid.UUID(provider_id)))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider 不存在")

    if body.name is not None:
        provider.name = body.name
    if body.platform is not None:
        provider.platform = body.platform
    if body.base_url is not None:
        provider.base_url = body.base_url
    if body.api_key is not None:
        provider.api_key = body.api_key
    if body.is_active is not None:
        provider.is_active = body.is_active
    provider.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(provider)
    logger.info(f"[AI:Provider:Update] id={provider_id}")
    return _provider_to_dict(provider)


@router.delete("/providers/{provider_id}", status_code=204, summary="删除 AI Provider")
async def delete_provider(provider_id: str, db: DBSession, user: CurrentUser):
    result = await db.execute(select(AiProvider).where(AiProvider.id == uuid.UUID(provider_id)))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider 不存在")
    # 级联删除关联 models
    model_result = await db.execute(select(AiModel).where(AiModel.provider_id == uuid.UUID(provider_id)))
    for model in model_result.scalars().all():
        await db.delete(model)
    await db.delete(provider)
    await db.commit()
    logger.info(f"[AI:Provider:Delete] id={provider_id}")


# ── Model CRUD ──

@router.post("/models", summary="创建 AI Model")
async def create_model(body: ModelCreate, db: DBSession, user: CurrentUser):
    result = await db.execute(select(AiProvider).where(AiProvider.id == uuid.UUID(body.provider_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Provider 不存在")

    model = AiModel(
        provider_id=uuid.UUID(body.provider_id),
        model_id=body.model_id,
        display_name=body.display_name,
        model_type=body.model_type,
        is_active=body.is_active,
    )
    db.add(model)
    await db.commit()
    await db.refresh(model)
    logger.info(f"[AI:Model:Create] id={model.id} model_id={body.model_id}")
    return _model_to_dict(model)


@router.get("/models", summary="列出 AI Models")
async def list_models(
    db: DBSession,
    user: CurrentUser,
    provider_id: str | None = Query(None),
    model_type: str | None = Query(None),
):
    stmt = select(AiModel)
    if provider_id:
        stmt = stmt.where(AiModel.provider_id == uuid.UUID(provider_id))
    if model_type:
        stmt = stmt.where(AiModel.model_type == model_type)
    stmt = stmt.order_by(AiModel.created_at.desc())
    result = await db.execute(stmt)
    models = result.scalars().all()
    return [_model_to_dict(m) for m in models]


@router.put("/models/{model_id}", summary="更新 AI Model")
async def update_model(model_id: str, body: ModelUpdate, db: DBSession, user: CurrentUser):
    result = await db.execute(select(AiModel).where(AiModel.id == uuid.UUID(model_id)))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model 不存在")

    if body.provider_id is not None:
        model.provider_id = uuid.UUID(body.provider_id)
    if body.model_id is not None:
        model.model_id = body.model_id
    if body.display_name is not None:
        model.display_name = body.display_name
    if body.model_type is not None:
        model.model_type = body.model_type
    if body.is_active is not None:
        model.is_active = body.is_active
    model.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(model)
    logger.info(f"[AI:Model:Update] id={model_id}")
    return _model_to_dict(model)


@router.delete("/models/{model_id}", status_code=204, summary="删除 AI Model")
async def delete_model(model_id: str, db: DBSession, user: CurrentUser):
    result = await db.execute(select(AiModel).where(AiModel.id == uuid.UUID(model_id)))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="Model 不存在")
    await db.delete(model)
    await db.commit()
    logger.info(f"[AI:Model:Delete] id={model_id}")


@router.get("/models/default", summary="获取默认 AI 模型")
async def get_default_model(db: DBSession, user: CurrentUser, model_type: str | None = None):
    """返回第一个 active 的 AI Model（关联的 Provider 也必须是 active）

    可通过 model_type 参数过滤模型类型（如 image_gen, video_gen, llm, tts）
    """
    stmt = (
        select(AiModel)
        .where(AiModel.is_active == True)
        .join(AiProvider, AiModel.provider_id == AiProvider.id)
        .where(AiProvider.is_active == True)
    )
    if model_type:
        stmt = stmt.where(AiModel.model_type == model_type)
    stmt = stmt.order_by(AiModel.created_at.desc()).limit(1)
    result = await db.execute(stmt)
    model = result.scalar_one_or_none()
    if not model:
        type_hint = f"（类型: {model_type}）" if model_type else ""
        raise HTTPException(status_code=404, detail=f"未找到可用的 AI 模型{type_hint}，请先在设置页配置")
    return _model_to_dict(model)


# ── 默认配置初始化 ──

async def ensure_default_ai_config(db):
    """首次启动时自动创建默认 Provider 和 Model"""
    count_result = await db.execute(select(func.count()).select_from(AiProvider))
    count = count_result.scalar()
    if count > 0:
        return

    if not settings.DEFAULT_AI_API_KEY:
        logger.warning("[AI:Init] DEFAULT_AI_API_KEY 未配置，跳过自动初始化")
        return

    provider = AiProvider(
        name=settings.DEFAULT_AI_PROVIDER_NAME,
        platform=settings.DEFAULT_AI_PLATFORM,
        base_url=settings.DEFAULT_AI_BASE_URL,
        api_key=settings.DEFAULT_AI_API_KEY,
        is_active=True,
    )
    db.add(provider)
    await db.flush()

    model = AiModel(
        provider_id=provider.id,
        model_id=settings.DEFAULT_AI_MODEL_ID,
        display_name=settings.DEFAULT_AI_MODEL_DISPLAY_NAME,
        model_type=settings.DEFAULT_AI_MODEL_TYPE,
        is_active=True,
    )
    db.add(model)
    await db.commit()
    logger.info(f"[AI:Init] 已创建默认 Provider: {provider.name}, Model: {model.display_name}")


# ── AI 快速生成 ──

class GenerateWorkflowRequest(BaseModel):
    description: str
    mode: str  # "replace" | "append"
    model_id: str | None = None


class GenerateWorkflowResponse(BaseModel):
    nodes: list[dict]
    edges: list[dict]


@router.post("/generate-workflow", summary="AI 快速生成工作流")
async def generate_workflow_endpoint(
    body: GenerateWorkflowRequest,
    db: DBSession,
    user: CurrentUser,
):
    """根据自然语言描述生成工作流节点和边

    - description: 工作流描述
    - mode: "replace"(替换画布) | "append"(追加到画布)
    - model_id: 可选 LLM 模型 UUID,不传则取默认 LLM 模型
    """
    from app.services.ai_service import generate_workflow as _generate_workflow

    if body.mode not in ("replace", "append"):
        raise HTTPException(status_code=422, detail="mode 必须为 'replace' 或 'append'")
    if not body.description.strip():
        raise HTTPException(status_code=422, detail="description 不能为空")

    try:
        result = await _generate_workflow(db, body.description, body.model_id)
    except RuntimeError as e:
        # 区分错误类型返回合适的状态码
        msg = str(e)
        if "未找到可用的 LLM 模型" in msg:
            raise HTTPException(status_code=404, detail=msg)
        elif "AI 返回格式异常" in msg or "AI 生成内容无效" in msg:
            raise HTTPException(status_code=502, detail=msg)
        else:
            raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {msg}")
    except Exception as e:
        logger.error(f"[AI:GenerateWorkflow] 未预期错误: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {str(e)}")

    logger.info(f"[AI:GenerateWorkflow] user={user}, mode={body.mode}, nodes={len(result['nodes'])}")
    return result
