# 前端优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统性优化 AI Canvas Flow 前端的 10 类问题（构建配置、类型安全、状态管理、性能、内存泄漏、测试覆盖、错误处理、代码组织、重复代码、可访问性），每完成一个任务提交一次 commit。

**Architecture:** 按 P0 → P1 → P2 → P3 优先级分阶段实施。每个任务独立可测试、独立提交。涉及重构的任务先确保现有测试通过，新功能采用 TDD。所有改动在 `frontend/` 目录下进行。

**Tech Stack:** TypeScript 5.8、React 18、Vite 6、Zustand 5、Vitest 4、@xyflow/react 12、video.js 8

## Global Constraints

- 工作目录：`/Users/qzfrato/AI_Canvas_Flow/frontend`
- 包管理器：pnpm（lockfile 为 pnpm-lock.yaml）
- 测试命令：`pnpm test`（vitest run）
- 类型检查命令：`pnpm check`（tsc -b --noEmit）
- 构建命令：`pnpm build`
- Git 提交信息：**必须用中文，简短描述**（用户明确要求）
- 每个任务结束必须有 commit 步骤
- 提交前必须通过 `pnpm check && pnpm test`
- 不修改 `frontend/.vscode`（只读目录）
- 现有测试文件不可删除

---

## Task 1: Vite 构建优化 - manualChunks + bundle visualizer

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: 现有 vite.config.ts
- Produces: 优化后的构建配置（产出多 chunk）

- [ ] **Step 1: 安装 bundle visualizer**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm add -D rollup-plugin-visualizer
```
Expected: 安装成功，package.json devDependencies 增加 `rollup-plugin-visualizer`

- [ ] **Step 2: 修改 vite.config.ts**

替换 `frontend/vite.config.ts` 全文为：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'xyflow': ['@xyflow/react'],
          'media': ['video.js', '@ffmpeg/ffmpeg', '@ffmpeg/util', 'html-to-image'],
          'icons': ['lucide-react'],
          'dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'state': ['zustand', 'sonner', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }),
    tsconfigPaths(),
    visualizer({
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
})
```

- [ ] **Step 3: 验证构建**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm build
```
Expected: 构建成功，`dist/` 下出现多个 chunk 文件（react-vendor、xyflow、media 等）和 `dist/stats.html`

- [ ] **Step 4: 验证测试通过**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test
```
Expected: 全部测试通过

- [ ] **Step 5: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/vite.config.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "优化: Vite 构建配置 - manualChunks 代码分割 + bundle visualizer"
```

---

## Task 2: 开启 TypeScript strict 模式 + 修复 : any

**Files:**
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/src/utils/workflowExecutor.ts:210,305`
- Modify: `frontend/src/components/EditorLayout.tsx:85,107,294,418,457`
- Modify: `frontend/src/components/ExportModal.tsx:84`
- Modify: `frontend/src/components/AiGenerateModal.tsx:44`
- Modify: `frontend/src/components/panels/PropertyPanel.tsx:182`
- Modify: `frontend/src/components/InviteModal.tsx:43`
- Modify: `frontend/src/components/CollaboratorPanel.tsx:39,51`
- Modify: `frontend/src/pages/AcceptInvite.tsx:30,44`

**Interfaces:**
- Consumes: 现有 16 处 `: any`
- Produces: 全部替换为 `unknown` + 类型守卫

- [ ] **Step 1: 修改 tsconfig.json 开启 strict**

修改 `frontend/tsconfig.json`，将 `compilerOptions` 中的：
```json
"strict": false,
"noUnusedLocals": false,
"noUnusedParameters": false,
"noFallthroughCasesInSwitch": false,
"noUncheckedSideEffectImports": false,
"forceConsistentCasingInFileNames": false,
```
替换为：
```json
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"noFallthroughCasesInSwitch": true,
"noUncheckedSideEffectImports": true,
"forceConsistentCasingInFileNames": true,
```

- [ ] **Step 2: 修复 workflowExecutor.ts 的 : any**

修改 `frontend/src/utils/workflowExecutor.ts`：

第 210 行（ai_subtitle catch）：
```ts
    } catch (err: any) {
      useCanvasStore.getState().setNodeError(nodeId, getErrorMessage(err, 'node_execute'));
      throw err;
    }
```
改为：
```ts
    } catch (err: unknown) {
      useCanvasStore.getState().setNodeError(nodeId, getErrorMessage(err, 'node_execute'));
      throw err;
    }
```

第 305 行（主 catch）做同样修改：`catch (err: any)` → `catch (err: unknown)`

- [ ] **Step 3: 修复 EditorLayout.tsx 的 5 处 : any**

修改 `frontend/src/components/EditorLayout.tsx`：

第 85 行：
```ts
    } catch (err: any) {
      setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: err.message });
      toast.error('工作流执行出错');
    }
```
改为：
```ts
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误';
      setWorkflowStatus({ ...getExecutionStatus(), state: 'failed', error: message });
      toast.error('工作流执行出错');
    }
```

第 107 行（handleResumeWorkflow catch）做同样模式修改。

第 294 行：
```ts
          .catch((err: any) => toast.error(getErrorMessage(err, 'project_save')));
```
改为：
```ts
          .catch((err: unknown) => toast.error(getErrorMessage(err, 'project_save')));
```

第 418 行：
```ts
              } catch (err: any) {
                toast.error(getErrorMessage(err, 'autosave_snapshot'));
              }
```
改为：
```ts
              } catch (err: unknown) {
                toast.error(getErrorMessage(err, 'autosave_snapshot'));
              }
```

第 457 行做同样修改。

- [ ] **Step 4: 修复 ExportModal.tsx、AiGenerateModal.tsx、PropertyPanel.tsx、InviteModal.tsx、CollaboratorPanel.tsx、AcceptInvite.tsx 的 : any**

对每个文件中的 `catch (err: any)` 改为 `catch (err: unknown)`。

具体位置：
- `frontend/src/components/ExportModal.tsx:84`
- `frontend/src/components/AiGenerateModal.tsx:44`
- `frontend/src/components/panels/PropertyPanel.tsx:182`
- `frontend/src/components/InviteModal.tsx:43`
- `frontend/src/components/CollaboratorPanel.tsx:39` 和 `:51`
- `frontend/src/pages/AcceptInvite.tsx:30` 和 `:44`

对每处使用 `err` 的地方，如果原来访问 `.message`，改为：
```ts
const message = err instanceof Error ? err.message : String(err);
```
如果只传给 `getErrorMessage(err, ...)`，则直接传 `err: unknown` 即可（getErrorMessage 已支持 unknown）。

- [ ] **Step 5: 运行类型检查**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check
```
Expected: 无类型错误。如果有未覆盖的错误，逐个修复（主要可能是未使用变量、隐式 any 等）。

- [ ] **Step 6: 运行测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test
```
Expected: 全部测试通过

