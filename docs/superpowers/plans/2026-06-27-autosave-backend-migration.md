# 编辑器自动保存后端化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将编辑器自动保存（autoSaveStore）从 localStorage 切换到 PostgreSQL 后端，实现跨设备一致、崩溃恢复可靠的快照体系。保留现有 2s 操作防抖 + 30s 定时双防抖策略与 5 快照上限。

**Architecture:** 快照与实际状态分离——自动保存仅向 `project_snapshots` 表追加 JSONB 快照，不修改实际 nodes/edges；手动保存仍走 `workflowApi.save()`；崩溃恢复时调专用 `POST /snapshots/{id}/restore` 端点，单事务内替换 nodes/edges 并刷新 `project.updated_at`。

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + PostgreSQL JSONB + React + Zustand + TypeScript

## Global Constraints

- 前端必须使用 Vite + React 18 + TypeScript
- 所有 API 数据必须持久化到 PostgreSQL；禁止内存存储（含 localStorage）
- 快照表 `project_snapshots` 通过外键 `ON DELETE CASCADE` 跟随 projects 删除
- 仅 `source='auto'` 的快照受 5 条上限约束；`source='manual'` 快照不计数
- 自动保存路径只写快照表；手动保存路径 `saveCurrentProject()` 逻辑不变
- 前端 API 客户端使用 `apiClient.ts` 中的 `request()` 封装，相对路径 + Vite proxy
- Alembic 迁移脚本基于 `19c11929fcbb` 之后的 revision
- 撤销/重做 historyStore 不对接后端（保持内存态）

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| Create | `backend/app/models/project_snapshot.py` | ProjectSnapshot ORM 模型 |
| Modify | `backend/app/models/__init__.py` | 导出 ProjectSnapshot |
| Create | `backend/alembic/versions/xxxx_add_project_snapshots_table.py` | 数据库迁移脚本 |
| Create | `backend/app/schemas/snapshot.py` | 快照 Pydantic schemas |
| Create | `backend/app/api/snapshots.py` | 快照 CRUD + restore 路由 |
| Modify | `backend/app/api/router.py` | 挂载 snapshots 路由 |
| Modify | `frontend/src/utils/apiClient.ts` | 新增 `SnapshotResponse` 类型 + `snapshotApi` |
| Modify | `frontend/src/stores/autoSaveStore.ts` | 移除 localStorage，改为 async 调后端 |
| Modify | `frontend/src/stores/projectStore.ts` | `loadProjectToCanvas` 加载快照列表 |

---

### Task 1: 后端 — 创建 ProjectSnapshot 模型 + Alembic 迁移

**Files:**
- Create: `backend/app/models/project_snapshot.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/xxxx_add_project_snapshots_table.py`

**Interfaces:**
- Produces: `ProjectSnapshot` ORM 模型，字段 `id: UUID / project_id: UUID (FK CASCADE) / owner_id: UUID / snapshot_data: JSONB / source: str(16) / label: str(128) | None / created_at: datetime`，索引 `(project_id, source, created_at DESC)` + `owner_id`

- [ ] **Step 1: 创建 ProjectSnapshot ORM 模型**

写入 `backend/app/models/project_snapshot.py`：

```python
"""ProjectSnapshot ORM 模型"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProjectSnapshot(Base):
    """项目快照：用于自动保存与崩溃恢复

    - source='auto'：受 5 条上限约束（插入前清理最旧）
    - source='manual'：命名快照，不计数
    """

    __tablename__ = "project_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE")
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    snapshot_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source: Mapped[str] = mapped_column(String(16))  # auto / manual
    label: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    __table_args__ = (
        Index(
            "ix_project_snapshots_project_source_created",
            "project_id",
            "source",
            text("created_at DESC"),
        ),
        Index("ix_project_snapshots_owner_id", "owner_id"),
    )
```

- [ ] **Step 2: 在 models/__init__.py 中导出 ProjectSnapshot**

修改 `backend/app/models/__init__.py`，在导入列表末尾（`WorkflowEdge, WorkflowNode` 之后）添加 ProjectSnapshot 导入，并扩展 `__all__`：

```python
"""ORM 模型包"""

from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel
from app.models.media_asset import MediaAsset
from app.models.project import Project
from app.models.project_snapshot import ProjectSnapshot
from app.models.render_task import RenderTask
from app.models.user import User
from app.models.workflow import WorkflowEdge, WorkflowNode

__all__ = [
    "User",
    "Project",
    "ProjectSnapshot",
    "WorkflowNode",
    "WorkflowEdge",
    "MediaAsset",
    "RenderTask",
    "AiProvider",
    "AiModel",
]
```

- [ ] **Step 3: 生成 Alembic 迁移**

Run:
```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "add project_snapshots table"
```

Expected: 在 `backend/alembic/versions/` 下生成新迁移文件，文件头部 `down_revision` 指向 `19c11929fcbb`（当前 head）

- [ ] **Step 4: 检查迁移脚本内容**

打开新生成的迁移文件，确认 `upgrade()` 包含：
- `op.create_table('project_snapshots', ...)` 含 id/project_id/owner_id/snapshot_data/source/label/created_at 列
- snapshot_data 列类型为 `sa.dialects.postgresql.JSONB(astext_type=sa.Text())` 且 `nullable=False`
- project_id 列含 `sa.ForeignKey('projects.id', ondelete='CASCADE')`
- source 列为 `sa.String(length=16)` 且 `nullable=False`
- `op.create_index('ix_project_snapshots_project_source_created', ...)` 含 project_id, source, created_at
- `op.create_index('ix_project_snapshots_owner_id', ...)`

若 autogenerate 漏掉 `ondelete='CASCADE'` 或索引 DESC 排序，手动修正后再 upgrade。

- [ ] **Step 5: 执行迁移**

Run:
```bash
cd backend && .venv/bin/alembic upgrade head
```

Expected: 输出 `Running upgrade 19c11929fcbb -> <new_rev>, add project_snapshots table`

