# 画布节点触发渲染任务 — 设计文档

> 日期: 2026-06-27
> 状态: 已批准

## 目标

将渲染中心的前后端打通能力集成到主项目的工作流画布中，让前端用户可以直接从画布节点触发渲染任务，支持单节点执行和全工作流拓扑编排两种模式。

## 架构

**前端驱动编排**：前端做拓扑排序 → 逐节点调 `POST /render/` → 轮询节点状态 → 上游输出传下游输入。后端改动最小，复用现有 render API 和 Celery 任务链路。

## 核心数据流

```
用户点击"执行节点"
  → 读取节点 subtype + params + 上游 outputArtifacts
  → 确定任务类型 + AI 模型
  → POST /api/v1/render/ { project_id, task_type, node_id, model_id, input_artifacts }
  → Celery run_render_task 执行
  → DB 实时写回 status/progress/result_url
  → 前端 3s 轮询
  → canvasStore.setNodeStatus(id, status, progress)
  → 完成后 outputArtifacts 写入节点
```

## 详细设计

### 1. 任务类型映射

| 节点 subtype | 任务类型 | 需要 AI 模型 | 说明 |
|---|---|---|---|
| `text_to_image` | `ai_text2img` | 是 | 文生图 |
| `image_to_video` | `ai_img2video` | 是 | 图生视频 |
| `text_to_speech` | `ai_tts` | 是 | 文生语音 |
| `upscale` | `render` | 否 | 高清放大 |
| `style_transfer` | `render` | 否 | 风格化 |
| `remove_bg` | `render` | 否 | 抠图 |
| `extend_image` | `render` | 否 | 扩图 |
| `video_output` | `render` | 否 | 视频输出 |
| `image_output` | `render` | 否 | 图片输出 |
| `audio_output` | `render` | 否 | 音频输出 |
| `text_input` / `image_input` / `audio_input` | — | — | 输入节点不执行 |
| `if_else` / `loop` / `merge` | — | — | 控制节点跳过（MVP） |

### 2. 单节点执行

**触发**：属性面板"执行节点"按钮

**步骤**：
1. 检查节点 subtype 是否可执行（输入/控制节点跳过）
2. AI 推理节点：从 `params.model_id` 读取模型，无则调 `GET /ai/models/default` 获取默认
3. 沿 edges 回溯收集上游 `outputArtifacts` 作为输入
4. 调 `renderApi.create({ project_id, task_type, node_id, model_id, input_artifacts })`
5. 启动轮询（3s 间隔），更新 `canvasStore.setNodeStatus(id, status, progress)`
6. 完成后将 `result_url` 写入节点 `outputArtifacts`

### 3. 全工作流编排

**触发**：顶部工具栏"执行工作流"按钮

**编排引擎** (`workflowExecutor.ts`)：
1. **拓扑排序**：基于 edges 构建邻接表，Kahn 算法求解执行层
2. **按层执行**：同层节点可并行提交，层间等上层全部完成后执行下层
3. **节点复用**：每个节点复用"单节点执行"逻辑
4. **状态管理**：
   - 编排状态：`idle → running → completed/failed`
   - 任一节点 failed → 停止后续执行，标记编排 failed
   - 编排进度 = 已完成节点数 / 总可执行节点数
5. **轮询合并**：所有运行中节点共享一个轮询定时器，一次 API 调用获取所有任务状态

### 4. 后端改动

#### 4.1 新增 API

**`GET /api/v1/ai/models/default`**
- 返回当前用户第一个 active 的 AI Model
- 用于 AI 推理节点自动选择模型
- Response: `AiModelResponse | 404`

#### 4.2 修改 API

**`POST /api/v1/render/`** — 扩展 `RenderTaskCreate` schema：
```python
class RenderTaskCreate(BaseModel):
    project_id: str
    task_type: str
    node_id: str | None = None          # 关联的画布节点 ID
    model_id: str | None = None          # AI 模型 UUID
    prompt: str | None = None            # 提示词
    input_artifacts: list[dict] | None = None  # 上游输出资产
```

`render_tasks.py` 中 `run_render_task` 新增参数：
- `node_id`：写入 `render_tasks` 表（新增列）
- `input_artifacts`：传递给 AI 执行逻辑

#### 4.3 数据库迁移

`render_tasks` 表新增列：
- `node_id VARCHAR(36) NULL` — 关联的画布节点 ID

#### 4.4 Celery 任务路由

`run_render_task` 根据 `task_type` 前缀路由：
- `ai_*` 前缀 → `_execute_ai_task()`（调用 `ai_service`）
- 其他 → `_execute_render_task()`（模拟进度）

### 5. 前端改动

#### 5.1 新增文件

**`frontend/src/utils/workflowExecutor.ts`**
```ts
// 核心接口
interface WorkflowExecutor {
  executeNode(nodeId: string): Promise<void>;
  executeWorkflow(): Promise<void>;
  cancelExecution(): void;
  getStatus(): ExecutionStatus;
}
```
- `executeNode()`：单节点执行逻辑（步骤见第 2 节）
- `executeWorkflow()`：拓扑排序 + 逐层执行
- 内部维护 `Map<nodeId, taskId>` 和轮询定时器

#### 5.2 修改文件

| 文件 | 改动 |
|------|------|
| `Editor.tsx` | PropertyPanelWithHistory 中替换模拟执行为 `executor.executeNode()` |
| `EditorLayout.tsx` | "执行工作流"按钮绑定 `executor.executeWorkflow()`，显示编排状态 |
| `apiClient.ts` | 扩展 `renderApi.create` 参数（node_id, input_artifacts）；新增 `aiApi.getDefaultModel()` |
| `canvasStore.ts` | 新增 `setNodeOutput(id, artifacts)` 方法；扩展 `setNodeStatus` 支持 completed 时设置 outputArtifacts |

#### 5.3 AI 模型选择器

AI 推理节点属性面板新增模型下拉选择器：
- 数据源：`aiApi.listModels()`
- 选中后存入 `params.model_id`
- 默认选中用户默认模型

## 错误处理

- 输入节点/控制节点点击执行 → Toast "该节点无需执行"
- AI 推理节点无可用模型 → Toast "请先在设置页配置 AI 模型"
- 上游节点未完成 → Toast "请先执行上游节点"（单节点执行时）
- 编排中某节点失败 → 停止后续，已提交节点等待完成
- 网络错误 → 标记节点 failed，Toast 提示

## 不在范围内

- 控制节点（if_else/loop/merge）的条件逻辑执行
- 后端编排引擎（后续升级）
- 渲染结果预览（仅存 result_url，不直接在节点内预览）