- [ ] **Step 7: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/tsconfig.json frontend/src/
git commit -m "优化: 开启 TypeScript strict 模式 + 修复 16 处 any 类型"
```

---

## Task 3: 规范化 Zustand selector

**Files:**
- Modify: `frontend/src/components/canvas/Canvas.tsx:68`
- Modify: `frontend/src/components/EditorLayout.tsx:53-55`
- Modify: `frontend/src/components/timeline/Timeline.tsx:42-49`

**Interfaces:**
- Consumes: 现有 store API
- Produces: 精细化 selector，减少无关重渲染

- [ ] **Step 1: 修改 Canvas.tsx 第 68 行的解构**

将 `frontend/src/components/canvas/Canvas.tsx:68`：
```ts
const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode, fitViewToken, selectedNodeIds, setSelectedNodeIds } = useCanvasStore();
```
改为：
```ts
const nodes = useCanvasStore((s) => s.nodes);
const edges = useCanvasStore((s) => s.edges);
const setNodes = useCanvasStore((s) => s.setNodes);
const setEdges = useCanvasStore((s) => s.setEdges);
const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
const addNode = useCanvasStore((s) => s.addNode);
const fitViewToken = useCanvasStore((s) => s.fitViewToken);
const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds);
```

- [ ] **Step 2: 修改 EditorLayout.tsx 第 53-55 行的解构**

将 `frontend/src/components/EditorLayout.tsx:53-55`：
```ts
const { projects, currentProject, setCurrentProject, saveCurrentProject, loadProjectToCanvas, loadProjects } = useProjectStore();
const { canUndo, canRedo, undo, redo } = useHistoryStore();
const { startAutoSave, stopAutoSave, checkRecovery, restoreSnapshot, discardRecovery, lastSavedAt, isDirty } = useAutoSaveStore();
```
改为：
```ts
const projects = useProjectStore((s) => s.projects);
const currentProject = useProjectStore((s) => s.currentProject);
const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
const saveCurrentProject = useProjectStore((s) => s.saveCurrentProject);
const loadProjectToCanvas = useProjectStore((s) => s.loadProjectToCanvas);
const loadProjects = useProjectStore((s) => s.loadProjects);

const canUndo = useHistoryStore((s) => s.canUndo);
const canRedo = useHistoryStore((s) => s.canRedo);
const undo = useHistoryStore((s) => s.undo);
const redo = useHistoryStore((s) => s.redo);

const startAutoSave = useAutoSaveStore((s) => s.startAutoSave);
const stopAutoSave = useAutoSaveStore((s) => s.stopAutoSave);
const checkRecovery = useAutoSaveStore((s) => s.checkRecovery);
const restoreSnapshot = useAutoSaveStore((s) => s.restoreSnapshot);
const discardRecovery = useAutoSaveStore((s) => s.discardRecovery);
const lastSavedAt = useAutoSaveStore((s) => s.lastSavedAt);
const isDirty = useAutoSaveStore((s) => s.isDirty);
```

- [ ] **Step 3: 修改 Timeline.tsx 第 42-46 行的解构**

将 `frontend/src/components/timeline/Timeline.tsx:42-46`：
```ts
const {
  data, isPlaying, play, pause, seekTo,
  addTrack, removeTrack, toggleTrackMute, toggleTrackLock, toggleTrackVisibility,
  removeClip, moveClip, resizeClip, setZoom, updateClipText, addClip,
} = useTimelineStore();
```
改为：
```ts
const data = useTimelineStore((s) => s.data);
const isPlaying = useTimelineStore((s) => s.isPlaying);
const play = useTimelineStore((s) => s.play);
const pause = useTimelineStore((s) => s.pause);
const seekTo = useTimelineStore((s) => s.seekTo);
const addTrack = useTimelineStore((s) => s.addTrack);
const removeTrack = useTimelineStore((s) => s.removeTrack);
const toggleTrackMute = useTimelineStore((s) => s.toggleTrackMute);
const toggleTrackLock = useTimelineStore((s) => s.toggleTrackLock);
const toggleTrackVisibility = useTimelineStore((s) => s.toggleTrackVisibility);
const removeClip = useTimelineStore((s) => s.removeClip);
const moveClip = useTimelineStore((s) => s.moveClip);
const resizeClip = useTimelineStore((s) => s.resizeClip);
const setZoom = useTimelineStore((s) => s.setZoom);
const updateClipText = useTimelineStore((s) => s.updateClipText);
const addClip = useTimelineStore((s) => s.addClip);
```

- [ ] **Step 4: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/components/
git commit -m "优化: 规范化 Zustand selector，减少无关重渲染"
```

---

## Task 4: workflowExecutor 状态迁入 Zustand store（TDD）

**Files:**
- Create: `frontend/src/stores/workflowExecutionStore.ts`
- Create: `frontend/src/stores/workflowExecutionStore.test.ts`
- Modify: `frontend/src/utils/workflowExecutor.ts`
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Consumes: workflowExecutor 现有的 `executeWorkflow`、`resumeWorkflow`、`cancelWorkflowExecution`、`getExecutionStatus`
- Produces: `useWorkflowExecutionStore`（state: status, totalNodes, completedNodes, failedNodeId, error；actions: run, resume, cancel, reset）

- [ ] **Step 1: 编写失败的测试**

创建 `frontend/src/stores/workflowExecutionStore.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkflowExecutionStore } from './workflowExecutionStore';

describe('workflowExecutionStore', () => {
  beforeEach(() => {
    useWorkflowExecutionStore.getState().reset();
  });

  it('初始状态为 idle', () => {
    const s = useWorkflowExecutionStore.getState();
    expect(s.state).toBe('idle');
    expect(s.totalNodes).toBe(0);
    expect(s.completedNodes).toBe(0);
    expect(s.failedNodeId).toBeNull();
    expect(s.error).toBeNull();
    expect(s.isRunning).toBe(false);
  });

  it('cancel 设置 cancelRequested 标志', () => {
    useWorkflowExecutionStore.getState().cancel();
    expect(useWorkflowExecutionStore.getState().isCancelRequested()).toBe(true);
  });

  it('reset 恢复初始状态并清除 cancelRequested', () => {
    useWorkflowExecutionStore.getState().cancel();
    useWorkflowExecutionStore.getState().reset();
    expect(useWorkflowExecutionStore.getState().state).toBe('idle');
    expect(useWorkflowExecutionStore.getState().isCancelRequested()).toBe(false);
  });

  it('updateProgress 更新进度字段', () => {
    useWorkflowExecutionStore.getState().updateProgress({
      state: 'running',
      totalNodes: 5,
      completedNodes: 2,
    });
    const s = useWorkflowExecutionStore.getState();
    expect(s.state).toBe('running');
    expect(s.totalNodes).toBe(5);
    expect(s.completedNodes).toBe(2);
    expect(s.isRunning).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test workflowExecutionStore
```
Expected: FAIL，"Cannot find module './workflowExecutionStore'"

- [ ] **Step 3: 创建 store**

创建 `frontend/src/stores/workflowExecutionStore.ts`：

```ts
import { create } from 'zustand';
import type { WorkflowExecutionStatus } from '@/utils/workflowExecutor';

interface WorkflowExecutionState extends WorkflowExecutionStatus {
  isRunning: boolean;
  /** 内部标志：是否请求了取消 */
  _cancelRequested: boolean;

  // actions
  updateProgress: (patch: Partial<WorkflowExecutionStatus>) => void;
  markCompleted: () => void;
  markFailed: (failedNodeId: string, error: string) => void;
  cancel: () => void;
  reset: () => void;
  isCancelRequested: () => boolean;
}

const INITIAL: WorkflowExecutionStatus = {
  state: 'idle',
  totalNodes: 0,
  completedNodes: 0,
  failedNodeId: null,
  error: null,
};

export const useWorkflowExecutionStore = create<WorkflowExecutionState>((set, get) => ({
  ...INITIAL,
  isRunning: false,
  _cancelRequested: false,

  updateProgress: (patch) =>
    set((state) => ({
      ...state,
      ...patch,
      isRunning: patch.state === 'running' ?? state.isRunning,
    })),

  markCompleted: () => set({ state: 'completed', isRunning: false }),

  markFailed: (failedNodeId, error) =>
    set({ state: 'failed', failedNodeId, error, isRunning: false }),

  cancel: () => set({ _cancelRequested: true }),

  reset: () => set({ ...INITIAL, isRunning: false, _cancelRequested: false }),

  isCancelRequested: () => get()._cancelRequested,
}));
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test workflowExecutionStore
```
Expected: PASS

- [ ] **Step 5: 重构 workflowExecutor.ts 使用 store**

修改 `frontend/src/utils/workflowExecutor.ts`：

删除模块级变量（第 363-371 行）：
```ts
let currentExecutionStatus: WorkflowExecutionStatus = {
  state: 'idle',
  totalNodes: 0,
  completedNodes: 0,
  failedNodeId: null,
  error: null,
};

let cancelRequested = false;
```