- [ ] **Step 6: 验证表结构**

Run:
```bash
cd backend && .venv/bin/python -c "
from app.models.project_snapshot import ProjectSnapshot
print('Table:', ProjectSnapshot.__tablename__)
print('Columns:', [c.name for c in ProjectSnapshot.__table__.columns])
print('Indexes:', [i.name for i in ProjectSnapshot.__table__.indexes])
"
```

Expected: 输出包含 `snapshot_data`、`source`、`label` 字段以及 `ix_project_snapshots_project_source_created`、`ix_project_snapshots_owner_id` 索引

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/project_snapshot.py backend/app/models/__init__.py backend/alembic/versions/
git commit -m "feat: add project_snapshots table for autosave backend migration"
```

---

### Task 2: 后端 — 创建快照 Pydantic Schemas

**Files:**
- Create: `backend/app/schemas/snapshot.py`

**Interfaces:**
- Produces:
  - `SnapshotCreate` schema: `source: Literal['auto', 'manual'] / label: str | None / snapshot_data: dict`
  - `SnapshotResponse` schema: `id: UUID / project_id: UUID / owner_id: UUID / source: str / label: str | None / snapshot_data: dict / created_at: datetime`
  - `SnapshotRestoreResponse` schema: `restored: bool / project_id: UUID / nodes_count: int / edges_count: int`

- [ ] **Step 1: 创建 schemas/snapshot.py**

写入 `backend/app/schemas/snapshot.py`：

```python
"""快照 schema"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class SnapshotCreate(BaseModel):
    """创建快照请求"""
    source: Literal["auto", "manual"]
    label: str | None = None
    snapshot_data: dict  # {nodes: [...], edges: [...], timelineData: {...}}


class SnapshotResponse(BaseModel):
    """快照响应"""
    id: UUID
    project_id: UUID
    owner_id: UUID
    source: str
    label: str | None
    snapshot_data: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class SnapshotRestoreResponse(BaseModel):
    """恢复快照响应"""
    restored: bool
    project_id: UUID
    nodes_count: int
    edges_count: int
```

- [ ] **Step 2: 验证 import**

Run:
```bash
cd backend && .venv/bin/python -c "
from app.schemas.snapshot import SnapshotCreate, SnapshotResponse, SnapshotRestoreResponse
s = SnapshotCreate(source='auto', snapshot_data={'nodes': [], 'edges': []})
print('Schema OK:', s.model_dump())
"
```

Expected: 输出 `Schema OK: {'source': 'auto', 'label': None, 'snapshot_data': {'nodes': [], 'edges': []}}`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/snapshot.py
git commit -m "feat: add snapshot pydantic schemas"
```

---

### Task 3: 后端 — 创建快照 CRUD + restore API 路由

**Files:**
- Create: `backend/app/api/snapshots.py`

**Interfaces:**
- Consumes:
  - `ProjectSnapshot` 模型（from Task 1）
  - `SnapshotCreate / SnapshotResponse / SnapshotRestoreResponse` schemas（from Task 2）
  - `Project / WorkflowNode / WorkflowEdge` 模型
  - `DBSession / CurrentUser` 依赖
- Produces:
  - `POST /projects/{project_id}/snapshots` — 创建快照（含 5 auto 上限清理）
  - `GET /projects/{project_id}/snapshots` — 列表（可选 `?source=auto|manual`）
  - `GET /projects/{project_id}/snapshots/latest` — 获取最新快照
  - `GET /snapshots/{snapshot_id}` — 详情
  - `DELETE /snapshots/{snapshot_id}` — 删除
  - `POST /snapshots/{snapshot_id}/restore` — 单事务恢复（替换 nodes/edges + 刷新 project.updated_at）

- [ ] **Step 1: 创建 snapshots.py 路由文件**

写入 `backend/app/api/snapshots.py`：

```python
"""快照 CRUD + 恢复路由"""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, select

from app.deps import CurrentUser, DBSession
from app.models.project import Project
from app.models.project_snapshot import ProjectSnapshot
from app.models.workflow import WorkflowEdge, WorkflowNode
from app.schemas.snapshot import (
    SnapshotCreate,
    SnapshotRestoreResponse,
    SnapshotResponse,
)

logger = logging.getLogger("app.api.snapshots")

router = APIRouter()

AUTOSAVE_LIMIT = 5


def _to_uuid(value: str, field: str = "ID") -> uuid.UUID:
    """字符串转 UUID，失败抛 400"""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"无效的{field}格式")


def _to_response(s: ProjectSnapshot) -> SnapshotResponse:
    """ORM 对象转响应"""
    return SnapshotResponse(
        id=s.id,
        project_id=s.project_id,
        owner_id=s.owner_id,
        source=s.source,
        label=s.label,
        snapshot_data=s.snapshot_data,
        created_at=s.created_at,
    )


async def _verify_project_owner(
    project_id: str, user_id: str, db
) -> Project:
    """验证项目存在且属于当前用户"""
    pid = _to_uuid(project_id, "项目 ID")
    result = await db.execute(select(Project).where(Project.id == pid))
    project = result.scalar_one_or_none()
    if not project or str(project.owner_id) != user_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


# ── 项目级端点 ──


@router.post(
    "/projects/{project_id}/snapshots",
    response_model=SnapshotResponse,
    summary="创建快照",
)
async def create_snapshot(
    project_id: str,
    body: SnapshotCreate,
    user: CurrentUser,
    db: DBSession,
):
    """创建快照（自动 source='auto' 时受 5 条上限约束）"""
    project = await _verify_project_owner(project_id, user, db)
    pid = project.id
    owner_id = uuid.UUID(user)

    # auto 快照上限：>=5 则删除最旧
    if body.source == "auto":
        existing = await db.execute(
            select(ProjectSnapshot)
            .where(
                ProjectSnapshot.project_id == pid,
                ProjectSnapshot.source == "auto",
            )
            .order_by(ProjectSnapshot.created_at.desc())
        )
        auto_snapshots = existing.scalars().all()
        if len(auto_snapshots) >= AUTOSAVE_LIMIT:
            # 删除最旧的（列表按 created_at DESC 排序，最后一条最旧）
            oldest = auto_snapshots[-1]
            await db.delete(oldest)
            logger.info(
                f"[Snapshot:Create] 清理最旧 auto 快照 id={oldest.id}"
            )

    snapshot = ProjectSnapshot(
        project_id=pid,
        owner_id=owner_id,
        snapshot_data=body.snapshot_data,
        source=body.source,
        label=body.label,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)
    logger.info(
        f"[Snapshot:Create] id={snapshot.id} project={project_id} "
        f"source={body.source} label={body.label}"
    )
    return _to_response(snapshot)


@router.get(
    "/projects/{project_id}/snapshots",
    response_model=list[SnapshotResponse],
    summary="获取快照列表",
)
async def list_snapshots(
    project_id: str,
    user: CurrentUser,
    db: DBSession,
    source: str | None = Query(None, description="按 source 筛选: auto / manual"),
):
    """获取项目快照列表（按 created_at DESC 排序）"""
    await _verify_project_owner(project_id, user, db)
    pid = _to_uuid(project_id, "项目 ID")
    stmt = select(ProjectSnapshot).where(ProjectSnapshot.project_id == pid)
    if source:
        stmt = stmt.where(ProjectSnapshot.source == source)
    stmt = stmt.order_by(ProjectSnapshot.created_at.desc())
    result = await db.execute(stmt)
    return [_to_response(s) for s in result.scalars().all()]


@router.get(
    "/projects/{project_id}/snapshots/latest",
    response_model=SnapshotResponse,
    summary="获取最新快照",
)
async def get_latest_snapshot(
    project_id: str,
    user: CurrentUser,
    db: DBSession,
):
    """获取项目最新一条快照（不限 source），无则 404"""
    await _verify_project_owner(project_id, user, db)
    pid = _to_uuid(project_id, "项目 ID")
    result = await db.execute(
        select(ProjectSnapshot)
        .where(ProjectSnapshot.project_id == pid)
        .order_by(ProjectSnapshot.created_at.desc())
        .limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="无快照")
    return _to_response(snapshot)


# ── 快照级端点 ──


async def _get_owned_snapshot(
    snapshot_id: str, user_id: str, db
) -> ProjectSnapshot:
    """获取快照并校验所属用户"""
    sid = _to_uuid(snapshot_id, "快照 ID")
    result = await db.execute(
        select(ProjectSnapshot).where(ProjectSnapshot.id == sid)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot or str(snapshot.owner_id) != user_id:
        raise HTTPException(status_code=404, detail="快照不存在")
    return snapshot


@router.get(
    "/snapshots/{snapshot_id}",
    response_model=SnapshotResponse,
    summary="获取快照详情",
)
async def get_snapshot(snapshot_id: str, user: CurrentUser, db: DBSession):
    """获取指定快照详情"""
    snapshot = await _get_owned_snapshot(snapshot_id, user, db)
    return _to_response(snapshot)


@router.delete(
    "/snapshots/{snapshot_id}",
    status_code=204,
    summary="删除快照",
)
async def delete_snapshot(snapshot_id: str, user: CurrentUser, db: DBSession):
    """删除指定快照"""
    snapshot = await _get_owned_snapshot(snapshot_id, user, db)
    await db.delete(snapshot)
    await db.commit()
    logger.info(f"[Snapshot:Delete] id={snapshot_id}")


@router.post(
    "/snapshots/{snapshot_id}/restore",
    response_model=SnapshotRestoreResponse,
    summary="恢复快照",
)
async def restore_snapshot(
    snapshot_id: str, user: CurrentUser, db: DBSession
):
    """恢复快照到实际 nodes/edges（单事务）

    1. 校验快照属于当前用户
    2. 读取 snapshot_data
    3. 删除项目现有 nodes/edges
    4. 从 snapshot_data 插入新 nodes/edges
    5. 刷新 project.updated_at
    6. 提交事务
    """
    snapshot = await _get_owned_snapshot(snapshot_id, user, db)
    data = snapshot.snapshot_data or {}
    nodes_data = data.get("nodes", [])
    edges_data = data.get("edges", [])
    pid = snapshot.project_id

    # 1. 删除旧数据：先边后节点（外键约束）
    await db.execute(
        delete(WorkflowEdge).where(WorkflowEdge.project_id == pid)
    )
    await db.execute(
        delete(WorkflowNode).where(WorkflowNode.project_id == pid)
    )

    # 2. 插入新节点
    for node_data in nodes_data:
        node = WorkflowNode(
            id=node_data["id"],
            project_id=pid,
            node_type=node_data.get("node_type") or node_data.get("type", "input"),
            label=node_data.get("label"),
            position_x=node_data.get("position_x", node_data.get("position", {}).get("x", 0)),
            position_y=node_data.get("position_y", node_data.get("position", {}).get("y", 0)),
            config=node_data.get("config") or node_data.get("data"),
        )
        db.add(node)

    # flush 确保节点先写入，避免外键冲突
    await db.flush()

    # 3. 插入新边
    for edge_data in edges_data:
        edge = WorkflowEdge(
            id=edge_data["id"],
            project_id=pid,
            source_node_id=edge_data.get("source_node_id") or edge_data["source"],
            target_node_id=edge_data.get("target_node_id") or edge_data["target"],
            source_port=edge_data.get("source_port") or edge_data.get("sourceHandle"),
            target_port=edge_data.get("target_port") or edge_data.get("targetHandle"),
        )
        db.add(edge)

    # 4. 刷新 project.updated_at
    project_result = await db.execute(
        select(Project).where(Project.id == pid)
    )
    project = project_result.scalar_one_or_none()
    if project:
        project.updated_at = datetime.utcnow()

    await db.commit()
    logger.info(
        f"[Snapshot:Restore] id={snapshot_id} project={pid} "
        f"nodes={len(nodes_data)} edges={len(edges_data)}"
    )
    return SnapshotRestoreResponse(
        restored=True,
        project_id=pid,
        nodes_count=len(nodes_data),
        edges_count=len(edges_data),
    )
```

- [ ] **Step 2: 验证 import 无错**

Run:
```bash
cd backend && .venv/bin/python -c "from app.api.snapshots import router; print('Routes:', [r.path for r in router.routes])"
```

Expected: 输出 6 个路由路径：
- `/projects/{project_id}/snapshots`
- `/projects/{project_id}/snapshots/latest`
- `/projects/{project_id}/snapshots`
- `/snapshots/{snapshot_id}`
- `/snapshots/{snapshot_id}`
- `/snapshots/{snapshot_id}/restore`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/snapshots.py
git commit -m "feat: add snapshot CRUD + restore API routes"
```

---

### Task 4: 后端 — 挂载 snapshots 路由 + 端到端 curl 验证

**Files:**
- Modify: `backend/app/api/router.py`

**Interfaces:**
- Consumes: `app.api.snapshots.router`（from Task 3）
- Produces: `/api/v1/projects/{project_id}/snapshots*` 与 `/api/v1/snapshots/*` 端点对外可用

- [ ] **Step 1: 修改 router.py 挂载 snapshots 路由**

修改 `backend/app/api/router.py`，在 import 列表添加 `from app.api.snapshots import router as snapshots_router`，并在 `api_router.include_router` 调用块末尾（ai_router 之后）添加挂载：

```python
"""汇总所有子路由，统一 /api/v1 前缀"""

from fastapi import APIRouter

from app.api.ai import router as ai_router
from app.api.auth import router as auth_router
from app.api.collaboration import router as collaboration_router
from app.api.media import router as media_router
from app.api.projects import router as projects_router
from app.api.render import router as render_router
from app.api.snapshots import router as snapshots_router
from app.api.workflows import router as workflows_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth_router, prefix="/auth", tags=["认证"])
api_router.include_router(projects_router, prefix="/projects", tags=["项目"])
api_router.include_router(workflows_router, prefix="/workflows", tags=["工作流"])
api_router.include_router(media_router, prefix="/media", tags=["媒体资产"])
api_router.include_router(render_router, prefix="/render", tags=["渲染任务"])
api_router.include_router(collaboration_router, prefix="/collab", tags=["协作"])
api_router.include_router(ai_router, prefix="/ai", tags=["ai"])
# snapshots_router 含完整路径前缀（/projects/{id}/snapshots + /snapshots/{id}），不加 prefix
api_router.include_router(snapshots_router, tags=["快照"])
```

- [ ] **Step 2: 启动后端服务**

Run:
```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Expected: 应用启动无报错，日志中可见 6 个 snapshots 路由已注册

- [ ] **Step 3: 登录获取 Token**

Run（替换为实际账号）:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"你的用户名","password":"你的密码"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Token: $TOKEN"
```

Expected: 输出 Token 字符串

- [ ] **Step 4: 创建测试项目并保存 Token/ProjectId**

Run:
```bash
PROJECT_ID=$(curl -s -X POST http://localhost:8000/api/v1/projects/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"快照测试项目"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "ProjectId: $PROJECT_ID"
```

Expected: 输出项目 UUID

- [ ] **Step 5: 创建 auto 快照**

Run:
```bash
curl -s -X POST http://localhost:8000/api/v1/projects/$PROJECT_ID/snapshots \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "source":"auto",
    "snapshot_data":{
      "nodes":[{"id":"n1","node_type":"input","label":"文本","position_x":100,"position_y":200,"config":{"type":"input"}}],
      "edges":[],
      "timelineData":{"duration":30,"tracks":[],"currentTime":0,"zoom":1}
    }
  }' | python3 -m json.tool
```

Expected: 返回 200 + 快照对象，含 `id` / `project_id` / `source: auto` / `snapshot_data` / `created_at`

- [ ] **Step 6: 测试 5 auto 上限 — 连续创建 6 个 auto 快照**

Run:
```bash
for i in 2 3 4 5 6; do
  curl -s -X POST http://localhost:8000/api/v1/projects/$PROJECT_ID/snapshots \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"source\":\"auto\",\"snapshot_data\":{\"nodes\":[],\"edges\":[],\"timelineData\":{}}}" > /dev/null
done
# 查询列表
curl -s "http://localhost:8000/api/v1/projects/$PROJECT_ID/snapshots?source=auto" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'auto 快照数: {len(d)}')"
```

Expected: 输出 `auto 快照数: 5`（最旧的已被清理）

- [ ] **Step 7: 测试 latest 端点**

Run:
```bash
curl -s http://localhost:8000/api/v1/projects/$PROJECT_ID/snapshots/latest \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'latest source={d[\"source\"]} created_at={d[\"created_at\"]}')"
```

Expected: 返回最新一条快照

- [ ] **Step 8: 测试 restore 端点**

Run:
```bash
LATEST_ID=$(curl -s http://localhost:8000/api/v1/projects/$PROJECT_ID/snapshots/latest \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s -X POST http://localhost:8000/api/v1/snapshots/$LATEST_ID/restore \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# 验证 nodes 已恢复
curl -s http://localhost:8000/api/v1/workflows/$PROJECT_ID/nodes \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'恢复后 nodes 数: {len(d)}')"
```

Expected: restore 返回 `restored: true`，nodes 数与快照中的节点数一致

- [ ] **Step 9: 测试 DELETE 端点**

Run:
```bash
SNAP_ID=$(curl -s "http://localhost:8000/api/v1/projects/$PROJECT_ID/snapshots?source=auto" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
curl -s -o /dev/null -w "DELETE status: %{http_code}\n" -X DELETE \
  http://localhost:8000/api/v1/snapshots/$SNAP_ID \
  -H "Authorization: Bearer $TOKEN"
```

Expected: 输出 `DELETE status: 204`

- [ ] **Step 10: 停止后端服务并 Commit**

停止 uvicorn（Ctrl+C 或 kill），然后：

```bash
git add backend/app/api/router.py
git commit -m "feat: mount snapshots router in api_router"
```

---

### Task 5: 前端 — apiClient 新增 SnapshotResponse 类型 + snapshotApi

**Files:**
- Modify: `frontend/src/utils/apiClient.ts`

**Interfaces:**
- Produces:
  - `SnapshotResponse` 类型（与后端 `SnapshotResponse` 对齐）
  - `SnapshotCreateRequest` 类型
  - `SnapshotRestoreResponse` 类型
  - `snapshotApi` 对象：`create / list / getLatest / get / delete / restore`

- [ ] **Step 1: 在 apiClient.ts 中新增 SnapshotResponse 类型**

打开 `frontend/src/utils/apiClient.ts`，在「AI Model」类型块之后（约 256 行后）添加快照相关类型：

```typescript
// ── 快照 ──

export interface SnapshotCreateRequest {
  source: 'auto' | 'manual';
  label?: string;
  snapshot_data: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    timelineData: TimelineData;
  };
}

export interface SnapshotResponse {
  id: string;
  project_id: string;
  owner_id: string;
  source: 'auto' | 'manual';
  label: string | null;
  snapshot_data: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    timelineData: TimelineData;
  };
  created_at: string;
}

export interface SnapshotRestoreResponse {
  restored: boolean;
  project_id: string;
  nodes_count: number;
  edges_count: number;
}
```

注意：需在文件顶部导入 `CanvasNode / CanvasEdge / TimelineData`。若已存在则跳过；若未导入则在 import 区域添加：

```typescript
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';
```

- [ ] **Step 2: 在 apiClient.ts 末尾新增 snapshotApi**

在文件末尾（`aiApi` 之后）添加：

```typescript
// ── 快照 ──

export const snapshotApi = {
  /** 创建快照 */
  create: (projectId: string, data: SnapshotCreateRequest) =>
    request<SnapshotResponse>(`/projects/${projectId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 获取快照列表（可选 source 筛选） */
  list: (projectId: string, source?: 'auto' | 'manual') =>
    request<SnapshotResponse[]>(
      `/projects/${projectId}/snapshots${source ? `?source=${source}` : ''}`,
    ),

  /** 获取最新快照（崩溃恢复检测用） */
  getLatest: (projectId: string) =>
    request<SnapshotResponse>(`/projects/${projectId}/snapshots/latest`),

  /** 获取快照详情 */
  get: (snapshotId: string) =>
    request<SnapshotResponse>(`/snapshots/${snapshotId}`),

  /** 删除快照 */
  delete: (snapshotId: string) =>
    request<void>(`/snapshots/${snapshotId}`, { method: 'DELETE' }),

  /** 恢复快照到实际 nodes/edges */
  restore: (snapshotId: string) =>
    request<SnapshotRestoreResponse>(`/snapshots/${snapshotId}/restore`, {
      method: 'POST',
    }),
};
```

- [ ] **Step 3: TypeScript 编译验证**

Run:
```bash
cd frontend && pnpm tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/apiClient.ts
git commit -m "feat: add SnapshotResponse type and snapshotApi in apiClient"
```

---

### Task 6: 前端 — 改造 autoSaveStore 为 async 调后端

**Files:**
- Modify: `frontend/src/stores/autoSaveStore.ts`

**Interfaces:**
- Consumes:
  - `snapshotApi`（from Task 5）
  - `SnapshotResponse` 类型
  - `useProjectStore.loadProjectToCanvas()`（用于恢复后刷新）
- Produces:
  - `saveNow()` / `checkRecovery()` / `restoreSnapshot()` / `discardRecovery()` / `clearSnapshots()` 改为 async
  - 移除所有 localStorage 调用与 `AUTOSAVE_KEY` 常量

- [ ] **Step 1: 完整覆写 autoSaveStore.ts**

用以下内容覆写 `frontend/src/stores/autoSaveStore.ts`：

```typescript
import { create } from 'zustand';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useHistoryStore } from './historyStore';
import { snapshotApi, type SnapshotResponse } from '@/utils/apiClient';

const SNAPSHOT_LIMIT = 5;
const AUTOSAVE_INTERVAL = 30_000; // 30秒
const DEBOUNCE_DELAY = 2_000; // 操作后2秒防抖保存

// 日志前缀
const LOG = '[AutoSave]';

interface AutoSaveState {
  snapshots: SnapshotResponse[];
  isDirty: boolean;
  lastSavedAt: number | null;
  intervalId: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  isSaving: boolean;
  recoverySnapshot: SnapshotResponse | null;
}

interface AutoSaveActions {
  setSnapshots: (snapshots: SnapshotResponse[]) => void;
  markDirty: () => void;
  markClean: () => void;
  saveNow: (source?: 'auto' | 'manual', label?: string) => Promise<void>;
  createNamedSnapshot: (label: string) => Promise<void>;
  startAutoSave: () => void;
  stopAutoSave: () => void;
  checkRecovery: () => Promise<SnapshotResponse | null>;
  restoreSnapshot: (snapshot: SnapshotResponse) => Promise<void>;
  discardRecovery: () => Promise<void>;
  clearSnapshots: () => Promise<void>;
}

type AutoSaveStore = AutoSaveState & AutoSaveActions;

function buildSnapshotData() {
  const canvasStore = useCanvasStore.getState();
  const timelineStore = useTimelineStore.getState();
  return {
    nodes: JSON.parse(JSON.stringify(canvasStore.nodes)) as CanvasNode[],
    edges: JSON.parse(JSON.stringify(canvasStore.edges)) as CanvasEdge[],
    timelineData: JSON.parse(JSON.stringify(timelineStore.data)) as TimelineData,
  };
}

export const useAutoSaveStore = create<AutoSaveStore>((set, get) => ({
  snapshots: [],
  isDirty: false,
  lastSavedAt: null,
  intervalId: null,
  debounceTimer: null,
  isSaving: false,
  recoverySnapshot: null,

  setSnapshots: (snapshots) => {
    set({ snapshots });
    console.log(`${LOG} 已加载快照列表: ${snapshots.length} 个`);
  },

  markDirty: () => {
    const prev = get().isDirty;
    set({ isDirty: true });

    if (!prev) {
      console.log(`${LOG} 标记为脏状态，启动防抖保存（${DEBOUNCE_DELAY}ms）`);
    }

    // 防抖保存：操作后 2 秒无新操作则保存
    const state = get();
    if (state.debounceTimer) clearTimeout(state.debounceTimer);

    const timer = setTimeout(() => {
      console.log(`${LOG} 防抖窗口结束，执行保存`);
      void get().saveNow('auto');
    }, DEBOUNCE_DELAY);

    set({ debounceTimer: timer });
  },

  markClean: () => {
    set({ isDirty: false, lastSavedAt: Date.now() });
  },

  saveNow: async (source = 'auto', label) => {
    const state = get();
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id;

    if (!projectId) {
      console.log(`${LOG} 无当前项目，跳过保存`);
      return;
    }
    if (state.isSaving) {
      console.warn(`${LOG} 保存正在进行中，跳过本次保存请求 [${source}]`);
      return;
    }

    console.log(`${LOG} 开始保存 [${source}]${label ? ` label="${label}"` : ''}`);
    set({ isSaving: true });

    try {
      const snapshotData = buildSnapshotData();
      const resp = await snapshotApi.create(projectId, {
        source,
        label,
        snapshot_data: snapshotData,
      });

      // 后端已处理 5 auto 上限，前端只需把新快照插入列表头部
      const newSnapshots = [resp, ...state.snapshots];
      // 仅对 auto 类型在前端做兜底裁剪（后端已清理，保持防御）
      const autoCount = newSnapshots.filter((s) => s.source === 'auto').length;
      let trimmed = newSnapshots;
      if (autoCount > SNAPSHOT_LIMIT) {
        // 移除最旧的 auto 快照（列表已按 created_at DESC 排序，从尾部找 auto）
        const lastAutoIdx = newSnapshots
          .map((s, i) => ({ s, i }))
          .filter((x) => x.s.source === 'auto')
          .pop()?.i;
        if (lastAutoIdx !== undefined) {
          trimmed = newSnapshots.filter((_, i) => i !== lastAutoIdx);
        }
      }

      set({
        snapshots: trimmed,
        isDirty: false,
        lastSavedAt: Date.now(),
        isSaving: false,
      });

      console.log(
        `${LOG} 保存完成 [${source}] id=${resp.id}, 当前快照数: ${trimmed.length}`,
      );
    } catch (err) {
      console.error(`${LOG} 保存失败:`, err);
      set({ isSaving: false });
    }
  },

  createNamedSnapshot: async (label) => {
    console.log(`${LOG} 创建命名快照: "${label}"`);
    await get().saveNow('manual', label);
  },

  startAutoSave: () => {
    const state = get();
    if (state.intervalId) {
      console.log(`${LOG} 自动保存已在运行中，跳过启动`);
      return;
    }

    console.log(`${LOG} 启动定时自动保存，间隔: ${AUTOSAVE_INTERVAL / 1000}s`);
    const id = setInterval(() => {
      const current = get();
      if (current.isDirty) {
        console.log(`${LOG} 定时器触发: 检测到脏状态，执行保存`);
        void current.saveNow('auto');
      }
    }, AUTOSAVE_INTERVAL);

    set({ intervalId: id });
  },

  stopAutoSave: () => {
    const state = get();
    console.log(`${LOG} 停止自动保存`);

    if (state.intervalId) {
      clearInterval(state.intervalId);
      set({ intervalId: null });
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      set({ debounceTimer: null });
    }
    // 停止前保存一次
    if (state.isDirty) {
      console.log(`${LOG} 停止前检测到脏状态，执行最后一次保存`);
      void get().saveNow('auto');
    }
  },

  checkRecovery: async () => {
    const projectStore = useProjectStore.getState();
    const currentProjectId = projectStore.currentProject?.id;

    console.log(`${LOG} 检查崩溃恢复: projectId=${currentProjectId || '(无)'}`);

    if (!currentProjectId) {
      console.log(`${LOG} 无当前项目，跳过恢复检测`);
      return null;
    }

    try {
      const latest = await snapshotApi.getLatest(currentProjectId);
      const project = projectStore.projects.find(
        (p) => p.id === currentProjectId,
      );

      if (project) {
        const snapshotTime = new Date(latest.created_at).getTime();
        const projectTime = new Date(project.updatedAt).getTime();
        if (snapshotTime > projectTime) {
          const timeDiff = snapshotTime - projectTime;
          console.log(
            `${LOG} 发现可恢复快照! 快照时间=${new Date(snapshotTime).toLocaleString('zh-CN')}, ` +
            `项目保存时间=${new Date(projectTime).toLocaleString('zh-CN')}, ` +
            `时间差=${(timeDiff / 1000).toFixed(0)}s`,
          );
          set({ recoverySnapshot: latest });
          return latest;
        }
      }

      console.log(`${LOG} 快照不晚于项目保存时间，无需恢复`);
      return null;
    } catch (err: unknown) {
      // 404 = 无快照，正常情况
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        console.log(`${LOG} 当前项目无快照，无需恢复`);
        return null;
      }
      console.error(`${LOG} 检查恢复失败:`, err);
      return null;
    }
  },

  restoreSnapshot: async (snapshot) => {
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id || snapshot.project_id;

    console.log(
      `${LOG} 恢复快照: id=${snapshot.id}, projectId=${projectId}`,
    );

    try {
      await snapshotApi.restore(snapshot.id);

      // 暂停 historyStore 录制，避免恢复操作被记录
      const historyStore = useHistoryStore;
      historyStore.getState().pauseRecording();

      // 重新加载实际 nodes/edges 到本地 stores
      await projectStore.loadProjectToCanvas(projectId);

      // 还原 timelineData（从快照数据中读取）
      const timelineStore = useTimelineStore.getState();
      timelineStore.loadTimeline(snapshot.snapshot_data.timelineData);

      historyStore.getState().resumeRecording();
      historyStore.getState().clearHistory();

      set({
        isDirty: false,
        lastSavedAt: Date.now(),
        recoverySnapshot: null,
      });

      console.log(`${LOG} 快照恢复完成，历史记录已清空`);
    } catch (err) {
      console.error(`${LOG} 恢复快照失败:`, err);
      throw err;
    }
  },

  discardRecovery: async () => {
    const state = get();
    console.log(`${LOG} 丢弃恢复快照`);
    if (state.recoverySnapshot) {
      try {
        await snapshotApi.delete(state.recoverySnapshot.id);
      } catch (err) {
        console.error(`${LOG} 删除恢复快照失败（静默）:`, err);
      }
    }
    set({ recoverySnapshot: null });
  },

  clearSnapshots: async () => {
    const state = get();
    const projectStore = useProjectStore.getState();
    const projectId = projectStore.currentProject?.id;
    console.log(`${LOG} 清理当前项目所有快照: projectId=${projectId || '(无)'}`);

    if (!projectId) {
      set({ snapshots: [], isDirty: false, recoverySnapshot: null });
      return;
    }

    // 遍历逐个删除（不新增批量端点，保持 API 简洁）
    for (const s of state.snapshots) {
      try {
        await snapshotApi.delete(s.id);
      } catch (err) {
        console.error(`${LOG} 删除快照失败 id=${s.id}:`, err);
      }
    }

    set({ snapshots: [], isDirty: false, recoverySnapshot: null });
  },
}));
```

- [ ] **Step 2: 检查调用方兼容性**

Run:
```bash
cd frontend && grep -rn "saveNow\|checkRecovery\|restoreSnapshot\|discardRecovery\|clearSnapshots\|createNamedSnapshot" src/ --include="*.tsx" --include="*.ts" | grep -v "autoSaveStore.ts"
```

Expected: 列出所有调用方。常见调用方：
- `Editor.tsx` / `EditorLayout.tsx` — 调用 `checkRecovery()` / `restoreSnapshot()` / `discardRecovery()`
- `Canvas.tsx` / `PropertyPanel.tsx` — 调用 `markDirty()`
- 任何 `saveNow(...)` 或 `clearSnapshots()` 调用方

对每个调用方：若其内部未 `await`，改为 `void xxxApi(...)` 调用或 `await xxxApi(...)`（视上下文而定）。事件处理器中可保持 `void` 形式（不阻塞 UI）。

- [ ] **Step 3: TypeScript 编译验证**

Run:
```bash
cd frontend && pnpm tsc --noEmit
```

Expected: 无类型错误。若有「`saveNow` 返回 Promise 但未 await」类警告，按 Step 2 提示修改调用方

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/autoSaveStore.ts frontend/src/components/ frontend/src/pages/
git commit -m "refactor: migrate autoSaveStore from localStorage to backend snapshotApi"
```

---

### Task 7: 前端 — projectStore.loadProjectToCanvas 加载快照列表

**Files:**
- Modify: `frontend/src/stores/projectStore.ts`

**Interfaces:**
- Consumes: `snapshotApi.list(projectId)`（from Task 5）+ `useAutoSaveStore.setSnapshots()`（from Task 6）
- Produces: `loadProjectToCanvas()` 返回 `boolean` 之前已填充 autoSaveStore.snapshots

- [ ] **Step 1: 修改 projectStore.ts 的 loadProjectToCanvas**

打开 `frontend/src/stores/projectStore.ts`，在文件顶部导入区添加 `snapshotApi`（若未导入）：

```typescript
import { projectApi, workflowApi, snapshotApi } from '@/utils/apiClient';
```

修改 `loadProjectToCanvas` 方法（约 193-210 行）：

```typescript
  loadProjectToCanvas: async (projectId) => {
    try {
      const { nodes, edges } = await workflowApi.loadWorkflow(projectId);
      const canvasNodes = nodes.map(toCanvasNode);
      const canvasEdges = edges.map(toCanvasEdge);

      const hasData = canvasNodes.length > 0 || canvasEdges.length > 0;
      if (hasData) {
        const canvasStore = useCanvasStore.getState();
        canvasStore.setNodes(canvasNodes);
        canvasStore.setEdges(canvasEdges);
      }

      // 加载项目快照列表，填充 autoSaveStore
      try {
        const snapshots = await snapshotApi.list(projectId);
        useAutoSaveStore.getState().setSnapshots(snapshots);
      } catch (err) {
        console.error('[ProjectStore] 加载快照列表失败:', err);
      }

      return hasData;
    } catch {
      return false;
    }
  },
```

- [ ] **Step 2: TypeScript 编译验证**

Run:
```bash
cd frontend && pnpm tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/projectStore.ts
git commit -m "feat: load snapshot list in projectStore.loadProjectToCanvas"
```

---

### Task 8: 端到端集成验证

**Files:**
- 验证用，不修改代码

**Interfaces:**
- Consumes: 全部前序任务产物

- [ ] **Step 1: 启动后端 + 前端**

终端 1:
```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

终端 2:
```bash
cd frontend && pnpm dev
```

Expected: 后端 8000、前端 5174 启动无报错

- [ ] **Step 2: 浏览器手动验证基础自动保存**

1. 访问 `http://localhost:5174`，登录
2. 创建/打开任意项目
3. 在画布上拖入节点，2 秒后查看浏览器 Network 面板，应看到 `POST /api/v1/projects/{id}/snapshots` 请求返回 200
4. 后端 curl 验证快照已落库：
```bash
curl -s "http://localhost:8000/api/v1/projects/<project_id>/snapshots?source=auto" \
  -H "Authorization: Bearer <token>" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'auto 快照数: {len(d)}')"
```
Expected: 快照数 ≥1

- [ ] **Step 3: 浏览器手动验证 5 auto 上限**

连续修改画布 6 次以上（每次拖动节点位置，间隔 > 2s），再次 curl 验证：
Expected: `auto 快照数: 5`（不超过上限）

- [ ] **Step 4: 浏览器手动验证崩溃恢复**

1. 在画布上做修改（触发 auto 保存）
2. 不点保存按钮，直接刷新浏览器
3. 重新打开同一项目，应弹出「恢复对话框」（如有 UI）或控制台输出 `[AutoSave] 发现可恢复快照!`
4. 点「恢复」→ 应触发 `POST /snapshots/{id}/restore`，画布刷新为快照内容
5. 点「丢弃」→ 应触发 `DELETE /snapshots/{id}`，刷新后不再提示

Expected: 恢复 / 丢弃流程均能正确执行

- [ ] **Step 5: 验证项目删除级联清理快照**

Run:
```bash
# 删除项目
curl -s -o /dev/null -w "DELETE project: %{http_code}\n" -X DELETE \
  http://localhost:8000/api/v1/projects/<project_id> \
  -H "Authorization: Bearer <token>"
# 查询该项目快照（应 404 项目不存在）
curl -s -o /dev/null -w "GET snapshots: %{http_code}\n" \
  "http://localhost:8000/api/v1/projects/<project_id>/snapshots" \
  -H "Authorization: Bearer <token>"
```

Expected: `DELETE project: 204` + `GET snapshots: 404`（项目删除后查询快照 404，因 project_id 不存在；若返回 404 项目不存在也符合）

- [ ] **Step 6: 全量 TypeScript 编译验证**

Run:
```bash
cd frontend && pnpm tsc --noEmit
```

Expected: 无错误

- [ ] **Step 7: 最终 Commit（如有验证中修复）**

```bash
git add -A
git commit -m "test: e2e verification for autosave backend migration" --allow-empty
```

---

## Self-Review

**1. Spec coverage（spec 对照检查）：**

| Spec 章节 | 对应 Task |
|-----------|-----------|
| 数据库新增表 `project_snapshots`（含索引 + 5 上限策略） | Task 1（表+索引+迁移）+ Task 3 Step 1（5 上限清理逻辑） |
| `POST /projects/{id}/snapshots` 创建快照 | Task 3 Step 1 |
| `GET /projects/{id}/snapshots` 列表（含 source 筛选） | Task 3 Step 1 |
| `GET /projects/{id}/snapshots/latest` 最新快照 | Task 3 Step 1 |
| `GET /snapshots/{id}` 详情 | Task 3 Step 1 |
| `DELETE /snapshots/{id}` 删除 | Task 3 Step 1 |
| `POST /snapshots/{id}/restore` 单事务恢复 | Task 3 Step 1 |
| 前端 `snapshotApi` 6 方法 | Task 5 Step 2 |
| `SnapshotResponse` 类型 | Task 5 Step 1 |
| `autoSaveStore` 移除 localStorage + async 化 | Task 6 Step 1 |
| `saveNow()` 改 async 调 `snapshotApi.create()` | Task 6 Step 1 |
| `checkRecovery()` 改 async 调 `getLatest()` | Task 6 Step 1 |
| `restoreSnapshot()` 调 `restore()` + 刷新本地 | Task 6 Step 1 |
| `discardRecovery()` 调 `delete()` | Task 6 Step 1 |
| `clearSnapshots()` 遍历调 `delete()` | Task 6 Step 1 |
| `projectStore.loadProjectToCanvas` 加载快照列表 | Task 7 Step 1 |
| 崩溃恢复流程端到端 | Task 8 Step 4 |
| 错误处理（save 失败 catch / getLatest 404 静默 / restore 失败 throw / delete 失败静默） | Task 6 Step 1 |
| 项目删除级联清理快照 | Task 1（ondelete=CASCADE）+ Task 8 Step 5 验证 |

无遗漏。

**2. Placeholder scan:**

- 所有代码块均为完整代码，无 "TODO" / "TBD"
- 所有命令均含 Expected 输出
- 所有引用的函数名/类型名在前后任务中保持一致：
  - `ProjectSnapshot`（Task 1）→ 被 Task 3 import 使用 ✓
  - `SnapshotCreate / SnapshotResponse / SnapshotRestoreResponse`（Task 2）→ 被 Task 3 import 使用 ✓
  - `snapshotApi.create / list / getLatest / get / delete / restore`（Task 5 定义）→ 被 Task 6 调用 ✓
  - `useAutoSaveStore.setSnapshots`（Task 6 定义）→ 被 Task 7 调用 ✓
  - `SnapshotResponse` 类型（Task 5 定义）→ 被 Task 6 用作 `recoverySnapshot` 类型 ✓

**3. Type consistency:**

- 后端 `SnapshotResponse.snapshot_data: dict` ↔ 前端 `SnapshotResponse.snapshot_data: { nodes, edges, timelineData }` — 一致（JSONB 在前端按结构化对象接收）
- 后端 `SnapshotResponse.id: UUID` ↔ 前端 `SnapshotResponse.id: string` — 一致（JSON 序列化为字符串）
- `restoreSnapshot` 接受 `SnapshotResponse` 而非旧的 `StateSnapshot`，已与 spec 对齐 ✓
- Task 6 中 `recoverySnapshot: SnapshotResponse | null`，`checkRecovery` 返回 `SnapshotResponse | null` ✓
- Task 3 restore 端点同时支持前端格式（`source`/`target`）和后端格式（`source_node_id`/`target_node_id`），兼容性好 ✓

无类型不一致问题。

---

## Execution Handoff

计划已完成并保存至 `docs/superpowers/plans/2026-06-27-autosave-backend-migration.md`。

**两种执行方式：**

**1. Subagent-Driven（推荐）** — 每个任务派遣新 subagent，任务间两阶段审查，迭代快

**2. Inline Execution** — 在当前会话执行任务，分批检查点审查

**请选择执行方式。**
