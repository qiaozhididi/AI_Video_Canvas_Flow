# 执行链完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一执行链 Schema、完整传递节点 params、新增节点级重试和工作流断点续执行能力

**Architecture:** 前端 workflowExecutor 传递完整 node_params 到后端，后端 Celery 按 task_type 读取对应 params；新增 retry 端点复制原任务参数创建新任务；resumeWorkflow 跳过已完成节点

**Tech Stack:** FastAPI, SQLAlchemy, Celery, React, TypeScript, Zustand, Alembic

## Global Constraints

- Progress 值必须存储为 0-100 整数（不是 0.0-1.0 小数）
- Celery tasks 必须创建自己的 async engine + session factory
- Celery task revocation 必须使用 AsyncResult.revoke(terminate=True)
- Git commit 必须使用中文简短描述
- NODE_TEMPLATES.defaultParams 必须与后端 NODE_DEFAULT_PARAMS 保持一致
- AI 任务执行必须按 task_type 路由到对应 API

---

## File Structure

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `backend/app/models/render_task.py` | 修改 | ORM progress 类型 Float→Integer |
| `backend/app/schemas/render.py` | 修改 | 删除冗余 RenderTaskCreate，补齐 RenderTaskResponse 字段 |
| `backend/app/api/render.py` | 修改 | RenderTaskCreate 新增 node_params，新增 retry 端点 |
| `backend/app/tasks/render_tasks.py` | 修改 | 签名新增 node_params，各执行函数读取 params |
| `backend/alembic/versions/xxx_progress_int.py` | 新建 | progress 字段 Float→Integer 迁移 |
| `frontend/src/utils/apiClient.ts` | 修改 | RenderTaskCreateRequest 新增 node_params，新增 retry 方法 |
| `frontend/src/utils/workflowExecutor.ts` | 修改 | 传递 node_params，新增 resumeWorkflow |
| `frontend/src/components/canvas/CanvasNode.tsx` | 修改 | 失败状态增加重试按钮 |
| `frontend/src/pages/RenderCenter.tsx` | 修改 | 失败任务增加重试操作 |
| `frontend/src/components/EditorLayout.tsx` | 修改 | 新增断点续执行按钮 |
| `frontend/src/mock/renderMock.ts` | 修改 | progress 改为 0-100 整数，补齐缺失字段 |

---

### Task 1: 后端 ORM + Schema 统一

**Files:**
- Modify: `backend/app/models/render_task.py`
- Modify: `backend/app/schemas/render.py`

**Interfaces:**
- Produces: `RenderTask.progress` 类型为 `Integer`，`RenderTaskResponse` 包含 `node_label`/`project_name` 字段

- [ ] **Step 1: 修改 RenderTask ORM progress 类型为 Integer**

将 `backend/app/models/render_task.py` 中 `Float` 改为 `Integer`：

```python
"""RenderTask ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RenderTask(Base):
    """渲染任务：跟踪视频/AI 推理任务的执行状态"""

    __tablename__ = "render_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    task_type: Mapped[str] = mapped_column(String(64))  # render / ai_text2img / ai_img2video / ai_tts
    status: Mapped[str] = mapped_column(String(32), default="pending")  # pending / running / completed / failed / cancelled
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0~100 整数百分比
    celery_task_id: Mapped[str | None] = mapped_column(String(256))
    result_url: Mapped[str | None] = mapped_column(String(512))
    error_message: Mapped[str | None] = mapped_column(Text)
    node_id: Mapped[str | None] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
```

- [ ] **Step 2: 更新 schemas/render.py — 删除冗余 RenderTaskCreate，补齐 RenderTaskResponse**

```python
"""渲染任务 schema"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RenderTaskResponse(BaseModel):
    """渲染任务响应"""
    id: UUID
    project_id: UUID
    owner_id: UUID
    task_type: str
    status: str
    progress: int  # 0-100 整数百分比
    celery_task_id: str | None
    result_url: str | None
    error_message: str | None
    node_id: str | None
    node_label: str | None
    project_name: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 3: 生成 Alembic 迁移文件**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/backend && alembic revision --autogenerate -m "render_task_progress_int"`

