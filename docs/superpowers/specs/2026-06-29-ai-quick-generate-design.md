# AI 快速生成 — 设计文档

> 日期: 2026-06-29
> 阶段: 路线图阶段五 #12
> 状态: 已批准，待实施

## 目标

输入自然语言描述 → 调 LLM API → 自动生成工作流节点/边并加载到画布，让用户"描述即可用，生成即可执行"。

## 范围

- 生成模式：支持「替换全部」与「追加到当前画布」两种模式
- 交互入口：EditorLayout 工具栏新增「AI 生成」按钮 → 弹出模态框
- 映射策略：后端代理 LLM 调用 + 校验节点合法性 + 生成 ID + 计算布局位置
- 预填参数：text_input.params.text 与 ai_inference.params.prompt 从描述填充；AI 节点 model_id 填默认模型
- 布局：后端按拓扑分层计算 position（不引入 dagre 依赖）
- 生成后：前端 fitView + 选中首个节点

## 非目标（YAGNI）

- 多轮对话修改（"再加一个抠图节点"）— 留待后续迭代
- 生成后自动执行预览 — 用户手动点「执行工作流」
- 节点参数编辑后重新生成 — 超出第一版范围
- 控制节点（if_else/loop/merge）的复杂条件参数预填 — LLM 仅生成结构，控制节点参数留空

## 架构

```
用户输入描述 → 前端模态框 → POST /ai/generate-workflow
                                    ↓
                            后端 call_llm（system prompt 约束 JSON 输出）
                                    ↓
                            解析 JSON → 校验 subtype 白名单 → 生成 ID
                                    ↓
                            预填参数（prompt/model_id）+ 分层布局计算 position
                                    ↓
                            返回 {nodes, edges}（后端 NodeCreateRequest/EdgeCreateRequest 格式）
                                    ↓
                      前端 canvasStore.loadGeneratedWorkflow(mode) → fitView → 选中首节点
```

## 后端设计

### 新增 endpoint

`POST /api/v1/ai/generate-workflow`（添加到 `backend/app/api/ai.py`）

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| description | string | 是 | 自然语言工作流描述 |
| mode | `"replace"` \| `"append"` | 是 | 替换当前画布 / 追加到画布 |
| model_id | string | 否 | LLM 模型 UUID；不传则取默认 LLM 模型（model_type='llm' 的首个 active） |

**响应 200：**

```json
{
  "nodes": [
    {
      "id": "node-1782476890770-n9ckd6",
      "node_type": "input",
      "label": "文本输入",
      "position_x": 0,
      "position_y": 0,
      "config": {
        "type": "input",
        "subtype": "text_input",
        "label": "文本输入",
        "params": { "text": "用户输入的描述" },
        "status": "idle",
        "progress": 0,
        "outputArtifacts": []
      }
    }
  ],
  "edges": [
    {
      "id": "edge-...",
      "source_node_id": "node-...",
      "target_node_id": "node-..."
    }
  ]
}
```

> 返回格式与 `workflowApi.save` 的请求体一致，前端可直接复用加载逻辑。

### 新增 service

`ai_service.generate_workflow(db, description, model_id)` — 添加到 `backend/app/services/ai_service.py`

