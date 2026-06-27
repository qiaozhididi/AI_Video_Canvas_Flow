# 渲染中心 + AI 可配置系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 渲染中心前后端打通 + AI Provider/Model 可配置系统 + Celery 任务接入豆包 LLM

**Architecture:** 后端新增 ai_providers/ai_models 表和 CRUD API，ai_service.py 统一封装 AI 调用；render.py 新增列表端点并触发 Celery；Celery 任务实时写回 DB；前端 RenderCenter 替换 Mock，Settings 新增 AI 配置面板

**Tech Stack:** FastAPI + SQLAlchemy + Celery + RabbitMQ + PostgreSQL + MinIO + React + TypeScript + Zustand

## Global Constraints

- 后端 API 路径前缀 `/api/v1`
- 数据库列用 `TIMESTAMP WITHOUT TIME ZONE`（用 `datetime.utcnow()`）
- Celery 队列必须 `durable=True`（RabbitMQ 4.x 要求）
- 前端 API 客户端使用相对路径 + Vite proxy
- API Key 在数据库中存储原始值（后续可加加密），环境变量中的 Key 作为默认初始值
- 所有 API 数据必须持久化到 PostgreSQL，禁止内存存储

---

## File Structure

**后端新增：**
- `backend/app/models/ai_provider.py` — AI Provider ORM 模型
- `backend/app/models/ai_model.py` — AI Model ORM 模型
- `backend/app/api/ai.py` — AI Provider/Model CRUD 路由
- `backend/app/services/ai_service.py` — AI 调用封装（LLM/文生图/视频/TTS）

**后端修改：**
- `backend/app/database.py` — 注册新模型
- `backend/app/api/router.py` — 注册 AI 路由
- `backend/app/api/render.py` — 新增 list 端点 + 触发 Celery + cancel revoke
- `backend/app/tasks/render_tasks.py` — 接入 ai_service + 实时写 DB
- `backend/app/config.py` — 新增默认 AI 环境变量
- `backend/.env` — 新增默认 AI 配置

**前端修改：**
- `frontend/src/utils/apiClient.ts` — 新增 renderApi.list + aiApi
- `frontend/src/pages/RenderCenter.tsx` — 替换 Mock 对接真实 API
- `frontend/src/pages/Settings.tsx` — 新增 AI 配置面板

**前端新增：**
- `frontend/src/mock/renderMock.ts` — 渲染 Mock 数据
- `frontend/src/mock/index.ts` — 更新导出

---

### Task 1: AI Provider + AI Model 数据库模型

**Files:**
- Create: `backend/app/models/ai_provider.py`
- Create: `backend/app/models/ai_model.py`
- Modify: `backend/app/database.py`

**Interfaces:**
- Produces: `AiProvider` 模型（id, name, platform, base_url, api_key, is_active, created_at, updated_at）
- Produces: `AiModel` 模型（id, provider_id, model_id, display_name, model_type, is_active, created_at, updated_at）

- [ ] **Step 1: 创建 AiProvider 模型**