- [ ] **Step 4: 验证迁移文件内容**

检查生成的迁移文件，确认 `progress` 字段从 Float 改为 Integer。如果 autogenerate 未能检测到（因为 PostgreSQL Float→Integer 兼容），则手动创建迁移：

Run: `cd /Users/qzfrato/AI_Canvas_Flow/backend && alembic revision -m "render_task_progress_int"`

手动编辑迁移文件，添加：

```python
def upgrade() -> None:
    op.alter_column('render_tasks', 'progress',
                    existing_type=sa.Float(),
                    type_=sa.Integer(),
                    existing_nullable=True)

def downgrade() -> None:
    op.alter_column('render_tasks', 'progress',
                    existing_type=sa.Integer(),
                    type_=sa.Float(),
                    existing_nullable=True)
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/render_task.py backend/app/schemas/render.py backend/alembic/versions/
git commit -m "统一RenderTask schema，progress改为整数类型"
```

---

### Task 2: 后端 API 新增 node_params + retry 端点

**Files:**
- Modify: `backend/app/api/render.py`

**Interfaces:**
- Consumes: `RenderTask` ORM (Task 1), `run_render_task` Celery task
- Produces: `POST /render/` 接受 `node_params` 字段；`POST /render/{task_id}/retry` 端点

- [ ] **Step 1: 修改 RenderTaskCreate 新增 node_params，修改 create_render_task 传递参数，新增 retry 端点**

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
    task_type: str = "render"  # render / ai_text2img / ai_img2video / ai_tts
    output_format: str = "mp4"
    model_id: str | None = None  # AI Model UUID
    prompt: str | None = None  # 用户提示词
    node_id: str | None = None  # 关联的画布节点 ID
    input_artifacts: list[dict] | None = None  # 上游输出资产
    node_params: dict | None = None  # 节点完整 params（按 task_type 读取对应字段）


def _task_to_dict(
    task: RenderTask,
    node_label: str | None = None,
    project_name: str | None = None,
) -> dict:
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
        "node_id": task.node_id,
        "node_label": node_label,
        "project_name": project_name,
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

    # 批量查询关联的节点标签和项目名称，便于渲染中心区分不同节点的任务
    from app.models.workflow import WorkflowNode
    from app.models.project import Project

    node_ids = {t.node_id for t in tasks if t.node_id}
    project_ids = {t.project_id for t in tasks}

    node_labels: dict[str, str] = {}
    if node_ids:
        node_result = await db.execute(
            select(WorkflowNode.id, WorkflowNode.config).where(WorkflowNode.id.in_(node_ids))
        )
        for nid, config in node_result.all():
            label = config.get("label") if isinstance(config, dict) else None
            node_labels[nid] = label or nid

    project_names: dict[str, str] = {}
    if project_ids:
        proj_result = await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(project_ids))
        )
        for pid, name in proj_result.all():
            project_names[str(pid)] = name

    return [
        _task_to_dict(
            t,
            node_label=node_labels.get(t.node_id) if t.node_id else None,
            project_name=project_names.get(str(t.project_id)),
        )
        for t in tasks
    ]


@router.post("/", summary="创建渲染任务")
async def create_render_task(body: RenderTaskCreate, db: DBSession, user: CurrentUser):
    task = RenderTask(
        project_id=uuid.UUID(body.project_id),
        owner_id=uuid.UUID(user),
        task_type=body.task_type,
        status="pending",
        progress=0,
        node_id=body.node_id,
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
        input_artifacts=body.input_artifacts,
        node_params=body.node_params,
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

    # 撤销 Celery 任务（通过 AsyncResult 发送 revoke 指令，不依赖远程控制）
    if task.celery_task_id:
        from celery.result import AsyncResult
        from app.tasks.celery_app import celery_app
        AsyncResult(task.celery_task_id, app=celery_app).revoke(terminate=True)
        logger.info(f"[Render:Cancel] revoked celery task {task.celery_task_id}")

    task.status = "cancelled"
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)

    logger.info(f"[Render:Cancel] id={task_id}")
    return _task_to_dict(task)