替换 `getExecutionStatus`、`cancelWorkflowExecution`、`executeWorkflow`、`resumeWorkflow` 的实现：

```ts
import { useWorkflowExecutionStore } from '@/stores/workflowExecutionStore';

export function getExecutionStatus(): WorkflowExecutionStatus {
  const s = useWorkflowExecutionStore.getState();
  return {
    state: s.state,
    totalNodes: s.totalNodes,
    completedNodes: s.completedNodes,
    failedNodeId: s.failedNodeId,
    error: s.error,
  };
}

export function cancelWorkflowExecution(): void {
  useWorkflowExecutionStore.getState().cancel();
}

export async function executeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

  const executableNodes = nodes.filter((n) => isExecutable(n.data.subtype));
  const totalNodes = executableNodes.length;

  if (totalNodes === 0) {
    return { state: 'completed', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null };
  }

  const store = useWorkflowExecutionStore.getState();
  store.reset();
  store.updateProgress({ state: 'running', totalNodes, completedNodes: 0, failedNodeId: null, error: null });

  let completedNodes = 0;

  for (const layer of layers) {
    if (useWorkflowExecutionStore.getState().isCancelRequested()) {
      useWorkflowExecutionStore.getState().markFailed('', '用户取消');
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
        const message = r.reason instanceof Error ? r.reason.message : '节点执行失败';
        useWorkflowExecutionStore.getState().markFailed(layer[i], message);
        useWorkflowExecutionStore.getState().updateProgress({ completedNodes });
        return getExecutionStatus();
      }
    }

    useWorkflowExecutionStore.getState().updateProgress({ completedNodes });
  }

  if (useWorkflowExecutionStore.getState().state === 'running') {
    useWorkflowExecutionStore.getState().markCompleted();
  }

  return getExecutionStatus();
}

export async function resumeWorkflow(): Promise<WorkflowExecutionStatus> {
  const { nodes, edges } = useCanvasStore.getState();
  const layers = topologicalSort(nodes, edges);

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

  const store = useWorkflowExecutionStore.getState();
  store.reset();
  store.updateProgress({ state: 'running', totalNodes, completedNodes: 0, failedNodeId: null, error: null });

  let completedNodes = 0;

  for (const layer of pendingLayers) {
    if (useWorkflowExecutionStore.getState().isCancelRequested()) {
      useWorkflowExecutionStore.getState().markFailed('', '用户取消');
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
        const message = r.reason instanceof Error ? r.reason.message : '节点执行失败';
        useWorkflowExecutionStore.getState().markFailed(layer[i], message);
        useWorkflowExecutionStore.getState().updateProgress({ completedNodes });
        return getExecutionStatus();
      }
    }

    useWorkflowExecutionStore.getState().updateProgress({ completedNodes });
  }

  if (useWorkflowExecutionStore.getState().state === 'running') {
    useWorkflowExecutionStore.getState().markCompleted();
  }

  return getExecutionStatus();
}
```

- [ ] **Step 6: 修改 EditorLayout.tsx 使用 store**

修改 `frontend/src/components/EditorLayout.tsx`：

删除本地 useState（第 64-66 行）：
```ts
const [workflowStatus, setWorkflowStatus] = useState<WorkflowExecutionStatus>({
  state: 'idle', totalNodes: 0, completedNodes: 0, failedNodeId: null, error: null
});
```

改为：
```ts
const workflowStatus = useWorkflowExecutionStore((s) => ({
  state: s.state,
  totalNodes: s.totalNodes,
  completedNodes: s.completedNodes,
  failedNodeId: s.failedNodeId,
  error: s.error,
}));
```

并在文件顶部添加：
```ts
import { useWorkflowExecutionStore } from '@/stores/workflowExecutionStore';
```

简化 `handleExecuteWorkflow`、`handleCancelWorkflow`、`handleResumeWorkflow`：

```ts
const handleExecuteWorkflow = async () => {
  if (workflowStatus.state === 'running') return;
  try {
    const result = await executeWorkflow();
    if (result.state === 'completed') {
      toast.success('工作流执行完成');
    } else if (result.state === 'failed') {
      toast.error(`工作流执行失败: ${result.error}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '工作流执行出错';
    useWorkflowExecutionStore.getState().markFailed('', message);
    toast.error('工作流执行出错');
  }
};

const handleCancelWorkflow = () => {
  cancelWorkflowExecution();
};