```python
# backend/app/models/ai_provider.py
"""AI Provider ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AiProvider(Base):
    """AI 服务提供商配置"""

    __tablename__ = "ai_providers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    platform: Mapped[str] = mapped_column(String(64), nullable=False)  # volcengine/openai/custom
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    api_key: Mapped[str] = mapped_column(String(512), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: 创建 AiModel 模型**

```python
# backend/app/models/ai_model.py
"""AI Model ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AiModel(Base):
    """AI 模型配置"""

    __tablename__ = "ai_models"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_providers.id"))
    model_id: Mapped[str] = mapped_column(String(128), nullable=False)  # 平台模型标识
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)  # 前端显示名
    model_type: Mapped[str] = mapped_column(String(32), nullable=False)  # llm/image_gen/video_gen/tts
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 3: 在 database.py 中注册新模型**

在 `backend/app/database.py` 的 import 区域添加：
```python
from app.models.ai_provider import AiProvider  # noqa: F401
from app.models.ai_model import AiModel  # noqa: F401
```

- [ ] **Step 4: 运行数据库迁移创建表**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/backend && alembic revision --autogenerate -m "add ai_providers and ai_models tables" && alembic upgrade head
```

- [ ] **Step 5: 验证表已创建**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/backend && python -c "from app.database import engine; import asyncio; from sqlalchemy import text; async def check(): async with engine.begin() as conn: r = await conn.execute(text(\"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('ai_providers','ai_models')\")); print([row[0] for row in r]); asyncio.run(check())"
```

Expected: `['ai_providers', 'ai_models']`

---

### Task 2: AI Provider/Model CRUD API

**Files:**
- Create: `backend/app/api/ai.py`
- Modify: `backend/app/api/router.py`
- Modify: `backend/app/config.py`
- Modify: `backend/.env`

**Interfaces:**
- Consumes: AiProvider, AiModel 模型
- Produces: `POST/GET/PUT/DELETE /api/v1/ai/providers`, `POST/GET/PUT/DELETE /api/v1/ai/models`
- Produces: `ai_service.py` 的配置读取接口

- [ ] **Step 1: 新增环境变量到 config.py**

在 `backend/app/config.py` 的 Settings 类中添加：
```python
    # 默认 AI 配置（首次启动自动创建 Provider/Model）
    DEFAULT_AI_PROVIDER_NAME: str = "火山引擎"
    DEFAULT_AI_PLATFORM: str = "volcengine"
    DEFAULT_AI_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    DEFAULT_AI_API_KEY: str = ""
    DEFAULT_AI_MODEL_ID: str = "doubao-seed-2-1-turbo-260628"
    DEFAULT_AI_MODEL_DISPLAY_NAME: str = "豆包 Seed 2.1 Turbo"
    DEFAULT_AI_MODEL_TYPE: str = "llm"
```

- [ ] **Step 2: 新增环境变量到 .env**

在 `backend/.env` 末尾添加：
```env
# 默认 AI 配置
DEFAULT_AI_PROVIDER_NAME=火山引擎
DEFAULT_AI_PLATFORM=volcengine
DEFAULT_AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DEFAULT_AI_API_KEY=ark-2f3e7fdb-c282-4454-9290-edea990c168b-72bbb
DEFAULT_AI_MODEL_ID=doubao-seed-2-1-turbo-260628
DEFAULT_AI_MODEL_DISPLAY_NAME=豆包 Seed 2.1 Turbo
DEFAULT_AI_MODEL_TYPE=llm
```

- [ ] **Step 3: 创建 AI CRUD 路由**

创建 `backend/app/api/ai.py`，实现：
- Provider CRUD（create/list/update/delete）
- Model CRUD（create/list/update/delete，list 支持 provider_id 筛选和 model_type 筛选）
- 启动时自动初始化默认 Provider/Model（`ensure_default_ai_config()` 函数）

```python
# backend/app/api/ai.py
"""AI Provider/Model 配置路由"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.deps import CurrentUser, DBSession
from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel
from app.config import settings

logger = logging.getLogger("app.api.ai")

router = APIRouter()


# ── Pydantic Schemas ──

class ProviderCreate(BaseModel):
    name: str
    platform: str  # volcengine/openai/custom
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
    model_type: str  # llm/image_gen/video_gen/tts
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
        "api_key": p.api_key[:8] + "..." if len(p.api_key) > 8 else p.api_key,  # 脱敏
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
    # 校验 provider 存在
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


# ── 默认配置初始化 ──

async def ensure_default_ai_config(db):
    """首次启动时自动创建默认 Provider 和 Model"""
    from sqlalchemy import func

    # 检查是否已有 Provider
    count_result = await db.execute(select(func.count()).select_from(AiProvider))
    count = count_result.scalar()
    if count > 0:
        return

    if not settings.DEFAULT_AI_API_KEY:
        logger.warning("[AI:Init] DEFAULT_AI_API_KEY 未配置，跳过自动初始化")
        return

    # 创建默认 Provider
    provider = AiProvider(
        name=settings.DEFAULT_AI_PROVIDER_NAME,
        platform=settings.DEFAULT_AI_PLATFORM,
        base_url=settings.DEFAULT_AI_BASE_URL,
        api_key=settings.DEFAULT_AI_API_KEY,
        is_active=True,
    )
    db.add(provider)
    await db.flush()

    # 创建默认 Model
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
```

- [ ] **Step 4: 注册路由到 router.py**

在 `backend/app/api/router.py` 中添加：
```python
from app.api.ai import router as ai_router
api_router.include_router(ai_router, prefix="/ai", tags=["ai"])
```

- [ ] **Step 5: 在应用启动时初始化默认 AI 配置**

在 `backend/app/main.py` 的 lifespan 中调用 `ensure_default_ai_config`：

```python
from app.api.ai import ensure_default_ai_config
# 在 lifespan 函数中，数据库初始化后添加：
async with async_session() as db:
    await ensure_default_ai_config(db)