职责：
1. 构建 system prompt（含 16 种合法 subtype 语义说明 + JSON 输出 schema 约束）
2. 调 `call_llm(db, model_id, messages, temperature=0.3)`（低温度保证稳定）
3. 解析 LLM 返回的 JSON（容忍 ```json 代码块包裹，strip 后 json.loads）
4. 校验 subtype 白名单，跳过非法节点并记录 warning 日志
5. 生成 node id（`node-{int(time.time()*1000)}-{rand6}`）
6. 按拓扑分层计算 position：第 0 层 x=0，第 N 层 x=N*300；同层按索引 y=index*150
7. 预填参数：
   - `text_input`：`params.text = description`
   - `ai_inference`（text_to_image/image_to_video/text_to_speech）：`params.prompt = description`；`params.model_id = 默认模型 id`（取 model_type 匹配的默认模型，若无则留空）
   - 其他节点：保留 NODE_TEMPLATES 的 defaultParams
8. 返回 `{nodes: NodeCreateRequest[], edges: EdgeCreateRequest[]}`

### 节点白名单（16 种）

| type | subtype | label |
|------|---------|-------|
| input | text_input / image_input / audio_input | 文本/图片/音频输入 |
| ai_inference | text_to_image / image_to_video / text_to_speech | 文生图/图生视频/文生语音 |
| processing | upscale / style_transfer / remove_bg / extend_image | 高清放大/风格化/抠图/扩图 |
| control | if_else / loop / merge | 条件分支/循环/合并 |
| output | video_output / image_output / audio_output | 视频/图片/音频输出 |

> 与 `frontend/src/types/canvas.ts` 的 NODE_TEMPLATES 完全一致。后端需维护一份相同白名单常量。

### LLM Prompt 设计

**system prompt：**

```
你是 AI 视频工作流编排助手。根据用户描述生成工作流节点和连接。

合法节点类型（仅可使用以下 subtype）：
- 输入：text_input(文本输入), image_input(图片输入), audio_input(音频输入)
- AI 推理：text_to_image(文生图), image_to_video(图生视频), text_to_speech(文生语音)
- 处理：upscale(高清放大), style_transfer(风格化), remove_bg(抠图), extend_image(扩图)
- 控制：if_else(条件分支), loop(循环), merge(合并)
- 输出：video_output(视频输出), image_output(图片输出), audio_output(音频输出)

输出严格 JSON 格式（不要 markdown 代码块，不要额外文字）：
{"nodes":[{"id":"n1","subtype":"text_input","label":"文本输入"}],"edges":[{"from":"n1","to":"n2"}]}

