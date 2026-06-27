# 画布节点触发渲染任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将渲染中心的后端能力集成到工作流画布中，支持单节点执行和全工作流拓扑编排

**Architecture:** 前端驱动编排——前端做拓扑排序，逐节点调 render API，轮询状态更新画布节点，上游输出传给下游输入。后端扩展 render API 支持 node_id/input_artifacts，新增 AI 默认模型端点，Celery 任务按 task_type 路由。

**Tech Stack:** FastAPI + SQLAlchemy async + Celery + React + Zustand + TypeScript

## Global Constraints

- 前端必须使用 Vite + React 18 + TypeScript
- 所有 API 数据必须持久化到 PostgreSQL；禁止内存存储
- Celery 5.x + RabbitMQ 4.x 兼容：队列必须 durable=True，worker 启动需要 `--without-mingle --without-gossip --without-heartbeat`
- AI 模型必须从 `ai_models` 数据库表获取，不得硬编码
- 前端 API 客户端使用 `apiClient.ts` 中的 `request()` 封装，相对路径 + Vite proxy
- Alembic 迁移脚本必须通过 `alembic revision --autogenerate` 生成

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| Modify | `backend/app/models/render_task.py` | 新增 `node_id` 列 |
| Create | `backend/alembic/versions/xxxx_add_node_id_to_render_tasks.py` | 数据库迁移 |
| Modify | `backend/app/api/render.py` | 扩展 schema + `_task_to_dict` + create 逻辑 |
| Modify | `backend/app/api/ai.py` | 新增 `GET /models/default` 端点 |
| Modify | `backend/app/tasks/render_tasks.py` | 扩展 `run_render_task` 参数 + task_type 路由 |
| Modify | `frontend/src/utils/apiClient.ts` | 扩展 `RenderTaskCreateRequest` + `aiApi.getDefaultModel()` |
| Create | `frontend/src/utils/workflowExecutor.ts` | 工作流编排引擎（拓扑排序 + 单节点执行 + 全工作流执行） |
| Modify | `frontend/src/stores/canvasStore.ts` | 新增 `setNodeOutput()` 方法 |
| Modify | `frontend/src/pages/Editor.tsx` | PropertyPanelWithHistory 替换模拟执行 + AI 模型选择器 |
| Modify | `frontend/src/components/EditorLayout.tsx` | "执行工作流"按钮绑定编排引擎 |

---

### Task 1: 后端 — render_tasks 表新增 node_id 列 + 迁移

**Files:**
- Modify: `backend/app/models/render_task.py`
- Create: `backend/alembic/versions/xxxx_add_node_id_to_render_tasks.py`

**Interfaces:**
- Produces: `RenderTask.node_id` (String(36), nullable)

- [ ] **Step 1: 修改 RenderTask 模型，新增 node_id 列**

在 `backend/app/models/render_task.py` 的 `RenderTask` 类中，在 `error_message` 之后添加：

```python
    node_id: Mapped[str | None] = mapped_column(String(36))  # 关联的画布节点 ID
```

- [ ] **Step 2: 生成 Alembic 迁移**

Run:
```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "add node_id to render_tasks"
```

- [ ] **Step 3: 执行迁移**

Run:
```bash
cd backend && .venv/bin/alembic upgrade head
```

Expected: 迁移成功，无报错

- [ ] **Step 4: 验证**

Run:
```bash
cd backend && .venv/bin/python -c "from app.models.render_task import RenderTask; print(RenderTask.node_id)"
```

Expected: 输出 `RenderTask.node_id` 属性信息

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/render_task.py backend/alembic/versions/
git commit -m "feat: add node_id column to render_tasks table"
```

---

### Task 2: 后端 — 扩展 render API + 新增默认模型端点

**Files:**
- Modify: `backend/app/api/render.py`
- Modify: `backend/app/api/ai.py`

**Interfaces:**
- Consumes: `RenderTask.node_id` (from Task 1)
- Produces: `POST /render/` 接受 `node_id` + `input_artifacts` 参数；`GET /ai/models/default` 返回默认 AiModel

- [ ] **Step 1: 扩展 RenderTaskCreate schema + create_render_task + _task_to_dict**

修改 `backend/app/api/render.py`：

1. 扩展 `RenderTaskCreate`：

```python
class RenderTaskCreate(BaseModel):
    project_id: str
    task_type: str = "render"
    output_format: str = "mp4"
    model_id: str | None = None
    prompt: str | None = None
    node_id: str | None = None           # 关联的画布节点 ID
    input_artifacts: list[dict] | None = None  # 上游输出资产