```

- [ ] **Step 6: 验证 API**

```bash
# 获取 token 后测试
curl -s http://localhost:8000/api/v1/ai/providers -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
curl -s "http://localhost:8000/api/v1/ai/models?model_type=llm" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: 默认 Provider（火山引擎）和 Model（豆包 Seed 2.1 Turbo）

---

### Task 3: AI Service 服务层

**Files:**
- Create: `backend/app/services/ai_service.py`

**Interfaces:**
- Consumes: AiProvider, AiModel 模型
- Produces: `call_llm(db, model_id, messages)` — 调用 LLM
- Produces: `call_image_gen(db, model_id, prompt, params)` — 文生图（预留）
- Produces: `call_video_gen(db, model_id, image_url, params)` — 图生视频（预留）
- Produces: `call_tts(db, model_id, text, params)` — TTS（预留）

- [ ] **Step 1: 创建 ai_service.py**

```python
# backend/app/services/ai_service.py
"""AI 服务调用封装：根据 DB 配置动态调用各平台 AI API"""

import logging
import httpx
from sqlalchemy import select

from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel

logger = logging.getLogger("app.services.ai")


async def _get_provider_and_model(db, model_id: str) -> tuple[AiProvider, AiModel]:
    """根据 model_id 获取 Provider 和 Model 配置"""
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


async def call_llm(db, model_id: str, messages: list[dict], temperature: float = 0.7) -> str:
    """调用 LLM（兼容 OpenAI Chat Completions API 格式）

    Args:
        db: 数据库 session
        model_id: AI Model UUID
        messages: OpenAI 格式消息列表 [{"role": "user", "content": "..."}]
        temperature: 生成温度

    Returns:
        LLM 响应文本
    """
    from uuid import UUID
    provider, model = await _get_provider_and_model(db, UUID(model_id) if isinstance(model_id, str) else model_id)

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


async def call_image_gen(db, model_id: str, prompt: str, params: dict | None = None) -> str:
    """文生图（预留接口）

    Returns:
        生成图片的 URL
    """
    raise NotImplementedError("文生图功能待实现，请接入 Stable Diffusion / DALL-E 等")


async def call_video_gen(db, model_id: str, image_url: str, params: dict | None = None) -> str:
    """图生视频（预留接口）

    Returns:
        生成视频的 URL
    """
    raise NotImplementedError("图生视频功能待实现，请接入 Kling / Runway 等")


async def call_tts(db, model_id: str, text: str, params: dict | None = None) -> str:
    """TTS（预留接口）

    Returns:
        生成音频的 URL
    """
    raise NotImplementedError("TTS 功能待实现，请接入 CosyVoice 等")
```

- [ ] **Step 2: 安装 httpx 依赖**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/backend && pip install httpx
```

- [ ] **Step 3: 验证 LLM 调用**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/backend && python -c "
import asyncio
from app.database import async_session
from app.services.ai_service import call_llm

async def test():
    async with async_session() as db:
        # 先获取 model id
        from sqlalchemy import select
        from app.models.ai_model import AiModel
        result = await db.execute(select(AiModel).limit(1))
        model = result.scalar_one_or_none()
        if not model:
            print('无 AI Model，请先确保 Task 2 已完成')
            return
        response = await call_llm(db, str(model.id), [{'role': 'user', 'content': '你好，请用一句话介绍自己'}])
        print(f'LLM 响应: {response}')

asyncio.run(test())
"
```

Expected: 豆包 LLM 的响应文本

---

### Task 4: 渲染任务后端改造 — Celery 触发 + 列表端点 + DB 写回

