# 执行链完善设计文档

> 日期: 2026-07-03
> 状态: 待审核
> 范围: Schema 统一 + Params 完整传递 + 节点级重试 + 断点续执行

---

## 一、背景与问题

### 1.1 现状

项目阶段一至五全部完成。执行链路（前端 workflowExecutor → API → Celery 任务）可用，但存在以下问题：

| # | 问题 | 影响 |
|---|------|------|
| P1 | 后端 `schemas/render.py` 的 `RenderTaskCreate` 与 `api/render.py` 不一致 | schema 文件未被使用，维护混乱 |
| P2 | 节点 params 未完整传递到后端 | 处理节点(upscale/style_transfer等)的参数丢失，Celery 无法按参数执行 |
| P3 | `progress` 字段类型不统一（ORM 注释 0-1，实际运行 0-100） | 容易引入歧义 |
| P4 | 失败节点无法重试 | 只能手动重新执行整条链路 |
| P5 | 全工作流失败后无法断点续执行 | 已完成节点被重复执行 |

### 1.2 目标

1. 统一 Schema，消除冗余定义
2. 节点 params 完整传递到 Celery 任务，支持所有节点类型按参数执行
3. 新增节点级重试能力
4. 新增工作流断点续执行能力

---

## 二、方案 A — Schema 统一 + Params 完整传递

### 2.1 后端 Schema 合并

删除 `app/schemas/render.py` 中的 `RenderTaskCreate`（已无人使用），统一使用 `app/api/render.py` 中已有的定义，并扩展 `node_params` 字段：

```python
# app/api/render.py
class RenderTaskCreate(BaseModel):
    project_id: str
    task_type: str = "render"
    output_format: str = "mp4"
    model_id: str | None = None
    prompt: str | None = None
    node_id: str | None = None
    input_artifacts: list[dict] | None = None
    node_params: dict | None = None  # 新增：节点完整 params
```

同步更新 `app/schemas/render.py` 的 `RenderTaskResponse`，补齐缺失字段：

```python
# app/schemas/render.py
class RenderTaskResponse(BaseModel):
    id: UUID
    project_id: UUID
    owner_id: UUID
    task_type: str
    status: str
    progress: int  # 0-100 整数
    celery_task_id: str | None
    result_url: str | None
    error_message: str | None
    node_id: str | None
    node_label: str | None     # 新增
    project_name: str | None   # 新增
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

### 2.2 前端 RenderTaskCreateRequest 更新

```typescript
// apiClient.ts
export interface RenderTaskCreateRequest {
  project_id: string;
  task_type: string;
  node_id?: string;
  model_id?: string;
  prompt?: string;
  input_artifacts?: { type: string; url: string; filename?: string; text?: string }[];
  node_params?: Record<string, unknown>;  // 新增
}
```

### 2.3 workflowExecutor.ts 传递完整 params

`executeNode()` 调用 `renderApi.create()` 时增加 `node_params`：

```typescript
const task = await renderApi.create({
  project_id: projectId,
  task_type: taskType,
  node_id: nodeId,
  model_id: modelId,
  prompt,
  input_artifacts: inputPayload,
  node_params: { ...node.data.params },  // 传递完整 params
});
```

### 2.4 后端 Celery 任务读取 node_params

`run_render_task` 函数签名新增 `node_params` 参数，传递到 `_run_task` → 各 `_do_xxx` 函数：

```python
@celery_app.task(bind=True, name="run_render_task")
def run_render_task(
    self,
    task_id: str,
    model_id: str = None,
    prompt: str = None,
    node_id: str = None,
    input_artifacts: list[dict] | None = None,
    node_params: dict | None = None,  # 新增
) -> dict:
```

各执行函数按 task_type 读取对应 params：

| task_type | 读取字段 |
|-----------|---------|
| ai_text2img | `prompt`, `node_params.size` |
| ai_img2video | `prompt`, `node_params.duration` |
| ai_tts | `node_params.text`, `node_params.voice` |
| render (upscale) | `node_params.scale` |
| render (style_transfer) | `node_params.style` |
| render (remove_bg) | 无额外参数 |
| render (extend_image) | `node_params.direction` |
| render (image_output) | `node_params.format` |
| render (video_output) | `node_params.format` |
| render (audio_output) | `node_params.format` |

### 2.5 progress 统一为 0-100 整数

- ORM `RenderTask.progress` 类型改为 `Integer`（当前 Float 不影响功能，但语义更清晰）
- 所有 Celery 更新写入整数 0-100
- 前端 `RenderTaskResponse.progress` 类型改为 `number`（已兼容）

---

## 三、方案 B — 节点级重试

### 3.1 后端新增重试端点

```
POST /api/v1/render/{task_id}/retry
```

逻辑：
1. 查询原任务，验证状态为 `failed` 或 `cancelled`
2. 创建新 `RenderTask`，复制原任务的 `project_id`/`task_type`/`node_id`/`model_id`/`prompt`
3. 从关联节点的 `config.params` 读取 `node_params`（保证最新参数）
4. 触发 Celery 任务
5. 返回新任务

### 3.2 前端 CanvasNode 重试按钮

`CanvasNode.tsx` 失败状态节点增加重试图标按钮，点击调用 `executeNode(nodeId)`（复用现有执行逻辑）。

### 3.3 前端渲染中心重试操作

`RenderCenter.tsx` 失败任务行增加"重试"按钮，调用 `POST /render/{task_id}/retry`。

### 3.4 apiClient 扩展

```typescript
retry: (taskId: string) =>
  request<RenderTaskResponse>(`/render/${taskId}/retry`, { method: 'POST' }),