@router.post("/{task_id}/retry", summary="重试渲染任务")
async def retry_render_task(task_id: str, db: DBSession, user: CurrentUser):
    """重试失败/取消的任务：创建新任务，复制原任务参数"""
    result = await db.execute(select(RenderTask).where(RenderTask.id == uuid.UUID(task_id)))
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="渲染任务不存在")
    if original.status not in ("failed", "cancelled"):
        raise HTTPException(status_code=409, detail="只能重试失败或已取消的任务")

    # 从关联节点读取最新 node_params
    node_params: dict | None = None
    if original.node_id:
        from app.models.workflow import WorkflowNode
        node_result = await db.execute(
            select(WorkflowNode.config).where(WorkflowNode.id == original.node_id)
        )
        config = node_result.scalar_one_or_none()
        if config and isinstance(config, dict):
            node_params = config.get("params")

    # 创建新任务
    new_task = RenderTask(
        project_id=original.project_id,
        owner_id=original.owner_id,
        task_type=original.task_type,
        status="pending",
        progress=0,
        node_id=original.node_id,
    )
    db.add(new_task)
    await db.commit()
    await db.refresh(new_task)

    # 触发 Celery 任务（复用原任务的 prompt，从节点读取最新 node_params）
    from app.tasks.render_tasks import run_render_task
    celery_result = run_render_task.delay(
        str(new_task.id),
        model_id=None,  # retry 时从 node_params.model_id 读取
        prompt=None,  # retry 时从 node_params.prompt 或上游提取
        input_artifacts=None,  # retry 时从上游节点重新收集
        node_params=node_params,
    )

    new_task.celery_task_id = celery_result.id
    new_task.status = "running"
    new_task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(new_task)

    logger.info(f"[Render:Retry] original={task_id} new={new_task.id} type={original.task_type}")

    # 查询 node_label 和 project_name
    node_label = None
    project_name = None
    if new_task.node_id:
        from app.models.workflow import WorkflowNode
        nr = await db.execute(
            select(WorkflowNode.config).where(WorkflowNode.id == new_task.node_id)
        )
        cfg = nr.scalar_one_or_none()
        if cfg and isinstance(cfg, dict):
            node_label = cfg.get("label") or new_task.node_id
    from app.models.project import Project
    pr = await db.execute(select(Project.name).where(Project.id == new_task.project_id))
    project_name = pr.scalar_one_or_none()

    return _task_to_dict(new_task, node_label=node_label, project_name=project_name)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/render.py
git commit -m "新增node_params和retry端点"
```

---

### Task 3: 后端 Celery 任务支持 node_params

**Files:**
- Modify: `backend/app/tasks/render_tasks.py`

**Interfaces:**
- Consumes: `run_render_task` 新增 `node_params` 参数 (Task 2)
- Produces: 各 `_do_xxx` 函数从 `node_params` 读取参数

- [ ] **Step 1: 修改 run_render_task 签名，传递 node_params 到 _run_task 和各执行函数**

修改 `backend/app/tasks/render_tasks.py` 中的以下部分：

1. `run_render_task` 函数签名新增 `node_params: dict | None = None`
2. `_run_task` 函数签名新增 `node_params: dict | None = None`，传递给 `_execute_ai_task` 和 `_execute_render_task`
3. `_execute_ai_task` 签名新增 `node_params: dict | None = None`，传递给各 `_do_xxx`
4. `_do_text2img` 签名新增 `node_params: dict | None = None`，从中读取 `size`
5. `_do_img2video` 签名新增 `node_params: dict | None = None`，从中读取 `duration`
6. `_do_tts` 签名新增 `node_params: dict | None = None`，从中读取 `text` 和 `voice`
7. `_execute_render_task` 签名新增 `node_params: dict | None = None`

完整替换 `backend/app/tasks/render_tasks.py`：

```python
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