**Files:**
- Modify: `backend/app/api/render.py`
- Modify: `backend/app/tasks/render_tasks.py`

**Interfaces:**
- Consumes: ai_service.call_llm
- Produces: `GET /api/v1/render/` 列表端点
- Produces: Celery 任务写回 DB（progress/status/result_url/error_message）

- [ ] **Step 1: 改造 render.py — 新增列表端点 + 触发 Celery + cancel revoke**

完整替换 `backend/app/api/render.py`：

```python
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
    task_type: str = "render"  # render / text2img / img2video / tts / ai_generate
    output_format: str = "mp4"
    model_id: str | None = None  # AI Model UUID（AI 推理时需要）
    prompt: str | None = None  # 用户输入的提示词


def _task_to_dict(task: RenderTask) -> dict:
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
    return [_task_to_dict(t) for t in tasks]


@router.post("/", summary="创建渲染任务")
async def create_render_task(body: RenderTaskCreate, db: DBSession, user: CurrentUser):
    task = RenderTask(
        project_id=uuid.UUID(body.project_id),
        owner_id=uuid.UUID(user),
        task_type=body.task_type,
        status="pending",
        progress=0.0,
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

    # 撤销 Celery 任务
    if task.celery_task_id:
        from app.tasks.celery_app import celery_app
        celery_app.control.revoke(task.celery_task_id, terminate=True)
        logger.info(f"[Render:Cancel] revoked celery task {task.celery_task_id}")

    task.status = "cancelled"
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)

    logger.info(f"[Render:Cancel] id={task_id}")
    return _task_to_dict(task)
```

- [ ] **Step 2: 改造 render_tasks.py — 实时写 DB + 接入 ai_service**

完整替换 `backend/app/tasks/render_tasks.py`：

```python
"""渲染任务：支持 AI 推理 + 工作流渲染"""

import asyncio
import json
import logging
import uuid

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
    from app.database import async_session

    _run_async(_update_task(
        async_session(), task_id,
        status="running", progress=0.0,
    ))

    try:
        if model_id and prompt:
            # AI 推理任务
            result = _run_async(_execute_ai_task(task_id, model_id, prompt))
        else:
            # 默认渲染任务（模拟进度）
            result = _run_async(_execute_render_task(task_id))

        return result

    except Exception as e:
        logger.error(f"[Render:Task] 任务 {task_id} 失败: {e}")
        _run_async(_update_task(
            async_session(), task_id,
            status="failed", error_message=str(e)[:500], progress=0.0,
        ))
        return {"task_id": task_id, "status": "failed", "error": str(e)}


async def _execute_ai_task(task_id: str, model_id: str, prompt: str) -> dict:
    """执行 AI 推理任务"""
    from app.database import async_session
    from app.services.ai_service import call_llm

    async with async_session() as db:
        await _update_task(db, task_id, progress=0.1)

        # 构造 LLM 请求
        messages = [
            {"role": "system", "content": "你是一个 AI 视频工作流设计助手。用户描述需求，你生成工作流配置 JSON。"},
            {"role": "user", "content": prompt},
        ]

        await _update_task(db, task_id, progress=0.3)

        # 调用 LLM
        response_text = await call_llm(db, model_id, messages)

        await _update_task(db, task_id, progress=0.8)

        # 将 LLM 响应作为结果存储
        # TODO: 解析 JSON，创建工作流节点/边
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
    from app.database import async_session

    async with async_session() as db:
        for progress in [0.2, 0.4, 0.6, 0.8, 1.0]:
            import time
            time.sleep(2)  # 模拟渲染耗时
            status = "completed" if progress >= 1.0 else "running"
            await _update_task(
                db, task_id,
                progress=progress, status=status,
                result_url=f"render_result/{task_id}/output.mp4" if progress >= 1.0 else None,
            )

    return {
        "task_id": task_id,
        "status": "completed",
        "result_url": f"render_result/{task_id}/output.mp4",
    }
```

- [ ] **Step 3: 验证渲染任务 API**