```

---

## 四、方案 C — 工作流断点续执行

### 4.1 核心逻辑

在 `workflowExecutor.ts` 新增 `resumeWorkflow()` 函数：

```typescript
export async function resumeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

  // 跳过已完成节点，只执行 idle/pending/failed 节点
  const pendingLayers = layers.map(layer =>
    layer.filter(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      return node && node.data.status !== 'completed';
    })
  ).filter(layer => layer.length > 0);

  // ... 与 executeWorkflow 相同的按层并行执行逻辑
}
```

### 4.2 EditorLayout 按钮

- `executeWorkflow` 按钮：始终从头执行所有节点（重置已完成节点状态）
- `resumeWorkflow` 按钮：仅当有失败/未执行节点时显示，跳过已完成节点

### 4.3 UI 交互

- "执行工作流"按钮：执行前重置所有节点状态为 idle
- "断点续执行"按钮：保留已完成节点，仅重新执行失败/未执行节点
- 执行中按钮变为"停止"（已有逻辑）

---

## 五、涉及文件清单

| 子方案 | 文件 | 变更类型 |
|--------|------|----------|
| A | `backend/app/schemas/render.py` | 修改：补齐字段 |
| A | `backend/app/api/render.py` | 修改：RenderTaskCreate 新增 node_params，创建任务时传递 |
| A | `backend/app/tasks/render_tasks.py` | 修改：签名新增 node_params，各执行函数读取 params |
| A | `backend/app/models/render_task.py` | 修改：progress 类型 Integer |
| A | `frontend/src/utils/apiClient.ts` | 修改：RenderTaskCreateRequest 新增 node_params |
| A | `frontend/src/utils/workflowExecutor.ts` | 修改：传递完整 node_params |
| B | `backend/app/api/render.py` | 修改：新增 retry 端点 |
| B | `frontend/src/utils/apiClient.ts` | 修改：新增 renderApi.retry |
| B | `frontend/src/components/canvas/CanvasNode.tsx` | 修改：失败状态增加重试按钮 |
| B | `frontend/src/pages/RenderCenter.tsx` | 修改：失败任务增加重试操作 |
| C | `frontend/src/utils/workflowExecutor.ts` | 修改：新增 resumeWorkflow |
| C | `frontend/src/components/EditorLayout.tsx` | 修改：新增断点续执行按钮 |

---

## 六、数据库迁移

`render_tasks` 表 `progress` 字段从 `Float` 改为 `Integer` 需要一次 Alembic 迁移。由于 PostgreSQL 的类型转换兼容，数据不丢失。

---

## 七、测试要点

1. **Schema 统一**：创建渲染任务时 node_params 正确传递和存储
2. **各节点类型 params 读取**：upscale 的 scale、style_transfer 的 style 等参数正确传递到 Celery
3. **重试端点**：失败任务可重试，新任务继承原任务参数
4. **CanvasNode 重试**：失败节点点击重试按钮后重新执行
5. **渲染中心重试**：失败任务行点击重试后创建新任务
6. **断点续执行**：3节点链路 A→B→C，A完成B失败后，续执行只跑B→C
7. **进度整数**：所有进度更新为整数 0-100