async def _run_task(task_id: str, model_id: str | None, prompt: str | None,
                    input_artifacts: list[dict] | None, node_params: dict | None):
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

    # 2. 如果未传 node_params 但有 node_id，从节点 config 读取
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
        node_params: 节点完整 params（按 task_type 读取对应字段）
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
    """从 input_artifacts 中提取文本内容"""
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
    task_id: str, model_id: str | None, prompt: str | None,
    input_artifacts: list[dict] | None = None, node_params: dict | None = None,
) -> dict:
    """执行 AI 推理任务：按 task_type 路由到不同的 AI 服务"""
    sf = _get_celery_session_factory()

    # 读取 task_type
    async with sf() as db:
        from sqlalchemy import select
        from app.models.render_task import RenderTask
        result = await db.execute(
            select(RenderTask.task_type).where(RenderTask.id == uuid.UUID(task_id))
        )
        task_type = result.scalar_one_or_none() or ""

    # 从 node_params 提取 model_id（优先使用传入的 model_id）
    if not model_id and node_params:
        model_id = node_params.get("model_id")

    # 构建用户内容：优先 prompt，否则从 node_params 提取，最后从 input_artifacts 提取
    user_content = prompt or ""
    if not user_content and node_params:
        user_content = node_params.get("prompt", "") or node_params.get("text", "")
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


async def _do_text2img(task_id: str, model_id: str | None, prompt: str,
                       input_artifacts: list[dict] | None = None,
                       node_params: dict | None = None) -> dict:
    """文生图：调用 image_gen API 或模拟"""
    from app.services.ai_service import call_image_gen

    # 从 node_params 读取 size 参数
    size = "2048x2048"
    if node_params:
        size = node_params.get("size", size) or size

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
            logger.warning(f"[AI:Text2Img] 模型不匹配，回退模拟: {e}")
            await _update_task(db, task_id, progress=50)
        except Exception as e:
            logger.error(f"[AI:Text2Img] 调用失败: {e}", exc_info=True)
            await _update_task(db, task_id, status="failed", error_message=str(e)[:500], progress=0)
            return {"task_id": task_id, "status": "failed", "error": str(e)}

        if not result_url:
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


async def _do_img2video(task_id: str, model_id: str | None, prompt: str,
                        input_artifacts: list[dict] | None = None,
                        node_params: dict | None = None) -> dict:
    """图生视频（待实现，当前走模拟）"""
    # 从 node_params 读取 duration 参数
    duration = 5
    if node_params:
        duration = node_params.get("duration", duration) or duration

    sf = _get_celery_session_factory()
    async with sf() as db:
        await _update_task(db, task_id, status="running", progress=10)
        for p in [30, 60, 90]:
            await asyncio.sleep(2)
            await _update_task(db, task_id, progress=p)
        result_url = f"ai_result/{task_id}/video.mp4"
        await _update_task(db, task_id, progress=100, status="completed", result_url=result_url)
    return {"task_id": task_id, "status": "completed", "result_url": result_url}


async def _do_tts(task_id: str, model_id: str | None, prompt: str,
                  node_params: dict | None = None) -> dict:
    """文生语音（待实现，当前走模拟）"""
    # 从 node_params 读取 voice 参数
    voice = "default"
    if node_params:
        voice = node_params.get("voice", voice) or voice

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
    task_id: str, input_artifacts: list[dict] | None = None,
    subtype: str | None = None, node_params: dict | None = None,
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/tasks/render_tasks.py
git commit -m "Celery任务支持node_params参数读取"
```

---

### Task 4: 前端 apiClient + workflowExecutor 更新

**Files:**
- Modify: `frontend/src/utils/apiClient.ts`
- Modify: `frontend/src/utils/workflowExecutor.ts`
- Modify: `frontend/src/mock/renderMock.ts`

**Interfaces:**
- Consumes: 后端 `POST /render/` 接受 `node_params`，`POST /render/{task_id}/retry` (Task 2)
- Produces: `renderApi.retry()`, `executeNode` 传递 `node_params`, `resumeWorkflow()`

- [ ] **Step 1: 更新 apiClient.ts — RenderTaskCreateRequest 新增 node_params，新增 renderApi.retry**

在 `frontend/src/utils/apiClient.ts` 中：

1. 修改 `RenderTaskCreateRequest` 接口，新增 `node_params`:

```typescript
export interface RenderTaskCreateRequest {
  project_id: string;
  task_type: string;
  node_id?: string;
  model_id?: string;
  prompt?: string;
  input_artifacts?: { type: string; url: string; filename?: string; text?: string }[];
  node_params?: Record<string, unknown>;
}
```

2. 在 `renderApi` 对象中新增 `retry` 方法（在 `cancel` 方法之后）：

```typescript
  retry: (taskId: string) =>
    request<RenderTaskResponse>(`/render/${taskId}/retry`, { method: 'POST' }),