```bash
# 创建渲染任务
curl -s -X POST http://localhost:8000/api/v1/render/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "YOUR_PROJECT_ID", "task_type": "render"}' | python3 -m json.tool

# 获取任务列表
curl -s http://localhost:8000/api/v1/render/ \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

### Task 5: 前端 API 客户端扩展 + Mock 数据

**Files:**
- Modify: `frontend/src/utils/apiClient.ts`
- Create: `frontend/src/mock/renderMock.ts`
- Modify: `frontend/src/mock/index.ts`

**Interfaces:**
- Consumes: 后端 API 响应格式
- Produces: `renderApi.list()`, `aiApi.providers.*`, `aiApi.models.*`

- [ ] **Step 1: 在 apiClient.ts 中新增接口和 API 方法**

在 `frontend/src/utils/apiClient.ts` 中添加：

1. 新增 TypeScript 接口（在 RenderTaskResponse 后面）：
```typescript
// ── AI Provider ──

export interface AiProviderResponse {
  id: string;
  name: string;
  platform: string;
  base_url: string;
  api_key: string; // 脱敏
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiProviderCreateRequest {
  name: string;
  platform: string;
  base_url: string;
  api_key: string;
  is_active?: boolean;
}

export interface AiProviderUpdateRequest {
  name?: string;
  platform?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
}

// ── AI Model ──

export interface AiModelResponse {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  model_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiModelCreateRequest {
  provider_id: string;
  model_id: string;
  display_name: string;
  model_type: string;
  is_active?: boolean;
}

export interface AiModelUpdateRequest {
  provider_id?: string;
  model_id?: string;
  display_name?: string;
  model_type?: string;
  is_active?: boolean;
}
```

2. 新增 renderApi.list 方法（在 renderApi 对象中添加）：
```typescript
  list: (params?: { status?: string; limit?: number }) =>
    request<RenderTaskResponse[]>(
      `/render/${params ? '?' + new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v != null).map(([k, v]) => [k, String(v)])
      ).toString() : ''}`,
    ),
```

3. 新增 aiApi 对象（在文件末尾 export 区）：
```typescript
export const aiApi = {
  providers: {
    list: () => request<AiProviderResponse[]>('/ai/providers'),
    create: (data: AiProviderCreateRequest) =>
      request<AiProviderResponse>('/ai/providers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: AiProviderUpdateRequest) =>
      request<AiProviderResponse>(`/ai/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/ai/providers/${id}`, { method: 'DELETE' }),
  },
  models: {
    list: (params?: { provider_id?: string; model_type?: string }) =>
      request<AiModelResponse[]>(
        `/ai/models${params ? '?' + new URLSearchParams(
          Object.entries(params).filter(([_, v]) => v != null).map(([k, v]) => [k, String(v)])
        ).toString() : ''}`,
      ),
    create: (data: AiModelCreateRequest) =>
      request<AiModelResponse>('/ai/models', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: AiModelUpdateRequest) =>
      request<AiModelResponse>(`/ai/models/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/ai/models/${id}`, { method: 'DELETE' }),
  },
};
```

- [ ] **Step 2: 创建渲染 Mock 数据**

创建 `frontend/src/mock/renderMock.ts`：
```typescript
import type { RenderTaskResponse } from '@/utils/apiClient';

export const isMockRender = import.meta.env.VITE_MOCK_MEDIA === 'true';

export function generateMockRenderTasks(): RenderTaskResponse[] {
  const statuses = ['queued', 'running', 'completed', 'failed'] as const;
  const projects = ['AI 短片 - 城市夜景', '角色动画测试', 'BGM 混音导出', '文生图批量输出', '语音合成测试'];
  const types = ['render', 'text2img', 'ai_generate', 'render', 'tts'];

  return Array.from({ length: 5 }, (_, i) => ({
    id: `mock-render-${i.toString().padStart(3, '0')}`,
    project_id: `mock-proj-${i}`,
    owner_id: '00000000-0000-0000-0000-000000000001',
    task_type: types[i],
    status: statuses[i],
    progress: statuses[i] === 'completed' ? 1.0 : statuses[i] === 'running' ? 0.67 : statuses[i] === 'failed' ? 0.45 : 0.0,
    celery_task_id: `celery-mock-${i}`,
    result_url: statuses[i] === 'completed' ? `mock/render/${i}/output.mp4` : null,
    error_message: statuses[i] === 'failed' ? 'AI 推理服务超时' : null,
    created_at: new Date(Date.now() - i * 3600_000).toISOString(),
    updated_at: new Date(Date.now() - i * 1800_000).toISOString(),
  }));
}
```

- [ ] **Step 3: 更新 mock/index.ts 导出**

在 `frontend/src/mock/index.ts` 中添加：
```typescript
export { isMockRender, generateMockRenderTasks } from './renderMock';
```

- [ ] **Step 4: TSC 编译验证**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx tsc --noEmit
```

Expected: 零错误

---

### Task 6: 前端 RenderCenter.tsx — 替换 Mock 对接真实 API

**Files:**
- Modify: `frontend/src/pages/RenderCenter.tsx`

**Interfaces:**
- Consumes: renderApi.list/create/get/cancel, renderApi.poll
- Produces: 渲染中心完整页面（任务列表 + 统计 + 提交 + 轮询进度 + 取消 + 下载）

- [ ] **Step 1: 完整重写 RenderCenter.tsx**

替换为对接真实 API 的版本，功能包括：
- 任务列表从 `renderApi.list()` 加载
- 统计卡片从真实数据计算
- 进度轮询：对 running/pending 任务每 2s 轮询
- 取消任务：`renderApi.cancel()`
- 下载结果：通过 presign URL 下载
- 空状态提示
- 加载状态

组件结构：
```tsx
export default function RenderCenter() {
  const [tasks, setTasks] = useState<RenderTaskResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载任务列表
  const loadTasks = async () => { ... renderApi.list() ... }

  // 自动轮询 running/pending 任务
  useEffect(() => {
    loadTasks();
    pollingRef.current = setInterval(loadTasks, 3000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  // 取消任务
  const handleCancel = async (id: string) => { ... renderApi.cancel() ... }

  // 下载结果
  const handleDownload = async (task: RenderTaskResponse) => { ... MinIO presign ... }

  // 统计
  const stats = useMemo(() => ({
    queued: tasks.filter(t => t.status === 'pending').length,
    rendering: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  }), [tasks]);

  // ...渲染 UI
}
```

- [ ] **Step 2: TSC 编译验证**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx tsc --noEmit
```

Expected: 零错误

---

### Task 7: 前端 Settings.tsx — AI 配置面板

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: aiApi.providers.*, aiApi.models.*

- [ ] **Step 1: 在 Settings.tsx 新增 AI 配置标签页**

在现有 Settings 页面中新增"AI 配置"标签页，包含：
- Provider 管理（添加/编辑/删除）
- Model 管理（添加/编辑/删除，关联 Provider）
- 每项显示：名称、平台、Base URL、API Key（脱敏）、状态

- [ ] **Step 2: TSC 编译验证**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx tsc --noEmit
```

Expected: 零错误

---

### Task 8: 端到端联调验证

**Files:** 无新增

- [ ] **Step 1: 启动后端 + Celery worker**

```bash
# 终端 1: FastAPI
cd /Users/qzfrato/AI_Canvas_Flow/backend && uvicorn app.main:app --reload --port 8000

# 终端 2: Celery worker
cd /Users/qzfrato/AI_Canvas_Flow/backend && celery -A app.tasks.celery_app worker --loglevel=info
```

- [ ] **Step 2: 启动前端**

```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && npm run dev
```

- [ ] **Step 3: 验证 AI 配置**

1. 登录 → 进入设置页 → AI 配置标签
2. 确认默认 Provider（火山引擎）和 Model（豆包）已自动创建
3. 尝试添加新 Provider/Model

- [ ] **Step 4: 验证渲染中心**

1. 进入渲染中心页面
2. 确认任务列表加载正常（无 Mock 数据）
3. 创建新渲染任务
4. 观察进度轮询更新
5. 取消任务
6. 下载已完成任务的结果

- [ ] **Step 5: 验证 AI LLM 调用**

1. 创建 AI 推理任务（选择豆包模型 + 输入提示词）
2. 观察 Celery 日志中的 LLM 调用
3. 确认任务状态和结果更新

- [ ] **Step 6: 更新 DEVELOPMENT_ROADMAP.md**

标记渲染中心和 AI 配置为已完成。