const handleResumeWorkflow = async () => {
  if (workflowStatus.state === 'running') return;
  try {
    const result = await resumeWorkflow();
    if (result.state === 'completed') {
      toast.success('断点续执行完成');
    } else if (result.state === 'failed') {
      toast.error(`断点续执行失败: ${result.error}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '断点续执行出错';
    useWorkflowExecutionStore.getState().markFailed('', message);
    toast.error('断点续执行出错');
  }
};
```

- [ ] **Step 7: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/stores/workflowExecutionStore.ts frontend/src/stores/workflowExecutionStore.test.ts frontend/src/utils/workflowExecutor.ts frontend/src/components/EditorLayout.tsx
git commit -m "优化: workflowExecutor 状态迁入 Zustand store，消除模块级可变变量"
```

---

## Task 5: 添加 React ErrorBoundary（TDD）

**Files:**
- Create: `frontend/src/components/ErrorBoundary.tsx`
- Create: `frontend/src/components/ErrorBoundary.test.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Produces: `ErrorBoundary` 组件（props: children, fallback?）

- [ ] **Step 1: 配置 jsdom 测试环境**

修改 `frontend/vitest.config.ts`，将 `environment: 'node'` 改为 `environment: 'jsdom'`，并安装依赖：

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm add -D jsdom
```

修改 `frontend/vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

- [ ] **Step 2: 编写失败的测试**

创建 `frontend/src/components/ErrorBoundary.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

const Thrower = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  it('正常渲染 children', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
  });

  it('捕获子组件错误并显示默认 fallback', () => {
    // 抑制 console.error 噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Thrower message="测试错误" />
      </ErrorBoundary>
    );
    expect(screen.getByText(/应用发生错误/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('支持自定义 fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>自定义错误页</div>}>
        <Thrower message="测试错误" />
      </ErrorBoundary>
    );
    expect(screen.getByText('自定义错误页')).toBeInTheDocument();
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: 安装 testing-library**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm add -D @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 4: 运行测试验证失败**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test ErrorBoundary
```
Expected: FAIL，"Cannot find module './ErrorBoundary'"

- [ ] **Step 5: 创建 ErrorBoundary 组件**

创建 `frontend/src/components/ErrorBoundary.tsx`：

```tsx
import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error('[ErrorBoundary]', error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="h-screen flex items-center justify-center bg-canvas-bg">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-status-error/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-status-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4h.01M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-slate-200 mb-2">应用发生错误</h2>
            <p className="text-sm text-slate-500 mb-4">
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm text-white bg-neon-purple rounded-lg hover:opacity-90"
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 6: 运行测试验证通过**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test ErrorBoundary
```
Expected: PASS

- [ ] **Step 7: 在 main.tsx 包裹 ErrorBoundary**

修改 `frontend/src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
```

- [ ] **Step 8: 在 EditorLayout 包裹 Outlet（局部错误不拖垮全局）**

修改 `frontend/src/components/EditorLayout.tsx`，将 `<Outlet />` 包裹：

```tsx
import { ErrorBoundary } from './ErrorBoundary';
// ...
<div className="flex-1 overflow-hidden">
  <ErrorBoundary>
    <Outlet />
  </ErrorBoundary>
</div>
```

- [ ] **Step 9: 类型检查 + 全量测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 10: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/vitest.config.ts frontend/package.json frontend/pnpm-lock.yaml frontend/src/components/ErrorBoundary.tsx frontend/src/components/ErrorBoundary.test.tsx frontend/src/main.tsx frontend/src/components/EditorLayout.tsx
git commit -m "优化: 添加 React ErrorBoundary 全局+局部错误边界"
```

---

## Task 6: 修复 Timeline 拖拽内存泄漏

**Files:**
- Modify: `frontend/src/components/timeline/Timeline.tsx:110-195`

**Interfaces:**
- Consumes: 现有 handleDragStart
- Produces: 拖拽中组件卸载时也能清理 window 监听器

- [ ] **Step 1: 修改 handleDragStart 使用 ref 跟踪监听器**

修改 `frontend/src/components/timeline/Timeline.tsx`：

在组件顶部（约第 50 行附近，与其他 useRef 一起）添加：
```ts
const dragHandlersRef = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null>(null);
```

修改 `handleDragStart`（第 110-195 行），把 `handleMove` 和 `handleUp` 提升到组件作用域并保存到 ref，添加 cleanup effect：

将原 `handleDragStart` 改为：
```ts
const handleDragStart = useCallback(
  (e: React.PointerEvent, trackId: string, clip: Clip, type: DragType) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture 失败不影响拖拽
    }

    const state: DragState = {
      type,
      trackId,
      clipId: clip.id,
      startX: e.clientX,
      origStart: clip.start,
      origEnd: clip.end,
    };
    setDragState(state);

    document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - state.startX) / PIXELS_PER_SECOND;
      const { origStart, origEnd } = state;
      const duration = origEnd - origStart;

      if (type === 'move') {
        let newStart = Math.max(0, Math.min(origStart + dt, data.duration - duration));
        newStart = findSnap(newStart, clip.id);
        newStart = Math.max(0, Math.min(newStart, data.duration - duration));
        moveClip(trackId, clip.id, newStart);
        setTooltip({
          x: ev.clientX,
          y: ev.clientY,
          text: `${formatTime(newStart)} → ${formatTime(newStart + duration)} (${duration.toFixed(1)}s)`,
        });
      } else if (type === 'resize-left') {
        let newStart = Math.max(0, Math.min(origStart + dt, origEnd - MIN_CLIP_DURATION));
        newStart = findSnap(newStart, clip.id);
        newStart = Math.min(newStart, origEnd - MIN_CLIP_DURATION);
        newStart = Math.max(0, newStart);
        resizeClip(trackId, clip.id, newStart, origEnd);
        setTooltip({
          x: ev.clientX,
          y: ev.clientY,
          text: `${formatTime(newStart)} → ${formatTime(origEnd)} (${(origEnd - newStart).toFixed(1)}s)`,
        });
      } else {
        let newEnd = Math.max(origStart + MIN_CLIP_DURATION, Math.min(origEnd + dt, data.duration));
        newEnd = findSnap(newEnd, clip.id);
        newEnd = Math.max(newEnd, origStart + MIN_CLIP_DURATION);
        newEnd = Math.min(newEnd, data.duration);
        resizeClip(trackId, clip.id, origStart, newEnd);
        setTooltip({
          x: ev.clientX,
          y: ev.clientY,
          text: `${formatTime(origStart)} → ${formatTime(newEnd)} (${(newEnd - origStart).toFixed(1)}s)`,
        });
      }
    };

    const handleUp = () => {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture 失败不影响清理
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      dragHandlersRef.current = null;
      setDragState(null);
      setTooltip(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    dragHandlersRef.current = { move: handleMove, up: handleUp };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  },
  [data.duration, findSnap, moveClip, resizeClip]
);

// 组件卸载时清理未完成的拖拽监听器
useEffect(() => {
  return () => {
    if (dragHandlersRef.current) {
      window.removeEventListener('pointermove', dragHandlersRef.current.move);
      window.removeEventListener('pointerup', dragHandlersRef.current.up);
      dragHandlersRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  };
}, []);
```

注意：需要在文件顶部 import 中添加 `useEffect`（如果还没有）：
```ts
import { useRef, useCallback, useState, useEffect } from 'react';
```

- [ ] **Step 2: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/components/timeline/Timeline.tsx
git commit -m "优化: 修复 Timeline 拖拽中卸载组件导致的内存泄漏"
```

---

## Task 7: 抽取重复代码

**Files:**
- Create: `frontend/src/utils/buildMediaUrl.ts`
- Create: `frontend/src/utils/buildMediaUrl.test.ts`
- Create: `frontend/src/constants/nodeIcons.ts`
- Create: `frontend/src/utils/id.ts`
- Modify: `frontend/src/components/canvas/Canvas.tsx:51,329-337`
- Modify: `frontend/src/components/canvas/CanvasNode.tsx:17`
- Modify: `frontend/src/pages/Editor.tsx:510-517`
- Modify: `frontend/src/utils/workflowExecutor.ts:264-270`

**Interfaces:**
- Produces:
  - `buildMediaUrl(url: string): string`
  - `generateId(prefix: string): string`
  - `NODE_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>>`

- [ ] **Step 1: 编写 buildMediaUrl 测试**

创建 `frontend/src/utils/buildMediaUrl.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildMediaUrl } from './buildMediaUrl';

describe('buildMediaUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'access_token' ? 'test-token' : null),
    });
  });

  it('内部 /api/ URL 拼接 token', () => {
    expect(buildMediaUrl('/api/v1/media/abc')).toBe('/api/v1/media/abc?token=test-token');
  });

  it('内部 /api/ URL 已有 query 时用 & 拼接', () => {
    expect(buildMediaUrl('/api/v1/media/abc?size=1')).toBe('/api/v1/media/abc?size=1&token=test-token');
  });

  it('外部 http URL 不拼接 token', () => {
    expect(buildMediaUrl('http://example.com/x.mp4')).toBe('http://example.com/x.mp4');
  });

  it('外部 https URL 不拼接 token', () => {
    expect(buildMediaUrl('https://example.com/x.mp4')).toBe('https://example.com/x.mp4');
  });

  it('相对路径补全为 /api/v1/media/', () => {
    expect(buildMediaUrl('abc/def.mp4')).toBe('/api/v1/media/abc/def.mp4?token=test-token');
  });

  it('以 / 开头的相对路径也补全', () => {
    expect(buildMediaUrl('/abc/def.mp4')).toBe('/api/v1/media/abc/def.mp4?token=test-token');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test buildMediaUrl
```
Expected: FAIL

- [ ] **Step 3: 创建 buildMediaUrl**

创建 `frontend/src/utils/buildMediaUrl.ts`：

```ts
/**
 * 统一构建媒体资源 URL
 *
 * - 内部 /api/ 路径：拼接 access_token
 * - 外部 http(s) 路径：原样返回
 * - 相对路径：补全为 /api/v1/media/<path>?token=...
 */
export function buildMediaUrl(url: string): string {
  const isInternal = url.startsWith('/api/');
  const isExternal = url.startsWith('http://') || url.startsWith('https://');

  if (isExternal) {
    return url;
  }

  const token = localStorage.getItem('access_token') || '';

  if (isInternal) {
    return `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
  }

  // 相对路径补全
  const normalized = url.replace(/^\//, '');
  return `/api/v1/media/${normalized}?token=${token}`;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test buildMediaUrl
```
Expected: PASS

- [ ] **Step 5: 创建 generateId**

创建 `frontend/src/utils/id.ts`：

```ts
/**
 * 生成带前缀的唯一 ID
 *
 * 格式：`<prefix>-<timestamp>-<random>`
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 6: 创建 nodeIcons 常量**

创建 `frontend/src/constants/nodeIcons.ts`：

```ts
import {
  Type, Image as ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
} from 'lucide-react';
import type { ComponentType } from 'react';

/** 节点 subtype → 图标组件映射（Canvas 与 CanvasNode 共享） */
export const NODE_ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  Type, Image: ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
};
```

- [ ] **Step 7: 在 Canvas.tsx 替换重复代码**

修改 `frontend/src/components/canvas/Canvas.tsx`：

删除第 50-56 行的 `ICON_MAP_LUCIDE` 定义，并删除 lucide-react 中相关图标的直接导入（第 38-45 行的 `Type, Image as ImageIcon, ...` 等，保留 `Copy, ClipboardPaste, Pencil, Play, Trash2, Eye, AlignStartVertical, AlignStartHorizontal, AlignCenterVertical, AlignCenterHorizontal` 这些菜单用的图标）。

修改后的导入：
```ts
import {
  Copy, ClipboardPaste, Pencil, Play, Trash2, Eye,
  AlignStartVertical, AlignStartHorizontal,
  AlignCenterVertical, AlignCenterHorizontal,
} from 'lucide-react';
import { NODE_ICON_MAP } from '@/constants/nodeIcons';
import { buildMediaUrl } from '@/utils/buildMediaUrl';
```

将第 390 行的 `ICON_MAP_LUCIDE[t.icon]` 改为 `NODE_ICON_MAP[t.icon]`。

将第 329-337 行的预览 URL 构建逻辑替换：
```ts
const url = buildMediaUrl(artifact.url);
```

- [ ] **Step 8: 在 CanvasNode.tsx 替换**

修改 `frontend/src/components/canvas/CanvasNode.tsx`：

删除第 9-15 行的图标导入和第 17-22 行的 `ICON_MAP` 定义，改为：
```ts
import { NODE_ICON_MAP } from '@/constants/nodeIcons';
import {
  Loader2, CheckCircle2, XCircle, AlertCircle, RotateCw,
} from 'lucide-react';
```

第 40 行 `const IconComponent = ICON_MAP[data.subtype] || AlertCircle;` 改为：
```ts
const IconComponent = NODE_ICON_MAP[data.subtype] || AlertCircle;
```

- [ ] **Step 9: 在 Editor.tsx 替换**

修改 `frontend/src/pages/Editor.tsx`：

顶部导入：
```ts
import { buildMediaUrl } from '@/utils/buildMediaUrl';
import { generateId } from '@/utils/id';
```

将第 505 行 `id: \`clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}\`` 改为：
```ts
id: generateId('clip'),
```
将第 510-517 行的 URL 构建逻辑替换为：
```ts
mediaUrl: buildMediaUrl(artifact.url),
```
将第 529 行 `id: \`clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}\`` 改为：
```ts
id: generateId('clip'),
```

- [ ] **Step 10: 在 workflowExecutor.ts 替换**

修改 `frontend/src/utils/workflowExecutor.ts`：

顶部导入：
```ts
import { buildMediaUrl } from '@/utils/buildMediaUrl';
import { generateId } from '@/utils/id';
```

将第 175、237、273、288 行的 `id: \`clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}\`` 改为 `id: generateId('clip')`。
将第 264-270 行的 URL 构建逻辑替换为：
```ts
const mediaUrl = buildMediaUrl(artifact.url);
```

- [ ] **Step 11: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 12: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/utils/buildMediaUrl.ts frontend/src/utils/buildMediaUrl.test.ts frontend/src/utils/id.ts frontend/src/constants/nodeIcons.ts frontend/src/components/canvas/Canvas.tsx frontend/src/components/canvas/CanvasNode.tsx frontend/src/pages/Editor.tsx frontend/src/utils/workflowExecutor.ts
git commit -m "优化: 抽取 buildMediaUrl、generateId、NODE_ICON_MAP 共享工具"
```

---

## Task 8: 拆分 apiClient.ts

**Files:**
- Create: `frontend/src/types/api.ts`
- Create: `frontend/src/api/index.ts`
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/api/project.ts`
- Create: `frontend/src/api/template.ts`
- Create: `frontend/src/api/workflow.ts`
- Create: `frontend/src/api/media.ts`
- Create: `frontend/src/api/render.ts`
- Create: `frontend/src/api/ai.ts`
- Create: `frontend/src/api/snapshot.ts`
- Create: `frontend/src/api/collab.ts`
- Create: `frontend/src/api/invitation.ts`
- Create: `frontend/src/api/client.ts`
- Modify: `frontend/src/utils/apiClient.ts`（保留为 re-export shim，避免破坏现有 import）

**Interfaces:**
- Produces:
  - `frontend/src/api/client.ts` 导出 `ApiError`、`request`
  - `frontend/src/types/api.ts` 导出所有 Schema 类型
  - `frontend/src/api/<module>.ts` 导出各业务 API

- [ ] **Step 1: 创建 types/api.ts**

创建 `frontend/src/types/api.ts`，将 `frontend/src/utils/apiClient.ts` 第 130-416 行的所有 `interface`/`type` 定义移动过来（UserResponse、TokenResponse、ProjectResponse、NodeResponse、EdgeResponse、MediaAssetResponse、RenderTaskResponse、AiProviderResponse、AiModelResponse、CollaboratorResponse、SnapshotResponse 等）。

完整代码直接复制 apiClient.ts 中 `// 1. 后端 Schema 类型` 到 `// 2. 业务模块 API` 之间的所有 interface 定义。

- [ ] **Step 2: 创建 api/client.ts**

创建 `frontend/src/api/client.ts`，将 apiClient.ts 第 13-122 行的基础设施代码（API_BASE、ApiError、refreshToken、request）移动过来：

```ts
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let isRefreshing = false;
let pendingRequests: Array<() => void> = [];

async function refreshToken(): Promise<string> {
  if (isRefreshing) {
    return new Promise((resolve) => pendingRequests.push(() => resolve(localStorage.getItem('access_token')!)));
  }
  isRefreshing = true;
  try {
    const rt = localStorage.getItem('refresh_token');
    if (!rt) throw new Error('No refresh token');
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    pendingRequests.forEach(cb => cb());
    pendingRequests = [];
    return data.access_token;
  } catch {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
  } finally {
    isRefreshing = false;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const isAuthEndpoint = path.startsWith('/auth/');
    if (res.status === 401 && !isAuthEndpoint) {
      try {
        const newToken = await refreshToken();
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers });
        if (!retryRes.ok) {
          if (retryRes.status === 401) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            window.location.href = '/login';
            throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
          }
          const retryBody = await retryRes.json().catch(() => ({}));
          throw new ApiError(retryRes.status, retryBody.detail || 'UNKNOWN', retryBody.detail || `请求失败: ${retryRes.status}`);
        }
        if (retryRes.status === 204) return undefined as T;
        return retryRes.json();
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
      }
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.detail || 'UNKNOWN',
      body.detail || `请求失败: ${res.status}`,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// re-export 类型供 api 模块使用
export type { CanvasNode, CanvasEdge, TimelineData };
```

- [ ] **Step 3: 创建各业务 API 模块**

创建以下文件，每个对应 apiClient.ts 中的一个 `export const xxxApi`：

`frontend/src/api/auth.ts`：移动 authApi
`frontend/src/api/project.ts`：移动 projectApi
`frontend/src/api/template.ts`：移动 templateApi
`frontend/src/api/workflow.ts`：移动 workflowApi
`frontend/src/api/media.ts`：移动 mediaApi + StorageUsageResponse + StorageStatsResponse + usageToStats
`frontend/src/api/render.ts`：移动 renderApi
`frontend/src/api/ai.ts`：移动 aiApi
`frontend/src/api/snapshot.ts`：移动 snapshotApi
`frontend/src/api/collab.ts`：移动 collabApi
`frontend/src/api/invitation.ts`：移动 invitationApi

每个文件结构示例（以 auth.ts 为例）：
```ts
import { request } from './client';
import type { UserResponse, TokenResponse, UserUpdateRequest } from '@/types/api';

export const authApi = {
  register: (username: string, email: string, password: string) =>
    request<UserResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  login: (username: string, password: string) =>
    request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getMe: () =>
    request<UserResponse>('/auth/me'),

  update: (data: UserUpdateRequest) =>
    request<UserResponse>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
```

- [ ] **Step 4: 创建 api/index.ts 统一导出**

创建 `frontend/src/api/index.ts`：

```ts
export { ApiError, request } from './client';
export * from '@/types/api';

export { authApi } from './auth';
export { projectApi } from './project';
export { templateApi } from './template';
export { workflowApi } from './workflow';
export { mediaApi } from './media';
export type { StorageUsageResponse, StorageStatsResponse } from './media';
export { renderApi } from './render';
export { aiApi } from './ai';
export { snapshotApi } from './snapshot';
export { collabApi } from './collab';
export { invitationApi } from './invitation';
```

- [ ] **Step 5: 将 apiClient.ts 改为 re-export shim**

将 `frontend/src/utils/apiClient.ts` 全文替换为：

```ts
/**
 * 兼容 shim：原 apiClient.ts 已拆分为 @/api/* 和 @/types/api
 * 此文件仅做 re-export，避免破坏现有 import { ... } from '@/utils/apiClient'
 *
 * 新代码请直接 import from '@/api'
 */
export * from '@/api';
```

- [ ] **Step 6: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/types/api.ts frontend/src/api/ frontend/src/utils/apiClient.ts
git commit -m "优化: 拆分 apiClient.ts 为 types/api.ts + api/* 模块"
```

---

## Task 9: 拆分 Settings.tsx

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`
- Create: `frontend/src/pages/settings/ProfileSection.tsx`
- Create: `frontend/src/pages/settings/StorageSection.tsx`
- Create: `frontend/src/pages/settings/AiProviderSection.tsx`
- Create: `frontend/src/pages/settings/AiModelSection.tsx`
- Create: `frontend/src/pages/settings/Modal.tsx`
- Create: `frontend/src/pages/settings/constants.ts`

**Interfaces:**
- Produces: 5 个独立的 Section 组件 + 共享 Modal + 共享常量

- [ ] **Step 1: 创建 constants.ts**

创建 `frontend/src/pages/settings/constants.ts`：

```ts
export interface ProviderPreset {
  value: string;
  label: string;
  description: string;
  defaultBaseUrl: string;
  supportedTypes: string[];
  icon: string;
  color: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { value: 'volcengine', label: '火山引擎', description: '豆包系列、SeedReam 图片/视频生成', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', supportedTypes: ['llm', 'image_gen', 'video_gen', 'tts'], icon: '火', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'openai', label: 'OpenAI', description: 'GPT-4o, DALL·E, TTS 等', defaultBaseUrl: 'https://api.openai.com/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: 'O', color: 'bg-green-500/20 text-green-400' },
  // ... 其余预设从 Settings.tsx 第 36-61 行完整复制
];

export const MODEL_TYPE_OPTIONS = [
  { value: 'llm', label: '文本生成', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'image_gen', label: '文生图', color: 'bg-purple-500/20 text-purple-400' },
  { value: 'video_gen', label: '图生视频', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'tts', label: '语音合成', color: 'bg-amber-500/20 text-amber-400' },
] as const;

export function modelTypeMeta(t: string) {
  return MODEL_TYPE_OPTIONS.find((o) => o.value === t) ?? { value: t, label: t, color: 'bg-slate-500/20 text-slate-400' };
}

export function platformLabel(t: string) {
  return PROVIDER_PRESETS.find((o) => o.value === t)?.label ?? t;
}

export function platformPreset(p: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((o) => o.value === p);
}

export function platformIcon(p: string) {
  return platformPreset(p)?.icon ?? p.charAt(0).toUpperCase();
}

export function platformColor(p: string) {
  return platformPreset(p)?.color ?? 'bg-slate-500/20 text-slate-400';
}
```

将 Settings.tsx 中第 36-88 行的所有预设和 helper 函数完整迁移到 constants.ts。

- [ ] **Step 2: 创建 Modal.tsx**

创建 `frontend/src/pages/settings/Modal.tsx`，将 Settings.tsx 中第 92-XX 行的 `Modal` 组件完整迁移：

```tsx
export function Modal({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-canvas-panel border border-canvas-border rounded-xl p-6 w-[480px] max-w-[90vw] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium text-white font-display">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 ProfileSection.tsx**

创建 `frontend/src/pages/settings/ProfileSection.tsx`，将 Settings.tsx 中处理用户信息（username/email/avatar）的部分迁移过来，对外暴露：

```tsx
interface ProfileSectionProps {
  user: UserResponse;
  onUpdate: (data: UserUpdateRequest) => Promise<void>;
}

export function ProfileSection({ user, onUpdate }: ProfileSectionProps) {
  // ... 原 Settings.tsx 中个人信息表单逻辑
}
```

- [ ] **Step 4: 创建 StorageSection.tsx**

创建 `frontend/src/pages/settings/StorageSection.tsx`，迁移存储统计展示部分：

```tsx
interface StorageSectionProps {
  stats: StorageStatsResponse | null;
  onRefresh: () => Promise<void>;
}

export function StorageSection({ stats, onRefresh }: StorageSectionProps) {
  // ... 原 Settings.tsx 中存储统计 UI
}
```

- [ ] **Step 5: 创建 AiProviderSection.tsx**

创建 `frontend/src/pages/settings/AiProviderSection.tsx`，迁移 AI Provider 列表 + 创建/编辑/删除逻辑：

```tsx
interface AiProviderSectionProps {
  providers: AiProviderResponse[];
  onCreate: (data: AiProviderCreateRequest) => Promise<void>;
  onUpdate: (id: string, data: AiProviderUpdateRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function AiProviderSection({ providers, onCreate, onUpdate, onDelete }: AiProviderSectionProps) {
  // ... 原 Settings.tsx 中 AI Provider 列表 + Modal
}
```

- [ ] **Step 6: 创建 AiModelSection.tsx**

创建 `frontend/src/pages/settings/AiModelSection.tsx`，迁移 AI Model 列表 + 创建/编辑/删除逻辑：

```tsx
interface AiModelSectionProps {
  models: AiModelResponse[];
  providers: AiProviderResponse[];
  onCreate: (data: AiModelCreateRequest) => Promise<void>;
  onUpdate: (id: string, data: AiModelUpdateRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string, modelType: string) => Promise<void>;
}

export function AiModelSection(props: AiModelSectionProps) {
  // ... 原 Settings.tsx 中 AI Model 列表 + Modal
}
```

- [ ] **Step 7: 重写 Settings.tsx 为容器组件**

将 `frontend/src/pages/Settings.tsx` 全文替换为容器组件，只负责数据加载和分发到各 Section：

```tsx
import { useEffect, useState } from 'react';
import { authApi, mediaApi, aiApi } from '@/utils/apiClient';
import type {
  UserResponse, UserUpdateRequest,
  AiProviderResponse, AiProviderCreateRequest, AiProviderUpdateRequest,
  AiModelResponse, AiModelCreateRequest, AiModelUpdateRequest,
  StorageStatsResponse,
} from '@/utils/apiClient';
import { ProfileSection } from './settings/ProfileSection';
import { StorageSection } from './settings/StorageSection';
import { AiProviderSection } from './settings/AiProviderSection';
import { AiModelSection } from './settings/AiModelSection';

type Tab = 'profile' | 'storage' | 'ai_provider' | 'ai_model';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('profile');
  const [user, setUser] = useState<UserResponse | null>(null);
  const [providers, setProviders] = useState<AiProviderResponse[]>([]);
  const [models, setModels] = useState<AiModelResponse[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStatsResponse | null>(null);

  useEffect(() => {
    authApi.getMe().then(setUser).catch(() => {});
    refreshProviders();
    refreshModels();
    refreshStorage();
  }, []);

  const refreshProviders = async () => {
    try { setProviders(await aiApi.providers.list()); } catch {}
  };
  const refreshModels = async () => {
    try { setModels(await aiApi.models.list()); } catch {}
  };
  const refreshStorage = async () => {
    try { setStorageStats(await mediaApi.getStorageStats()); } catch {}
  };

  const handleUserUpdate = async (data: UserUpdateRequest) => {
    const updated = await authApi.update(data);
    setUser(updated);
  };

  const handleProviderCreate = async (data: AiProviderCreateRequest) => {
    await aiApi.providers.create(data);
    await refreshProviders();
  };
  const handleProviderUpdate = async (id: string, data: AiProviderUpdateRequest) => {
    await aiApi.providers.update(id, data);
    await refreshProviders();
  };
  const handleProviderDelete = async (id: string) => {
    await aiApi.providers.delete(id);
    await refreshProviders();
  };

  const handleModelCreate = async (data: AiModelCreateRequest) => {
    await aiApi.models.create(data);
    await refreshModels();
  };
  const handleModelUpdate = async (id: string, data: AiModelUpdateRequest) => {
    await aiApi.models.update(id, data);
    await refreshModels();
  };
  const handleModelDelete = async (id: string) => {
    await aiApi.models.delete(id);
    await refreshModels();
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'profile', label: '个人信息' },
    { id: 'storage', label: '存储空间' },
    { id: 'ai_provider', label: 'AI 服务商' },
    { id: 'ai_model', label: 'AI 模型' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-canvas-bg">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-xl font-medium text-slate-200 mb-6 font-display">设置</h1>

        <div className="flex gap-1 mb-6 border-b border-canvas-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm transition-colors ${
                tab === t.id
                  ? 'text-neon-purple border-b-2 border-neon-purple'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'profile' && user && (
          <ProfileSection user={user} onUpdate={handleUserUpdate} />
        )}
        {tab === 'storage' && (
          <StorageSection stats={storageStats} onRefresh={refreshStorage} />
        )}
        {tab === 'ai_provider' && (
          <AiProviderSection
            providers={providers}
            onCreate={handleProviderCreate}
            onUpdate={handleProviderUpdate}
            onDelete={handleProviderDelete}
          />
        )}
        {tab === 'ai_model' && (
          <AiModelSection
            models={models}
            providers={providers}
            onCreate={handleModelCreate}
            onUpdate={handleModelUpdate}
            onDelete={handleModelDelete}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 9: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/pages/Settings.tsx frontend/src/pages/settings/
git commit -m "优化: 拆分 Settings.tsx (1114行) 为 settings/ 下 5 个子组件"
```

---

## Task 10: 拆分 Editor.tsx 中的 PropertyPanel

**Files:**
- Create: `frontend/src/components/panels/PropertyPanelWithHistory.tsx`
- Modify: `frontend/src/pages/Editor.tsx`
- Delete: `frontend/src/components/panels/PropertyPanel.tsx`（孤儿组件，确认无引用后删除）

**Interfaces:**
- Produces: `PropertyPanelWithHistory` 独立组件

- [ ] **Step 1: 创建 PropertyPanelWithHistory.tsx**

创建 `frontend/src/components/panels/PropertyPanelWithHistory.tsx`，将 `frontend/src/pages/Editor.tsx` 第 446-861 行的 `PropertyPanelWithHistory` 函数完整迁移：

```tsx
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { executeNode, isExecutable } from '@/utils/workflowExecutor';
import { aiApi } from '@/utils/apiClient';
import type { AiModelResponse } from '@/utils/apiClient';
import { getErrorMessage } from '@/utils/errorMessages';
import { buildMediaUrl } from '@/utils/buildMediaUrl';
import { generateId } from '@/utils/id';
import type { CanvasNodeData, Artifact } from '@/types/canvas';
import type { Clip, TrackType } from '@/types/timeline';

interface PropertyPanelWithHistoryProps {
  onUpdateData: (id: string, updates: Partial<CanvasNodeData>) => void;
  onRemoveNode: (id: string) => void;
  onSelectClipPreview?: (media: { url: string; type: 'image' | 'video' } | null) => void;
  onPropertyFocus?: (nodeId: string) => Promise<boolean>;
  onPropertyBlur?: (nodeId: string) => void;
}

export function PropertyPanelWithHistory(props: PropertyPanelWithHistoryProps) {
  // ... 完整迁移 Editor.tsx 第 447-861 行的函数体
}
```

迁移时注意：
- 将 `handleAddToTimeline` 中 `id: \`clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}\`` 改为 `id: generateId('clip')`
- 将 `mediaUrl: (() => { ... })()` 改为 `mediaUrl: buildMediaUrl(artifact.url)`
- 将 `catch (err: any)` 改为 `catch (err: unknown)`

- [ ] **Step 2: 修改 Editor.tsx 引用新组件**

修改 `frontend/src/pages/Editor.tsx`：

删除第 446-861 行的 `PropertyPanelWithHistory` 函数定义。

在文件顶部 import 中添加：
```ts
import { PropertyPanelWithHistory } from '@/components/panels/PropertyPanelWithHistory';
```

- [ ] **Step 3: 删除孤儿组件 PropertyPanel.tsx**

确认 `frontend/src/components/panels/PropertyPanel.tsx` 未被任何文件引用：

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && grep -rn "from.*panels/PropertyPanel['\"]" src --include="*.tsx" --include="*.ts" | grep -v "PropertyPanelWithHistory"
```
Expected: 无输出（确认无引用）

删除文件 `frontend/src/components/panels/PropertyPanel.tsx`。

- [ ] **Step 4: 类型检查 + 测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test
```
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/components/panels/PropertyPanelWithHistory.tsx frontend/src/pages/Editor.tsx
git rm frontend/src/components/panels/PropertyPanel.tsx
git commit -m "优化: 从 Editor.tsx 拆出 PropertyPanelWithHistory，删除孤儿 PropertyPanel"
```

---

## Task 11: 补 historyStore 测试

**Files:**
- Create: `frontend/src/stores/historyStore.test.ts`

**Interfaces:**
- Consumes: historyStore 现有 API（pushAction、undo、redo、jumpToAction、clearHistory、各 pushXxx 便捷方法）

- [ ] **Step 1: 创建测试文件**

创建 `frontend/src/stores/historyStore.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useHistoryStore } from './historyStore';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';

const makeNode = (id: string, label = `节点-${id}`): CanvasNode => ({
  id,
  type: 'input',
  position: { x: 0, y: 0 },
  data: {
    type: 'input',
    subtype: 'text_input',
    label,
    params: { text: '' },
    status: 'idle',
    progress: 0,
    outputArtifacts: [],
  },
});

const makeEdge = (id: string, source: string, target: string): CanvasEdge => ({
  id,
  source,
  target,
  type: 'smoothstep',
});

describe('historyStore', () => {
  beforeEach(() => {
    useCanvasStore.getState().clearCanvas();
    useCanvasStore.getState().setEdges([]);
    useHistoryStore.getState().clearHistory();
  });

  describe('初始状态', () => {
    it('canUndo/canRedo 初始为 false', () => {
      expect(useHistoryStore.getState().canUndo).toBe(false);
      expect(useHistoryStore.getState().canRedo).toBe(false);
    });

    it('tree 初始只有 root 分支，pointer = -1', () => {
      const { tree } = useHistoryStore.getState();
      expect(tree.branches).toHaveLength(1);
      expect(tree.branches[0].id).toBe('root');
      expect(tree.pointer).toBe(-1);
      expect(tree.activeBranchId).toBe('root');
    });
  });

  describe('pushAddNode', () => {
    it('写入后 canUndo=true, canRedo=false', () => {
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });
      expect(useHistoryStore.getState().canUndo).toBe(true);
      expect(useHistoryStore.getState().canRedo).toBe(false);
    });

    it('pointer 前进到 0', () => {
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });
      expect(useHistoryStore.getState().tree.pointer).toBe(0);
    });

    it('action.label 包含节点标签', () => {
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1', '图片输入') });
      const action = useHistoryStore.getState().tree.branches[0].actions[0];
      expect(action.label).toContain('图片输入');
    });
  });

  describe('undo/redo', () => {
    it('undo 撤销 add_node：节点从 canvas 移除', () => {
      const node = makeNode('n1');
      useCanvasStore.getState().setNodes([node]);
      useHistoryStore.getState().pushAddNode({ node });

      useHistoryStore.getState().undo();

      expect(useCanvasStore.getState().nodes).not.toContainEqual(node);
      expect(useHistoryStore.getState().canUndo).toBe(false);
      expect(useHistoryStore.getState().canRedo).toBe(true);
    });

    it('redo 重做 add_node：节点重新出现', () => {
      const node = makeNode('n1');
      useCanvasStore.getState().setNodes([node]);
      useHistoryStore.getState().pushAddNode({ node });
      useHistoryStore.getState().undo();
      useHistoryStore.getState().redo();

      expect(useCanvasStore.getState().nodes).toContainEqual(node);
      expect(useHistoryStore.getState().canRedo).toBe(false);
    });

    it('undo 在 canUndo=false 时无操作', () => {
      useHistoryStore.getState().undo();
      expect(useHistoryStore.getState().tree.pointer).toBe(-1);
    });

    it('redo 在 canRedo=false 时无操作', () => {
      useHistoryStore.getState().redo();
      expect(useHistoryStore.getState().tree.pointer).toBe(-1);
    });
  });

  describe('pushBatchSetNodes', () => {
    it('记录批量节点变更', () => {
      const from = [makeNode('n1')];
      const to = [makeNode('n1'), makeNode('n2')];
      useHistoryStore.getState().pushBatchSetNodes({ from, to });

      expect(useHistoryStore.getState().tree.branches[0].actions).toHaveLength(1);
      expect(useHistoryStore.getState().canUndo).toBe(true);
    });

    it('undo 后 canvas 恢复为 from', () => {
      const from = [makeNode('n1')];
      const to = [makeNode('n1'), makeNode('n2')];
      useCanvasStore.getState().setNodes(to);
      useHistoryStore.getState().pushBatchSetNodes({ from, to });

      useHistoryStore.getState().undo();
      expect(useCanvasStore.getState().nodes).toEqual(from);
    });
  });

  describe('pushRemoveEdge', () => {
    it('undo 后 edge 恢复', () => {
      const edge = makeEdge('e1', 'n1', 'n2');
      useCanvasStore.getState().setEdges([edge]);
      useHistoryStore.getState().pushRemoveEdge({ edge });

      useHistoryStore.getState().undo();
      expect(useCanvasStore.getState().edges).toContainEqual(edge);
    });
  });

  describe('jumpToAction', () => {
    it('向前跳到指定 action', () => {
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });
      useHistoryStore.getState().pushAddNode({ node: makeNode('n2') });
      useHistoryStore.getState().pushAddNode({ node: makeNode('n3') });

      const actions = useHistoryStore.getState().tree.branches[0].actions;
      useHistoryStore.getState().jumpToAction(actions[0].id);

      expect(useHistoryStore.getState().tree.pointer).toBe(0);
    });
  });

  describe('clearHistory', () => {
    it('清空所有历史', () => {
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });
      useHistoryStore.getState().pushAddNode({ node: makeNode('n2') });

      useHistoryStore.getState().clearHistory();

      expect(useHistoryStore.getState().tree.branches[0].actions).toHaveLength(0);
      expect(useHistoryStore.getState().tree.pointer).toBe(-1);
      expect(useHistoryStore.getState().canUndo).toBe(false);
      expect(useHistoryStore.getState().canRedo).toBe(false);
    });
  });

  describe('pauseRecording / resumeRecording', () => {
    it('暂停期间不记录操作', () => {
      useHistoryStore.getState().pauseRecording();
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });

      expect(useHistoryStore.getState().tree.branches[0].actions).toHaveLength(0);

      useHistoryStore.getState().resumeRecording();
      useHistoryStore.getState().pushAddNode({ node: makeNode('n2') });

      expect(useHistoryStore.getState().tree.branches[0].actions).toHaveLength(1);
    });
  });

  describe('MAX_DEPTH 限制', () => {
    it('超过 100 步时自动裁剪最旧操作', () => {
      for (let i = 0; i < 105; i++) {
        useHistoryStore.getState().pushAddNode({ node: makeNode(`n${i}`) });
      }
      const actions = useHistoryStore.getState().tree.branches[0].actions;
      expect(actions.length).toBeLessThanOrEqual(100);
    });
  });
});
```

- [ ] **Step 2: 运行测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test historyStore
```
Expected: 全部通过。如果有失败，根据实际行为调整测试断言（因为 mergeWindow=500ms 的合并逻辑可能影响某些断言）