规则：
1. 节点 id 用简单标识（n1, n2, n3...）
2. 连接需符合数据流方向：输入 → AI推理/处理 → 输出
3. label 用中文
4. 不要填 params（由系统自动填充）
```

**user prompt：** 用户输入的 description

## 前端设计

### apiClient.ts

新增方法：

```typescript
// aiApi 内新增
generateWorkflow: (data: { description: string; mode: 'replace' | 'append'; model_id?: string }) =>
  request<WorkflowSaveRequest>('/ai/generate-workflow', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
```

> 复用现有 `WorkflowSaveRequest` 类型（`{nodes: NodeCreateRequest[], edges: EdgeCreateRequest[]}`）。

### EditorLayout.tsx

工具栏「执行工作流」按钮前新增「AI 生成」按钮：

```tsx
<button
  onClick={() => setShowAiModal(true)}
  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-blue to-neon-purple rounded-md hover:opacity-90 transition-opacity"
>
  <Sparkles className="w-3.5 h-3.5" />
  AI 生成
</button>
```

新增 state `showAiModal`，渲染 `<AiGenerateModal />`。

### 新建 AiGenerateModal.tsx

`frontend/src/components/AiGenerateModal.tsx`

UI 结构：
- 半透明遮罩 + 居中卡片（宽 480px）
- 标题「AI 生成工作流」+ 关闭按钮
- textarea 描述输入（placeholder：描述你想要的工作流，如"生成产品宣传视频：文本输入→文生图→图生视频→视频输出"）
- 模式单选：「追加到画布」（默认）/「替换当前画布」（替换模式加二次确认）
- 生成按钮（loading 时显示 spinner + "生成中..."）
- 错误提示区（红色文字）
- 生成成功后自动关闭模态框 + toast 成功提示

Props：

```typescript
interface AiGenerateModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (nodes: NodeCreateRequest[], edges: EdgeCreateRequest[], mode: 'replace' | 'append') => void;
}
```

### canvasStore.ts

新增 `loadGeneratedWorkflow` 方法：

```typescript
loadGeneratedWorkflow: (nodes: NodeCreateRequest[], edges: EdgeCreateRequest[], mode: 'replace' | 'append') => {
  // 转换后端格式 → 前端 CanvasNode/CanvasEdge（复用 projectStore 的转换逻辑）
  // mode === 'replace': set({ nodes: [], edges: [] }) 后加载
  // mode === 'append': 直接追加（追加模式 edges 的 id 加前缀避免冲突）
  // 记录 history
}
```

### 生成后处理

- `fitView({ padding: 0.2, duration: 300 })` 自适应视图
- 选中首个节点（`setSelectedNodeId(nodes[0].id)`）

## 数据流

1. 用户点「AI 生成」→ 打开模态框
2. 输入描述 + 选模式 → 点生成
3. 前端 `aiApi.generateWorkflow({description, mode, model_id?})`
4. 后端 `generate_workflow`：call_llm → 解析 → 校验 → 布局 → 返回
5. 前端 `canvasStore.loadGeneratedWorkflow(nodes, edges, mode)`
6. `fitView` + 选中首节点
7. 用户可立即点「执行工作流」

## 错误处理

| 场景 | HTTP | 前端提示 |
|------|------|----------|
| 无可用 LLM 模型（未配置 model_type='llm' 的 active 模型） | 404 | "未找到可用的 LLM 模型，请先在设置页配置" |
| LLM 调用失败（HTTP 非 200 / 超时） | 502 | "AI 服务调用失败，请重试" |
| LLM 返回非 JSON / JSON 解析失败 | 502 | "AI 返回格式异常，请重试" |
| 全部节点 subtype 非法 | 502 | "AI 生成内容无效，请换种描述" |
| 部分节点非法 | 200 | 正常返回合法部分，后端日志记录跳过的非法节点 |

> 前端模态框错误区显示 `error.detail`，并保留输入内容便于重试。

## 测试策略

### 后端

- 单元测试 `generate_workflow`：
  - mock `call_llm` 返回合法 JSON → 验证节点/边数量、ID 格式、position 计算、参数预填
  - mock 返回非法 subtype → 验证跳过逻辑
  - mock 返回非 JSON → 验证抛 502
- 端点测试：`POST /ai/generate-workflow` 鉴权 + 请求体校验

### 前端

- `pnpm tsc --noEmit` 类型检查
- 人工验证清单（新建 `frontend/verify_ai_generate.md`）：
  - 模态框打开/关闭
  - 替换模式：清空画布后加载
  - 追加模式：保留现有节点追加
  - fitView 生效
  - 错误提示（断网/无模型）
  - 生成后可执行工作流

## 涉及文件

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/app/api/ai.py` | 修改 | 新增 POST /ai/generate-workflow endpoint |
| `backend/app/services/ai_service.py` | 修改 | 新增 generate_workflow + LLM prompt + 校验 + 布局 |
| `backend/app/schemas/ai.py` | 修改 | 新增 GenerateWorkflowRequest/Response schema |
| `frontend/src/utils/apiClient.ts` | 修改 | 新增 aiApi.generateWorkflow |
| `frontend/src/components/EditorLayout.tsx` | 修改 | 工具栏新增按钮 + 模态框 state |
| `frontend/src/components/AiGenerateModal.tsx` | 新建 | AI 生成模态框组件 |
| `frontend/src/stores/canvasStore.ts` | 修改 | 新增 loadGeneratedWorkflow 方法 |
| `frontend/verify_ai_generate.md` | 新建 | 端到端验证清单 |

## 约束

- 复用现有 `ai_service.call_llm`（OpenAI Chat Completions 兼容格式）
- 复用现有 AI Provider/Model 配置（DB 表 ai_providers/ai_models）
- 不引入新依赖（dagre 等布局库）— 用自实现分层布局
- 节点白名单与前端 NODE_TEMPLATES 保持一致
- Git commit message 用简短中文
- 不破坏现有自动保存/协作逻辑（生成后画布变更会触发 autoSaveStore 防抖保存）
