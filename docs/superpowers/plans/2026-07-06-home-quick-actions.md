# 首页快捷操作功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为首页"从模板创建"和"AI 快速生成"两个按钮实现交互功能

**Architecture:** 在 Home.tsx 中添加两个弹窗组件——模板选择弹窗（内嵌模板列表+搜索+分类+克隆）和 AI 生成弹窗（描述输入+模型选择+生成工作流），复用已有的 templateApi 和 aiApi

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, sonner (toast)

## Global Constraints

- 前端技术栈：Vite + React 18 + TypeScript
- 样式使用 Tailwind CSS，遵循现有暗色主题变量（canvas-bg/canvas-panel/canvas-border/neon-purple 等）
- 所有 API 调用通过 `@/utils/apiClient.ts` 中的封装函数
- Git commit 使用简短中文描述

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/pages/Home.tsx` | Modify | 添加模板弹窗和 AI 生成弹窗的状态、事件处理和 UI |

---

### Task 1: "从模板创建"弹窗

**Files:**
- Modify: `frontend/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `templateApi.list(params?)` → `TemplateResponse[]`，`templateApi.clone(templateId)` → `ProjectResponse`
- Produces: 点击模板克隆后调用 `navigate(/editor/${project.id})` 跳转编辑器

**新增状态：**

```typescript
const [showTemplateDialog, setShowTemplateDialog] = useState(false);
const [templateSearch, setTemplateSearch] = useState('');
const [templateCategory, setTemplateCategory] = useState<string>('全部');
const [templateList, setTemplateList] = useState<TemplateResponse[]>([]);
const [templateLoading, setTemplateLoading] = useState(false);
const [cloningId, setCloningId] = useState<string | null>(null);
```

- [ ] **Step 1: 添加模板弹窗状态变量**

在 Home.tsx 的现有状态声明区域（`const [publishTags, ...]` 之后）添加上述 6 个状态变量。

- [ ] **Step 2: 添加模板数据加载逻辑**

在 `showTemplateDialog` 变化时加载模板列表：

```typescript
useEffect(() => {
  if (!showTemplateDialog) return;
  setTemplateLoading(true);
  const params: { q?: string; category?: string } = {};
  if (templateSearch) params.q = templateSearch;
  if (templateCategory !== '全部') params.category = templateCategory;
  templateApi.list(params)
    .then(setTemplateList)
    .catch(() => toast.error('加载模板失败'))
    .finally(() => setTemplateLoading(false));
}, [showTemplateDialog, templateSearch, templateCategory]);
```

- [ ] **Step 3: 添加模板克隆处理函数**

```typescript
const handleCloneTemplate = async (template: TemplateResponse) => {
  setCloningId(template.id);
  try {
    const project = await templateApi.clone(template.id);
    toast.success(`已从模板创建项目「${project.name}」`);
    setShowTemplateDialog(false);
    navigate(`/editor/${project.id}`);
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : '克隆失败');
  } finally {
    setCloningId(null);
  }
};
```

- [ ] **Step 4: 绑定按钮 onClick**

将"从模板创建"按钮添加 `onClick={() => setShowTemplateDialog(true)}`

- [ ] **Step 5: 添加模板弹窗 UI**

在 `publishModal` 弹窗之后添加模板选择弹窗，包含：搜索框 + 分类标签（全部/官方/社区）+ 模板卡片网格 + 克隆按钮。弹窗样式与新建对话框一致（`fixed inset-0 bg-black/60` + `bg-canvas-panel rounded-xl`）。

- [ ] **Step 6: TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/Home.tsx && git commit -m "从模板创建弹窗功能"
```

---

### Task 2: "AI 快速生成"弹窗

**Files:**
- Modify: `frontend/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `aiApi.generateWorkflow({ description, mode, model_id? })` → `WorkflowSaveRequest`，`workflowApi.save(projectId, data)` → `WorkflowSaveResponse`，`aiApi.models.list({ model_type: 'llm' })` → `AiModelResponse[]`
- Produces: 生成工作流后调用 `navigate(/editor/${project.id})` 跳转编辑器

**新增状态：**

```typescript
const [showAIDialog, setShowAIDialog] = useState(false);
const [aiDescription, setAiDescription] = useState('');
const [aiModelId, setAiModelId] = useState('');
const [aiLlmModels, setAiLlmModels] = useState<AiModelResponse[]>([]);
const [aiGenerating, setAiGenerating] = useState(false);
```

- [ ] **Step 1: 添加 AI 弹窗状态变量**

在 Task 1 新增的状态之后添加上述 5 个状态变量。

- [ ] **Step 2: 添加 AI 模型加载逻辑**

在 `showAIDialog` 变为 true 时加载 LLM 模型列表：

```typescript
useEffect(() => {
  if (!showAIDialog) return;
  aiApi.models.list({ model_type: 'llm' })
    .then(setAiLlmModels)
    .catch(() => toast.error('加载 AI 模型失败'));
}, [showAIDialog]);
```

- [ ] **Step 3: 添加 AI 生成处理函数**

```typescript
const handleAIGenerate = async () => {
  if (!aiDescription.trim()) {
    toast.error('请输入工作流描述');
    return;
  }
  setAiGenerating(true);
  try {
    // 1. 创建空项目
    const project = await createProject('AI 生成的工作流');
    // 2. 调用 AI 生成工作流
    const workflow = await aiApi.generateWorkflow({
      description: aiDescription.trim(),
      mode: 'replace',
      model_id: aiModelId || undefined,
    });
    // 3. 将生成的节点和边保存到项目
    await workflowApi.save(project.id, workflow);
    toast.success('工作流生成成功');
    setShowAIDialog(false);
    setAiDescription('');
    navigate(`/editor/${project.id}`);
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : 'AI 生成失败');
  } finally {
    setAiGenerating(false);
  }
};
```

- [ ] **Step 4: 绑定按钮 onClick**

将"AI 快速生成"按钮添加 `onClick={() => setShowAIDialog(true)}`

- [ ] **Step 5: 添加 AI 弹窗 UI**

在模板弹窗之后添加 AI 生成弹窗，包含：描述文本框（textarea，3-4行）+ AI 模型选择下拉框（从 aiLlmModels 渲染，默认取第一个）+ 生成按钮（加载中显示 spinner）。弹窗样式与现有对话框一致。

- [ ] **Step 6: TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/Home.tsx && git commit -m "AI快速生成工作流弹窗功能"
```

---

### Task 3: MCP 端到端验证

- [ ] **Step 1: 启动前后端服务**

确认 `localhost:8000` 和 `localhost:5173` 可访问。

- [ ] **Step 2: 验证"从模板创建"弹窗**

1. 打开首页，点击"从模板创建"按钮
2. 确认弹窗出现，包含搜索框和分类标签
3. 确认模板列表正确加载（如有已发布的模板）
4. 确认无模板时显示空状态
5. 关闭弹窗

- [ ] **Step 3: 验证"AI 快速生成"弹窗**

1. 点击"AI 快速生成"按钮
2. 确认弹窗出现，包含描述输入框和模型选择下拉框
3. 确认模型下拉框显示 LLM 类型模型
4. 关闭弹窗

- [ ] **Step 4: 提交最终验证**

确认所有功能正常，代码已提交。