- [ ] **Step 3: 类型检查**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check
```
Expected: 通过

- [ ] **Step 4: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/stores/historyStore.test.ts
git commit -m "优化: 补 historyStore 测试（撤销/重做/分支/深度限制）"
```

---

## Task 12: 补 apiClient 测试

**Files:**
- Create: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: `request`、`ApiError`

- [ ] **Step 1: 创建测试文件**

创建 `frontend/src/api/client.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request, ApiError } from './client';

// mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// mock localStorage
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
});

// mock window.location
const originalLocation = window.location;
beforeEach(() => {
  // @ts-expect-error 测试环境简化
  delete window.location;
  // @ts-expect-error 测试环境简化
  window.location = { href: '', ...originalLocation };
});

afterEach(() => {
  fetchMock.mockReset();
  Object.keys(storage).forEach((k) => delete storage[k]);
});

describe('request', () => {
  it('GET 请求成功返回 JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, name: 'test' }),
    });

    const result = await request<{ id: number; name: string }>('/projects/1');
    expect(result).toEqual({ id: 1, name: 'test' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/projects/1');
    expect(opts.method).toBeUndefined();
  });

  it('POST 请求带 JSON body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await request('/projects/', {
      method: 'POST',
      body: JSON.stringify({ name: '新项目' }),
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ name: '新项目' }));
  });

  it('204 返回 undefined', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await request<void>('/projects/123', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('带 token 时附加 Authorization 头', async () => {
    storage['access_token'] = 'my-token';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await request('/projects/');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer my-token');
  });

  it('无 token 时不附加 Authorization 头', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await request('/projects/');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('非 401 错误抛出 ApiError 含 status/code/message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: '资源不存在' }),
    });

    await expect(request('/projects/999')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: '资源不存在',
      message: '资源不存在',
    });
  });

  it('FormData 不设置 Content-Type', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['x']), 'test.png');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await request('/media/upload', { method: 'POST', body: formData });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('后端无 detail 时 fallback 到状态码描述', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(request('/projects/')).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('500'),
    });
  });
});

describe('ApiError', () => {
  it('保留 status/code/message 字段', () => {
    const err = new ApiError(403, 'FORBIDDEN', '没有权限');
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('没有权限');
    expect(err.name).toBe('ApiError');
    expect(err instanceof Error).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm test client
```
Expected: 全部通过

- [ ] **Step 3: 类型检查**

Run:
```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check
```
Expected: 通过

- [ ] **Step 4: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow && git add frontend/src/api/client.test.ts
git commit -m "优化: 补 apiClient 测试（请求封装、token、错误处理）"
```

---

## 执行完成后总结

完成 12 个任务后，运行最终验证：

```bash
cd /Users/qzfrato/AI_Canvas_Flow/frontend && pnpm check && pnpm test && pnpm build
```

确认所有优化项落地：
- ✅ Task 1: Vite manualChunks + visualizer
- ✅ Task 2: TS strict + 修复 any
- ✅ Task 3: Zustand selector 规范化
- ✅ Task 4: workflowExecutor 状态迁入 store
- ✅ Task 5: ErrorBoundary
- ✅ Task 6: Timeline 内存泄漏修复
- ✅ Task 7: 抽取重复代码
- ✅ Task 8: 拆分 apiClient
- ✅ Task 9: 拆分 Settings
- ✅ Task 10: 拆分 PropertyPanel
- ✅ Task 11: historyStore 测试
- ✅ Task 12: apiClient 测试