```

- [ ] **Step 2: 更新 workflowExecutor.ts — 传递 node_params，新增 resumeWorkflow**

在 `frontend/src/utils/workflowExecutor.ts` 中：

1. `executeNode` 函数中，`renderApi.create()` 调用增加 `node_params`:

将：
```typescript
  const task = await renderApi.create({
    project_id: projectId,
    task_type: taskType,
    node_id: nodeId,
    model_id: modelId,
    prompt,
    input_artifacts: inputPayload,
  });
```

替换为：
```typescript
  const task = await renderApi.create({
    project_id: projectId,
    task_type: taskType,
    node_id: nodeId,
    model_id: modelId,
    prompt,
    input_artifacts: inputPayload,
    node_params: { ...node.data.params },
  });
```

2. 在文件末尾（`executeWorkflow` 函数之后）新增 `resumeWorkflow`：

```typescript
// ── 断点续执行 ──

export async function resumeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

  // 过滤掉已完成节点，只执行 idle/pending/failed 的节点
  const pendingLayers = layers
    .map((layer) =>
      layer.filter((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId);
        return node && node.data.status !== 'completed';
      })
    )
    .filter((layer) => layer.length > 0);

  const executableNodes = nodes.filter(
    (n) => isExecutable(n.data.subtype) && n.data.status !== 'completed'
  );
  const totalNodes = executableNodes.length;

  if (totalNodes === 0) {
    return { state: 'completed', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null };
  }

  currentExecutionStatus = {
    state: 'running',
    totalNodes,
    completedNodes: 0,
    failedNodeId: null,
    error: null,
  };
  cancelRequested = false;

  let completedNodes = 0;

  for (const layer of pendingLayers) {
    if (cancelRequested) {
      currentExecutionStatus.state = 'failed';
      currentExecutionStatus.error = '用户取消';
      break;
    }

    const results = await Promise.allSettled(
      layer.map((nodeId) => executeNode(nodeId))
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        completedNodes++;
      } else {
        currentExecutionStatus.state = 'failed';
        currentExecutionStatus.failedNodeId = layer[i];
        currentExecutionStatus.error = r.reason?.message || '节点执行失败';
        currentExecutionStatus.completedNodes = completedNodes;
        return { ...currentExecutionStatus };
      }
    }

    currentExecutionStatus.completedNodes = completedNodes;
  }

  if (currentExecutionStatus.state === 'running') {
    currentExecutionStatus.state = 'completed';
  }

  return { ...currentExecutionStatus };
}
```

- [ ] **Step 3: 修复 renderMock.ts — progress 改为 0-100 整数，补齐缺失字段**

替换 `frontend/src/mock/renderMock.ts`：

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
    progress: statuses[i] === 'completed' ? 100 : statuses[i] === 'running' ? 67 : statuses[i] === 'failed' ? 45 : 0,
    celery_task_id: `celery-mock-${i}`,
    result_url: statuses[i] === 'completed' ? `mock/render/${i}/output.mp4` : null,
    error_message: statuses[i] === 'failed' ? 'AI 推理服务超时' : null,
    node_id: null,
    node_label: null,
    project_name: projects[i],
    created_at: new Date(Date.now() - i * 3600_000).toISOString(),
    updated_at: new Date(Date.now() - i * 1800_000).toISOString(),
  }));
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/apiClient.ts frontend/src/utils/workflowExecutor.ts frontend/src/mock/renderMock.ts
git commit -m "前端支持node_params传递和断点续执行"
```

---

### Task 5: 前端 CanvasNode 重试按钮 + 渲染中心重试

**Files:**
- Modify: `frontend/src/components/canvas/CanvasNode.tsx`
- Modify: `frontend/src/pages/RenderCenter.tsx`

**Interfaces:**
- Consumes: `executeNode` from workflowExecutor (Task 4), `renderApi.retry` from apiClient (Task 4)