```

2. 在 `_task_to_dict` 中新增 `node_id` 字段：

```python
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
        "node_id": task.node_id,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }
```

3. 在 `create_render_task` 中写入 `node_id`：

在 `task = RenderTask(...)` 构造中添加 `node_id=body.node_id`：

```python
    task = RenderTask(
        project_id=uuid.UUID(body.project_id),
        owner_id=uuid.UUID(user),
        task_type=body.task_type,
        status="pending",
        progress=0.0,
        node_id=body.node_id,
    )
```

4. 扩展 `run_render_task.delay()` 调用，传入 `input_artifacts`：

```python
    celery_result = run_render_task.delay(
        str(task.id),
        model_id=body.model_id,
        prompt=body.prompt,
        input_artifacts=body.input_artifacts,
    )
```

- [ ] **Step 2: 在 ai.py 新增 GET /models/default 端点**

在 `backend/app/api/ai.py` 的 Model CRUD 区域之后（`delete_model` 之后）添加：

```python
@router.get("/models/default", summary="获取默认 AI 模型")
async def get_default_model(db: DBSession, user: CurrentUser):
    """返回当前用户第一个 active 的 AI Model"""
    stmt = (
        select(AiModel)
        .where(AiModel.is_active == True)
        .join(AiProvider, AiModel.provider_id == AiProvider.id)
        .where(AiProvider.is_active == True)
        .order_by(AiModel.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=404, detail="未找到可用的 AI 模型，请先在设置页配置")
    return _model_to_dict(model)
```

- [ ] **Step 3: 验证 API**

Run:
```bash
cd backend && .venv/bin/python -c "
import requests
BASE = 'http://localhost:8000/api/v1'
r = requests.post(f'{BASE}/auth/login', json={'username': 'e2e_test', 'password': 'test123'})
token = r.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

# 测试默认模型端点
r = requests.get(f'{BASE}/ai/models/default', headers=headers)
print(f'Default model: {r.status_code}', r.json() if r.status_code == 200 else r.text[:200])

# 测试带 node_id 的创建
r = requests.get(f'{BASE}/projects/', headers=headers)
project_id = r.json()[0]['id']
r = requests.post(f'{BASE}/render/', headers=headers, json={
    'project_id': project_id,
    'task_type': 'render',
    'node_id': 'node-test-123',
    'input_artifacts': [{'type': 'text', 'url': 'test://input'}],
})
print(f'Create with node_id: {r.status_code}', 'node_id' in r.json() and r.json()['node_id'] == 'node-test-123')
"
```

Expected: default model 返回 200 + 模型数据；创建任务返回带 node_id 的响应

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/render.py backend/app/api/ai.py
git commit -m "feat: extend render API with node_id/input_artifacts, add GET /ai/models/default"
```

---

### Task 3: 后端 — Celery 任务支持 task_type 路由和 input_artifacts

**Files:**
- Modify: `backend/app/tasks/render_tasks.py`

**Interfaces:**
- Consumes: `run_render_task` 新增 `input_artifacts` 和 `node_id` 参数
- Produces: Celery 任务根据 `task_type` 前缀路由到 `_execute_ai_task` 或 `_execute_render_task`

- [ ] **Step 1: 修改 run_render_task 签名和路由逻辑**

修改 `backend/app/tasks/render_tasks.py`，替换 `run_render_task` 函数为：

```python
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
    try:
        # 读取任务类型决定路由
        from app.database import async_session_factory
        from sqlalchemy import select
        from app.models.render_task import RenderTask
        import uuid as _uuid

        task_type = _run_async(_get_task_type(task_id))

        if task_type and task_type.startswith("ai_"):
            result = _run_async(
                _execute_ai_task(task_id, model_id, prompt, input_artifacts)
            )
        else:
            result = _run_async(
                _execute_render_task(task_id, input_artifacts)
            )
        return result

    except Exception as e:
        logger.error(f"[Render:Task] 任务 {task_id} 失败: {e}", exc_info=True)
        try:
            _run_async(_mark_failed(task_id, str(e)[:500]))
        except Exception:
            logger.error(f"[Render:Task] 标记失败也失败: {task_id}")
        return {"task_id": task_id, "status": "failed", "error": str(e)}
```

- [ ] **Step 2: 新增 _get_task_type 辅助函数**

在 `render_tasks.py` 的 `_update_task` 之后添加：

```python
async def _get_task_type(task_id: str) -> str | None:
    """从数据库读取任务的 task_type"""
    from app.database import async_session_factory
    from sqlalchemy import select
    from app.models.render_task import RenderTask
    import uuid

    async with async_session_factory() as db:
        result = await db.execute(
            select(RenderTask.task_type).where(RenderTask.id == uuid.UUID(task_id))
        )
        row = result.scalar_one_or_none()
        return row
```

- [ ] **Step 3: 修改 _execute_ai_task 支持 input_artifacts**

替换 `_execute_ai_task` 函数为：

```python
async def _execute_ai_task(
    task_id: str, model_id: str, prompt: str, input_artifacts: list[dict] | None = None
) -> dict:
    """执行 AI 推理任务"""
    from app.database import async_session_factory
    from app.services.ai_service import call_llm

    async with async_session_factory() as db:
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
```

- [ ] **Step 4: 修改 _execute_render_task 支持 input_artifacts**

替换 `_execute_render_task` 函数为：

```python
async def _execute_render_task(
    task_id: str, input_artifacts: list[dict] | None = None
) -> dict:
    """执行默认渲染任务（模拟进度）"""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        await _update_task(db, task_id, status="running", progress=0.0)

        for progress in [0.2, 0.4, 0.6, 0.8, 1.0]:
            time.sleep(2)
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
```

- [ ] **Step 5: 验证 Celery 任务路由**

重启 Celery worker，然后测试两种路由：

```bash
cd backend && .venv/bin/python -c "
from app.tasks.render_tasks import run_render_task

# 测试 render 类型（非 ai_ 前缀）
r1 = run_render_task.apply_async(args=['test-render-route'], kwargs={'task_type': 'render'})
print(f'Render task: {r1.id}')

# 测试 ai_ 类型
r2 = run_render_task.apply_async(args=['test-ai-route'], kwargs={'model_id': None, 'prompt': 'hello', 'task_type': 'ai_text2img'})
print(f'AI task: {r2.id}')
"
```

Expected: 两个任务都成功派发（不需要等结果，只要无报错即可）

- [ ] **Step 6: Commit**

```bash
git add backend/app/tasks/render_tasks.py
git commit -m "feat: Celery task routing by task_type prefix, support input_artifacts"
```

---

### Task 4: 前端 — 扩展 apiClient + canvasStore

**Files:**
- Modify: `frontend/src/utils/apiClient.ts`
- Modify: `frontend/src/stores/canvasStore.ts`

**Interfaces:**
- Consumes: `GET /ai/models/default`, `POST /render/` 新参数
- Produces: `RenderTaskCreateRequest` 扩展字段；`aiApi.getDefaultModel()`；`canvasStore.setNodeOutput()`

- [ ] **Step 1: 扩展 RenderTaskCreateRequest + RenderTaskResponse + renderApi.create**

修改 `frontend/src/utils/apiClient.ts`：

1. 替换 `RenderTaskCreateRequest`：

```typescript
export interface RenderTaskCreateRequest {
  project_id: string;
  task_type: string;
  node_id?: string;
  model_id?: string;
  prompt?: string;
  input_artifacts?: { type: string; url: string; text?: string }[];
}
```

2. 在 `RenderTaskResponse` 中新增 `node_id`：

在 `error_message` 之后添加：
```typescript
  node_id: string | null;
```

3. 替换 `renderApi.create`：

```typescript
  create: (data: RenderTaskCreateRequest) =>
    request<RenderTaskResponse>('/render/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
```

4. 在 `aiApi` 中新增 `getDefaultModel`：

在 `aiApi.models` 对象的 `delete` 方法之后添加：

```typescript
    getDefault: () =>
      request<AiModelResponse>('/ai/models/default'),
```

5. 在 `aiApi` 中新增 `listModels` 便捷方法（在 `models` 对象之后添加一个顶级方法）：

在 `aiApi` 对象的闭合大括号之前添加：

```typescript
  /** 获取默认 AI 模型 */
  getDefaultModel: () => request<AiModelResponse>('/ai/models/default'),
```

- [ ] **Step 2: canvasStore 新增 setNodeOutput 方法**

修改 `frontend/src/stores/canvasStore.ts`：

1. 在 `CanvasState` 接口中 `setNodeError` 之后添加：

```typescript
  setNodeOutput: (id: string, artifacts: import('@/types/canvas').Artifact[]) => void;
```

2. 在 store 实现中 `setNodeError` 之后添加：

```typescript
  setNodeOutput: (id, artifacts) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, outputArtifacts: artifacts } }
          : n
      ),
    }));
  },
```

- [ ] **Step 3: 验证编译**

Run:
```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/apiClient.ts frontend/src/stores/canvasStore.ts
git commit -m "feat: extend apiClient and canvasStore for node execution"
```

---

### Task 5: 前端 — 创建 workflowExecutor.ts 编排引擎

**Files:**
- Create: `frontend/src/utils/workflowExecutor.ts`

**Interfaces:**
- Consumes: `canvasStore` (nodes/edges/setNodeStatus/setNodeOutput/setNodeError), `renderApi.create/get/poll`, `aiApi.getDefaultModel`, `useProjectStore` (currentProjectId)
- Produces: `workflowExecutor` 单例，提供 `executeNode()` 和 `executeWorkflow()` 方法

- [ ] **Step 1: 创建 workflowExecutor.ts**

创建 `frontend/src/utils/workflowExecutor.ts`：

```typescript
/**
 * 工作流编排引擎
 *
 * 支持：
 * - 单节点执行：读取节点参数 + 上游输出 → 调 render API → 轮询状态 → 更新画布
 * - 全工作流编排：拓扑排序 → 按层并行执行 → 任一失败停止
 */

import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { renderApi, aiApi } from '@/utils/apiClient';
import type { CanvasNode, CanvasEdge, NodeSubtype, Artifact } from '@/types/canvas';
import type { RenderTaskResponse } from '@/utils/apiClient';

// ── 节点可执行性判定 ──

const EXECUTABLE_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_video', 'text_to_speech',
  'upscale', 'style_transfer', 'remove_bg', 'extend_image',
  'video_output', 'image_output', 'audio_output',
]);

const AI_SUBTYPES: Set<string> = new Set([
  'text_to_image', 'image_to_video', 'text_to_speech',
]);

/** 节点 subtype → 后端 task_type 映射 */
function getTaskType(subtype: NodeSubtype): string {
  if (subtype === 'text_to_image') return 'ai_text2img';
  if (subtype === 'image_to_video') return 'ai_img2video';
  if (subtype === 'text_to_speech') return 'ai_tts';
  return 'render';
}

/** 是否可执行 */
export function isExecutable(subtype: NodeSubtype): boolean {
  return EXECUTABLE_SUBTYPES.has(subtype);
}

/** 是否需要 AI 模型 */
function needsAiModel(subtype: NodeSubtype): boolean {
  return AI_SUBTYPES.has(subtype);
}

// ── 收集上游输出 ──

function collectUpstreamArtifacts(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]): Artifact[] {
  const artifacts: Artifact[] = [];
  // 找到指向此节点的所有边
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = nodes.find((n) => n.id === edge.source);
    if (sourceNode?.data.outputArtifacts) {
      artifacts.push(...sourceNode.data.outputArtifacts);
    }
  }
  return artifacts;
}

// ── 单节点执行 ──

/**
 * 执行单个画布节点
 *
 * @returns 成功返回 RenderTaskResponse，失败抛出 Error
 */
export async function executeNode(nodeId: string): Promise<RenderTaskResponse> {
  const { nodes, edges } = useCanvasStore.getState();
  const node = nodes.find((n) => n.id === nodeId);

  if (!node) throw new Error('节点不存在');
  if (!isExecutable(node.data.subtype)) throw new Error('该节点无需执行');

  const projectId = useProjectStore.getState().currentProject?.id;
  if (!projectId) throw new Error('未选择项目');

  // 1. 确定任务类型
  const taskType = getTaskType(node.data.subtype);

  // 2. 收集参数
  let modelId: string | undefined;
  let prompt: string | undefined;

  if (needsAiModel(node.data.subtype)) {
    // 优先从节点参数取 model_id
    modelId = node.data.params.model_id as string | undefined;
    if (!modelId) {
      try {
        const defaultModel = await aiApi.getDefaultModel();
        modelId = defaultModel.id;
      } catch {
        throw new Error('请先在设置页配置 AI 模型');
      }
    }
    // prompt 优先取 params.prompt / params.text
    prompt = (node.data.params.prompt as string) || (node.data.params.text as string) || undefined;
  }

  // 3. 收集上游输出
  const inputArtifacts = collectUpstreamArtifacts(nodeId, nodes, edges);
  const inputPayload = inputArtifacts.length > 0
    ? inputArtifacts.map((a) => ({ type: a.type, url: a.url, filename: a.filename }))
    : undefined;

  // 4. 设置节点为 pending
  useCanvasStore.getState().setNodeStatus(nodeId, 'pending', 0);

  // 5. 创建渲染任务
  const task = await renderApi.create({
    project_id: projectId,
    task_type: taskType,
    node_id: nodeId,
    model_id: modelId,
    prompt,
    input_artifacts: inputPayload,
  });

  // 6. 更新为 running
  useCanvasStore.getState().setNodeStatus(nodeId, 'running', 0);

  // 7. 轮询直到完成
  try {
    const result = await renderApi.poll(task.id, 2000, (progress, status) => {
      // progress 是 0.0~1.0，前端 CanvasNodeData.progress 是 0~100
      useCanvasStore.getState().setNodeStatus(nodeId, status as any, Math.round(progress * 100));
    });

    // 8. 完成后设置输出
    const artifacts: Artifact[] = result.result_url
      ? [{
          id: `artifact-${Date.now()}`,
          type: taskType.startsWith('ai_text2img') ? 'image'
            : taskType.startsWith('ai_img2video') ? 'video'
            : taskType.startsWith('ai_tts') ? 'audio'
            : 'video',
          url: result.result_url,
          filename: result.result_url.split('/').pop() || 'output',
          size: 0,
        }]
      : [];

    useCanvasStore.getState().setNodeOutput(nodeId, artifacts);
    useCanvasStore.getState().setNodeStatus(nodeId, 'completed', 100);

    return result;
  } catch (err: any) {
    useCanvasStore.getState().setNodeError(nodeId, err?.message || '执行失败');
    throw err;
  }
}

// ── 拓扑排序 ──

function topologicalSort(nodes: CanvasNode[], edges: CanvasEdge[]): string[][] {
  /** 返回按层分组的节点 ID 列表 */
  const executableIds = new Set(
    nodes.filter((n) => isExecutable(n.data.subtype)).map((n) => n.id)
  );

  // 构建入度表（仅可执行节点）
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>(); // source → Set<target>

  for (const id of executableIds) {
    inDegree.set(id, 0);
    adjacency.set(id, new Set());
  }

  for (const edge of edges) {
    if (executableIds.has(edge.source) && executableIds.has(edge.target)) {
      adjacency.get(edge.source)!.add(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  // Kahn 算法按层分组
  const layers: string[][] = [];
  let queue = [...executableIds].filter((id) => (inDegree.get(id) || 0) === 0);

  while (queue.length > 0) {
    layers.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const target of adjacency.get(id) || []) {
        const deg = (inDegree.get(target) || 1) - 1;
        inDegree.set(target, deg);
        if (deg === 0) nextQueue.push(target);
      }
    }
    queue = nextQueue;
  }

  return layers;
}

// ── 全工作流编排 ──

export interface WorkflowExecutionStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  totalNodes: number;
  completedNodes: number;
  failedNodeId: string | null;
  error: string | null;
}

let currentExecutionStatus: WorkflowExecutionStatus = {
  state: 'idle',
  totalNodes: 0,
  completedNodes: 0,
  failedNodeId: null,
  error: null,
};

let cancelRequested = false;

export function getExecutionStatus(): WorkflowExecutionStatus {
  return { ...currentExecutionStatus };
}

export function cancelWorkflowExecution(): void {
  cancelRequested = true;
}

/**
 * 执行整个工作流（按拓扑层并行）
 */
export async function executeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

  const executableNodes = nodes.filter((n) => isExecutable(n.data.subtype));
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

  for (const layer of layers) {
    if (cancelRequested) {
      currentExecutionStatus.state = 'failed';
      currentExecutionStatus.error = '用户取消';
      break;
    }

    // 同层并行执行
    const results = await Promise.allSettled(
      layer.map((nodeId) => executeNode(nodeId))
    );

    // 检查结果
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        completedNodes++;
      } else {
        // 任一失败 → 停止后续层
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

- [ ] **Step 2: 验证编译**

Run:
```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/workflowExecutor.ts
git commit -m "feat: add workflowExecutor with single-node and full-workflow execution"
```

---

### Task 6: 前端 — Editor.tsx 属性面板替换模拟执行 + AI 模型选择器

**Files:**
- Modify: `frontend/src/pages/Editor.tsx`

**Interfaces:**
- Consumes: `workflowExecutor.executeNode()`, `aiApi.models.list()`, `aiApi.getDefaultModel()`
- Produces: 真实单节点执行 + AI 模型下拉选择器

- [ ] **Step 1: 在 Editor.tsx 中替换 PropertyPanelWithHistory**

在 `PropertyPanelWithHistory` 组件中，需要以下修改：

1. 在文件顶部 import 区域添加：

```typescript
import { executeNode, isExecutable } from '@/utils/workflowExecutor';
import { aiApi } from '@/utils/apiClient';
import type { AiModelResponse } from '@/utils/apiClient';
```

2. 在 `PropertyPanelWithHistory` 函数体内，`const data = selectedNode.data;` 之后，添加状态和逻辑：

在 `const data = selectedNode.data;` 之后添加：

```typescript
  const [executing, setExecuting] = useState(false);
  const [aiModels, setAiModels] = useState<AiModelResponse[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
```

3. 在 `handleParamChange` 函数之后添加执行处理函数：

```typescript
  const handleExecute = async () => {
    if (executing) return;
    setExecuting(true);
    try {
      await executeNode(selectedNode.id);
    } catch (err: any) {
      // 错误已在 workflowExecutor 中处理
    } finally {
      setExecuting(false);
    }
  };

  // AI 模型加载
  const loadAiModels = async () => {
    if (aiModels.length > 0) return;
    setLoadingModels(true);
    try {
      const models = await aiApi.models.list();
      setAiModels(models);
    } catch {
      // 静默失败
    } finally {
      setLoadingModels(false);
    }
  };
```

4. 在参数编辑区 (`Object.entries(data.params).map(...)`) 之后，AI 推理节点显示模型选择器：

在参数循环闭合 `</div>` 之后，属性面板的 `flex-1 overflow-y-auto` div 内添加：

```tsx
        {/* AI 模型选择器 — 仅 AI 推理节点显示 */}
        {data.type === 'ai_inference' && (
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">AI 模型</label>
            <select
              value={(data.params.model_id as string) || ''}
              onFocus={loadAiModels}
              onChange={(e) => handleParamChange('model_id', e.target.value || undefined)}
              className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
            >
              <option value="">自动选择（默认模型）</option>
              {loadingModels && <option disabled>加载中...</option>}
              {aiModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} ({m.model_id})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 节点状态显示 */}
        {data.status !== 'idle' && (
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">状态</label>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                data.status === 'running' ? 'bg-blue-400 animate-pulse' :
                data.status === 'completed' ? 'bg-green-400' :
                data.status === 'failed' ? 'bg-red-400' :
                'bg-yellow-400'
              }`} />
              <span className="text-sm text-slate-300 capitalize">{data.status}</span>
              {data.status === 'running' && (
                <span className="text-xs text-slate-400">{data.progress}%</span>
              )}
            </div>
            {data.status === 'running' && (
              <div className="w-full bg-canvas-bg rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-neon-purple to-neon-blue h-1.5 rounded-full transition-all"
                  style={{ width: `${data.progress}%` }}
                />
              </div>
            )}
            {data.outputArtifacts.length > 0 && (
              <div className="mt-1 text-xs text-slate-400">
                输出: {data.outputArtifacts.length} 个资产
              </div>
            )}
            {data.error && (
              <div className="text-xs text-red-400 mt-1">{data.error}</div>
            )}
          </div>
        )}
```

5. 替换底部操作区，添加"执行节点"按钮：

替换 `<div className="p-3 border-t border-canvas-border">` 的内容为：

```tsx
      <div className="p-3 border-t border-canvas-border space-y-2">
        {isExecutable(data.subtype) && (
          <button
            onClick={handleExecute}
            disabled={executing || data.status === 'running'}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing || data.status === 'running' ? '执行中...' : '执行节点'}
          </button>
        )}
        <button
          onClick={() => onRemoveNode(selectedNode.id)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10 rounded-md transition-colors"
        >
          删除节点
        </button>
      </div>
```

6. 确保 `useState` 已从 React 导入。在文件顶部的 React 导入中添加 `useState`（如果尚未导入）。

- [ ] **Step 2: 验证编译**

Run:
```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Editor.tsx
git commit -m "feat: replace mock execution with real API, add AI model selector to property panel"
```

---

### Task 7: 前端 — EditorLayout "执行工作流"按钮绑定编排引擎

**Files:**
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Consumes: `workflowExecutor.executeWorkflow()`, `getExecutionStatus()`, `cancelWorkflowExecution()`

- [ ] **Step 1: 修改 EditorLayout.tsx**

1. 在文件顶部 import 区域添加：

```typescript
import { executeWorkflow, getExecutionStatus, cancelWorkflowExecution } from '@/utils/workflowExecutor';
import type { WorkflowExecutionStatus } from '@/utils/workflowExecutor';
```

2. 在 `EditorLayout` 函数组件内部（在 `const` 声明区域），添加编排状态：

```typescript
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowExecutionStatus>({ state: 'idle', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null });
```

3. 添加执行/取消处理函数：

```typescript
  const handleExecuteWorkflow = async () => {
    if (workflowStatus.state === 'running') return;
    setWorkflowStatus({ ...getExecutionStatus(), state: 'running' });
    try {
      const result = await executeWorkflow();
      setWorkflowStatus(result);
      if (result.state === 'completed') {
        toast.success('工作流执行完成');
      } else if (result.state === 'failed') {
        toast.error(`工作流执行失败: ${result.error}`);
      }
    } catch (err: any) {
      setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: err.message });
      toast.error('工作流执行出错');
    }
  };

  const handleCancelWorkflow = () => {
    cancelWorkflowExecution();
    setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: '用户取消' });
  };
```

4. 替换"执行工作流"按钮：

找到：
```tsx
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity">
          <Play className="w-3.5 h-3.5" />
          执行工作流
        </button>
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
          <button
            onClick={handleExecuteWorkflow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity"
          >
            <Play className="w-3.5 h-3.5" />
            执行工作流
          </button>
        )}
```

5. 在 import 中确保 `Square` 图标已从 lucide-react 导入（如未导入则添加）：

```typescript
import { ArrowLeft, Save, Undo2, Redo2, Play, Clock, Square } from 'lucide-react';
```

- [ ] **Step 2: 验证编译**

Run:
```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/EditorLayout.tsx
git commit -m "feat: bind executeWorkflow to toolbar button with progress display"
```

---

### Task 8: 端到端联调验证

**Files:** 无新增/修改

- [ ] **Step 1: 重启所有服务**

```bash
# 清理旧进程
pkill -9 -f "celery.*app.tasks" 2>/dev/null
cd backend && find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null

# 启动 Celery worker
cd backend && .venv/bin/python -m celery -A app.tasks.celery_app worker --loglevel=info --pool=solo --without-mingle --without-gossip --without-heartbeat &

# 确认后端运行
curl http://localhost:8000/api/v1/auth/me -H "Authorization: Bearer test" 2>/dev/null | head -1

# 前端
cd frontend && npm run dev &
```

- [ ] **Step 2: 浏览器测试单节点执行**

1. 打开画布编辑器（打开一个项目）
2. 拖入 `text_input` + `text_to_image` 节点，连线
3. 点击 `text_to_image` 节点
4. 在属性面板点击"执行节点"
5. 验证：节点状态从 pending → running → completed，进度条实时更新
6. 验证：完成后属性面板显示"输出: 1 个资产"

- [ ] **Step 3: 浏览器测试全工作流执行**

1. 在画布上拖入: `text_input` → `text_to_image` → `image_output`
2. 连线: text_input → text_to_image → image_output
3. 点击顶部"执行工作流"按钮
4. 验证：按钮变为"停止 0/3"，节点按拓扑顺序执行
5. 验证：text_to_image 先完成，image_output 后完成
6. 验证：完成后按钮恢复"执行工作流"，Toast 提示"工作流执行完成"

- [ ] **Step 4: 测试 AI 模型选择器**

1. 点击 AI 推理节点
2. 验证属性面板显示"AI 模型"下拉框
3. 点击下拉框，验证能列出设置页配置的模型
4. 选择一个模型，执行节点
5. 验证 Celery worker 日志显示使用了选定的模型

- [ ] **Step 5: 检查 Celery worker 日志**

确认 worker 日志中：
- `run_render_task` 被 `Task received`
- `Task succeeded` 出现
- 无 `ImportError` 或其他异常

- [ ] **Step 6: Commit (如有修复)**

```bash
git add -A
git commit -m "fix: e2e testing adjustments for canvas node execution"
```