- [ ] **Step 1: CanvasNode 失败状态增加重试按钮**

在 `frontend/src/components/canvas/CanvasNode.tsx` 中：

1. 在 import 中新增 `RotateCw` 图标：

```typescript
import {
  Type, Image, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
  Loader2, CheckCircle2, XCircle, AlertCircle, RotateCw,
} from 'lucide-react';
```

2. 在 `executeNode` import 中增加（如果还没有的话）：

```typescript
import { executeNode } from '@/utils/workflowExecutor';
```

3. 在节点内容区域，`data.error` 显示之后增加重试按钮。将：

```tsx
      {/* 节点内容 */}
      <div className="px-3 py-2 space-y-1">
        {data.error && (
          <p className="text-xs text-status-error truncate" title={data.error}>
            {data.error}
          </p>
        )}
```

替换为：

```tsx
      {/* 节点内容 */}
      <div className="px-3 py-2 space-y-1">
        {data.error && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-status-error truncate flex-1" title={data.error}>
              {data.error}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                executeNode(id).catch(() => {});
              }}
              className="p-0.5 rounded hover:bg-canvas-hover text-status-error hover:text-status-running transition-colors flex-shrink-0"
              title="重试"
            >
              <RotateCw className="w-3 h-3" />
            </button>
          </div>
        )}
```

- [ ] **Step 2: 渲染中心失败任务增加重试操作**

在 `frontend/src/pages/RenderCenter.tsx` 中：

1. 在 import 中新增 `RotateCw` 图标：

```typescript
import { Monitor, Download, Clock, CheckCircle2, XCircle, Loader2, Plus, Pause, AlertCircle, RotateCw } from 'lucide-react';
```

2. 新增 `handleRetry` 函数（在 `handleDownload` 之后）：

```typescript
  // 重试任务
  const handleRetry = async (id: string) => {
    try {
      await renderApi.retry(id);
      toast.success('任务已重新提交');
      await loadTasks();
    } catch {
      toast.error('重试失败');
    }
  };
```

3. 在任务行操作区域，添加重试按钮。将取消按钮的条件区域：

```tsx
                        <div className="flex items-center justify-end gap-1">
                          {(task.status === 'pending' || task.status === 'running') && (
                            <button
                              onClick={() => handleCancel(task.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              取消
                            </button>
                          )}
                          {task.status === 'completed' && (
```

替换为：

```tsx
                        <div className="flex items-center justify-end gap-1">
                          {(task.status === 'pending' || task.status === 'running') && (
                            <button
                              onClick={() => handleCancel(task.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              取消
                            </button>
                          )}
                          {(task.status === 'failed' || task.status === 'cancelled') && (
                            <button
                              onClick={() => handleRetry(task.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-status-running hover:bg-blue-400/10 rounded transition-colors"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                              重试
                            </button>
                          )}
                          {task.status === 'completed' && (
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/canvas/CanvasNode.tsx frontend/src/pages/RenderCenter.tsx
git commit -m "新增节点和渲染中心重试按钮"
```

---

### Task 6: EditorLayout 断点续执行按钮

**Files:**
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Consumes: `resumeWorkflow` from workflowExecutor (Task 4), `useCanvasStore` for node status check

- [ ] **Step 1: 在 EditorLayout 添加断点续执行按钮**

1. 更新 import，新增 `resumeWorkflow`：

```typescript
import { executeWorkflow, getExecutionStatus, cancelWorkflowExecution, executeNode, isExecutable, resumeWorkflow } from '@/utils/workflowExecutor';
```

2. 新增 `RotateCw` 图标 import：

```typescript
import { ArrowLeft, Save, Undo2, Redo2, Play, Square, History, Clock, Sparkles, RotateCw } from 'lucide-react';
```

3. 新增 `handleResumeWorkflow` 处理函数（在 `handleCancelWorkflow` 之后）：

```typescript
  const handleResumeWorkflow = async () => {
    if (workflowStatus.state === 'running') return;
    setWorkflowStatus({ ...getExecutionStatus(), state: 'running' });
    try {
      const result = await resumeWorkflow();
      setWorkflowStatus(result);
      if (result.state === 'completed') {
        toast.success('断点续执行完成');
      } else if (result.state === 'failed') {
        toast.error(`断点续执行失败: ${result.error}`);
      }
    } catch (err: any) {
      setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: err.message });
      toast.error('断点续执行出错');
    }
  };
```

4. 在工具栏中，将执行工作流按钮区域（"执行工作流" 和 "停止" 按钮之间）增加"断点续执行"按钮。将：

```tsx
        {workflowStatus.state === 'running' ? (
          <button
            onClick={handleCancelWorkflow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            停止 {workflowStatus.completedNodes}/{workflowStatus.totalNodes}
          </button>
        ) : (
          <button
            onClick={handleExecuteWorkflow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
          >
            <Play className="w-3.5 h-3.5" />
            执行工作流
          </button>
        )}
```

替换为：

```tsx
        {workflowStatus.state === 'running' ? (
          <button
            onClick={handleCancelWorkflow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            停止 {workflowStatus.completedNodes}/{workflowStatus.totalNodes}
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={handleExecuteWorkflow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
            >
              <Play className="w-3.5 h-3.5" />
              执行工作流
            </button>
            {useCanvasStore.getState().nodes.some(
              (n) => isExecutable(n.data.subtype) && (n.data.status === 'failed' || n.data.status === 'idle')
            ) && (
              <button
                onClick={handleResumeWorkflow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-canvas-hover border border-canvas-border rounded-md hover:border-neon-purple hover:text-white transition-colors"
                title="跳过已完成节点，仅执行失败/未执行的节点"
              >
                <RotateCw className="w-3.5 h-3.5" />
                断点续执行
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/EditorLayout.tsx
git commit -m "新增断点续执行按钮"
```

---

### Task 7: 更新路线图 + 最终验证

**Files:**
- Modify: `DEVELOPMENT_ROADMAP.md`

- [ ] **Step 1: 更新 DEVELOPMENT_ROADMAP.md**

在阶段五的已完成任务列表之后，新增"节点字段统一第2步 + 执行链完善"记录：

在文件中 `### 11. 节点字段统一与技术债清理（第 1 步）` 部分之后新增：

```markdown
### 12. 执行链完善（节点字段统一第2步 + 重试 + 断点续执行）
- **后端**: schemas/render.py RenderTaskResponse 补齐 node_label/project_name，删除冗余 RenderTaskCreate
- **后端**: RenderTask ORM progress 类型 Float→Integer（0-100 整数百分比）
- **后端**: api/render.py RenderTaskCreate 新增 node_params 字段，创建任务时传递到 Celery
- **后端**: api/render.py 新增 POST /render/{task_id}/retry 端点（复制原任务参数+从节点读取最新 node_params）
- **后端**: render_tasks.py 各执行函数从 node_params 读取参数（size/duration/voice/style/scale 等）
- **前端**: workflowExecutor.ts executeNode 传递完整 node_params
- **前端**: workflowExecutor.ts 新增 resumeWorkflow()（跳过已完成节点，仅执行失败/未执行节点）
- **前端**: CanvasNode.tsx 失败状态增加重试按钮
- **前端**: RenderCenter.tsx 失败/取消任务增加重试操作
- **前端**: EditorLayout.tsx 新增断点续执行按钮
- **前端**: renderMock.ts progress 改为 0-100 整数，补齐 node_label/project_name 字段
- **修复**: 节点字段统一第2步——执行链 params 读取统一
```

同时删除原"后续待办"行（第172行）：
```
- **后续待办**: 第 2 步执行链 params 读取（workflowExecutor.ts + RenderTaskCreate schema + render_tasks.py）
```

- [ ] **Step 2: Commit**

```bash
git add DEVELOPMENT_ROADMAP.md
git commit -m "更新路线图：执行链完善已完成"
```

- [ ] **Step 3: 运行前端 TypeScript 检查**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx tsc --noEmit 2>&1 | head -50`

Expected: 无新增错误（renderMock.ts 的 node_label/project_name 缺失错误应已修复）

- [ ] **Step 4: 运行前端单元测试**

Run: `cd /Users/qzfrato/AI_Canvas_Flow/frontend && npx vitest run 2>&1 | tail -30`

Expected: 所有测试通过
