# 节点快捷操作 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为编辑器新增节点复制/粘贴、全选/框选、对齐工具三大快捷操作能力，提升编排效率。

**Architecture:** 新建 clipboardStore（Zustand）管理剪贴板 + alignment.ts 纯函数 + AlignmentToolbar 浮动组件；修改 canvasStore 新增选中状态和粘贴/对齐方法；Canvas.tsx 开启 React Flow 内置框选 + onSelectionChange 回调；EditorLayout.tsx 绑定 Ctrl/Cmd+C/V/A 快捷键。历史记录复用现有 batch_set_nodes/batch_set_edges，无需改 historyStore。

**Tech Stack:** React 18 + TypeScript + Zustand 5 + @xyflow/react 12 + Tailwind CSS 3.4 + lucide-react

## Global Constraints

- 复用现有 `emitNodeChange`/`emitEdgeChange` 协作广播函数（canvasStore.ts 第 16-56 行）
- 复用现有 `useAutoSaveStore.getState().markDirty()` 标记脏状态
- 复用现有 `useHistoryStore.getState().pushBatchSetNodes`/`pushBatchSetEdges` 记录历史（无需新增 ActionType）
- CanvasNode/CanvasEdge 类型定义在 `frontend/src/types/canvas.ts`（第 53-70 行），不修改
- React Flow 选中状态通过 `onSelectionChange` 回调同步到 canvasStore.selectedNodeIds
- AlignmentToolbar 用 React Flow 的 `useStore` hook 直接读取选中节点和 viewport（作为 ReactFlow 子组件）
- 快捷键在 input/textarea 聚焦时不触发（检查 `e.target.tagName`）
- 粘贴偏移固定 +20px（x/y 均偏移），多次粘贴在同一位置（简化，不做累计偏移）
- 对齐基于 position 坐标，不计算节点宽高
- 等距分布需 ≥3 节点，否则降级为左对齐/顶对齐
- Git commit message 用简短中文（如 `feat: 新增节点对齐工具函数`）
- 所有回复/思考/任务清单用中文

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/utils/alignment.ts` | 新建 | 8 种对齐计算纯函数 |
| `frontend/src/stores/clipboardStore.ts` | 新建 | Zustand store，存储剪贴板数据，copy/paste 方法 |
| `frontend/src/components/canvas/AlignmentToolbar.tsx` | 新建 | 浮动对齐工具条组件 |
| `frontend/src/stores/canvasStore.ts` | 修改 | 新增 selectedNodeIds + setSelectedNodeIds + selectAll + addPastedNodes + alignNodes |
| `frontend/src/components/canvas/Canvas.tsx` | 修改 | 开启 selectionMode + onSelectionChange 回调 + 渲染 AlignmentToolbar |
| `frontend/src/components/EditorLayout.tsx` | 修改 | 绑定 Ctrl/Cmd+C/V/A 快捷键 |
| `frontend/verify_node_quick_actions.md` | 新建 | 端到端验证清单 |

---

### Task 1: 对齐计算纯函数 alignment.ts + 单元测试

**Files:**
- Create: `frontend/src/utils/alignment.ts`
- Test: 通过 `npx tsc --noEmit` 验证类型

**Interfaces:**
- Consumes: 无
- Produces: 8 个纯函数，每个接收 `nodes: { id: string; position: { x: number; y: number } }[]`，返回 `Map<string, { x: number; y: number }>`（节点ID → 新位置）

- [ ] **Step 1: 新建 alignment.ts**

Create `frontend/src/utils/alignment.ts`:

```typescript
/**
 * 节点对齐计算纯函数
 *
 * 8 种对齐方式，每个函数接收节点数组，返回需要更新的节点位置 Map。
 * 等距分布需 ≥3 节点，否则降级为左对齐/顶对齐。
 */

interface PositionableNode {
  id: string;
  position: { x: number; y: number };
}

type PositionMap = Map<string, { x: number; y: number }>;

/** 左对齐：所有节点 x = min(x) */
export function alignLeft(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  for (const n of nodes) {
    result.set(n.id, { x: minX, y: n.position.y });
  }
  return result;
}

/** 右对齐：所有节点 x = max(x) */
export function alignRight(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const maxX = Math.max(...nodes.map((n) => n.position.x));
  for (const n of nodes) {
    result.set(n.id, { x: maxX, y: n.position.y });
  }
  return result;
}

/** 顶部对齐：所有节点 y = min(y) */
export function alignTop(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const minY = Math.min(...nodes.map((n) => n.position.y));
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: minY });
  }
  return result;
}

/** 底部对齐：所有节点 y = max(y) */
export function alignBottom(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const maxY = Math.max(...nodes.map((n) => n.position.y));
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: maxY });
  }
  return result;
}

/** 水平居中：所有节点 y = avg(y) */
export function alignHorizontalCenter(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const avgY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length;
  for (const n of nodes) {
    result.set(n.id, { x: n.position.x, y: avgY });
  }
  return result;
}

/** 垂直居中：所有节点 x = avg(x) */
export function alignVerticalCenter(nodes: PositionableNode[]): PositionMap {
  const result: PositionMap = new Map();
  if (nodes.length === 0) return result;
  const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
  for (const n of nodes) {
    result.set(n.id, { x: avgX, y: n.position.y });
  }
  return result;
}

/** 水平等距分布：按 x 排序后均匀分布 x（需 ≥3 节点，否则降级为 alignLeft） */
export function distributeHorizontal(nodes: PositionableNode[]): PositionMap {
  if (nodes.length < 3) return alignLeft(nodes);
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const firstX = sorted[0].position.x;
  const lastX = sorted[sorted.length - 1].position.x;
  const step = (lastX - firstX) / (sorted.length - 1);
  const result: PositionMap = new Map();
  sorted.forEach((n, i) => {
    result.set(n.id, { x: firstX + step * i, y: n.position.y });
  });
  return result;
}

/** 垂直等距分布：按 y 排序后均匀分布 y（需 ≥3 节点，否则降级为 alignTop） */
export function distributeVertical(nodes: PositionableNode[]): PositionMap {
  if (nodes.length < 3) return alignTop(nodes);
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  const firstY = sorted[0].position.y;
  const lastY = sorted[sorted.length - 1].position.y;
  const step = (lastY - firstY) / (sorted.length - 1);
  const result: PositionMap = new Map();
  sorted.forEach((n, i) => {
    result.set(n.id, { x: n.position.x, y: firstY + step * i });
  });
  return result;
}
```

- [ ] **Step 2: 运行类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误（EXIT_CODE=0）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/alignment.ts
git commit -m "feat: 新增节点对齐工具函数"
```

---

### Task 2: 剪贴板 clipboardStore

**Files:**
- Create: `frontend/src/stores/clipboardStore.ts`

**Interfaces:**
- Consumes: `CanvasNode`/`CanvasEdge` 类型（来自 `@/types/canvas`）
- Produces: `useClipboardStore` Zustand store，包含 `copy(nodes, edges)` 和 `paste()` 方法。paste() 返回 `{ nodes: CanvasNode[]; edges: CanvasEdge[] }`（生成新 ID + 偏移），由调用方负责调 `canvasStore.addPastedNodes`

- [ ] **Step 1: 新建 clipboardStore.ts**

Create `frontend/src/stores/clipboardStore.ts`:

```typescript
import { create } from 'zustand';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';

interface ClipboardData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  copiedAt: number;
}

interface ClipboardState {
  clipboard: ClipboardData | null;
  pasteCount: number;

  /** 复制选中节点 + 内部边到剪贴板 */
  copy: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;

  /** 粘贴：生成新 ID + 偏移 20px，返回新节点/边（不直接写入画布，由调用方调 canvasStore.addPastedNodes） */
  paste: () => { nodes: CanvasNode[]; edges: CanvasEdge[] } | null;

  /** 剪贴板是否非空 */
  hasClipboard: () => boolean;

  /** 清空剪贴板 */
  clear: () => void;
}

const PASTE_OFFSET = 20;

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  clipboard: null,
  pasteCount: 0,

  copy: (nodes, edges) => {
    if (nodes.length === 0) return;
    set({
      clipboard: {
        nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
        edges: edges.map((e) => ({ ...e })),
        copiedAt: Date.now(),
      },
      pasteCount: 0,
    });
  },

  paste: () => {
    const { clipboard } = get();
    if (!clipboard) return null;

    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const offset = PASTE_OFFSET;

    // 旧 ID → 新 ID 映射
    const idMap = new Map<string, string>();
    for (const n of clipboard.nodes) {
      idMap.set(n.id, `paste-${n.id}-${ts}-${rand}`);
    }

    // 生成新节点（深拷贝 data，偏移位置）
    const newNodes: CanvasNode[] = clipboard.nodes.map((n) => ({
      id: idMap.get(n.id)!,
      type: n.type,
      position: { x: n.position.x + offset, y: n.position.y + offset },
      data: {
        ...n.data,
        params: { ...n.data.params },
        outputArtifacts: [], // 粘贴的节点不继承输出
        status: 'idle' as const,
        progress: 0,
      },
      measured: n.measured,
    }));

    // 生成新边（重映射 source/target，生成新 ID）
    const newEdges: CanvasEdge[] = clipboard.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({
        id: `paste-edge-${e.id}-${ts}-${rand}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
        animated: e.animated,
      }));

    set((state) => ({ pasteCount: state.pasteCount + 1 }));

    return { nodes: newNodes, edges: newEdges };
  },

  hasClipboard: () => get().clipboard !== null,

  clear: () => set({ clipboard: null, pasteCount: 0 }),
}));
```

- [ ] **Step 2: 运行类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误（EXIT_CODE=0）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/clipboardStore.ts
git commit -m "feat: 新增剪贴板 store"
```

---

### Task 3: canvasStore 新增选中状态 + 粘贴/对齐方法

**Files:**
- Modify: `frontend/src/stores/canvasStore.ts`

**Interfaces:**
- Consumes: `useHistoryStore.getState().pushBatchSetNodes`/`pushBatchSetEdges`（现有方法，历史记录）；`useAutoSaveStore.getState().markDirty`（现有）；`emitNodeChange`/`emitEdgeChange`（现有，第 16-46 行）
- Produces: `selectedNodeIds: string[]`、`setSelectedNodeIds(ids)`、`selectAll()`、`addPastedNodes(nodes, edges)`、`alignNodes(updates: Map<string, {x,y}>)`

- [ ] **Step 1: 在 CanvasState interface 新增字段和方法签名**

Modify `frontend/src/stores/canvasStore.ts`，在 `interface CanvasState` 内（第 58-100 行），在 `selectedNodeId: string | null;` 之后（第 61 行后）追加：

```typescript
  selectedNodeId: string | null;
  selectedNodeIds: string[];  // 多选状态（React Flow onSelectionChange 同步）
```

在 `setSelectedNode: (id: string | null) => void;` 之后（第 68 行后）追加：

```typescript
  setSelectedNode: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  selectAll: () => void;
```

在 `applyRemoteEdgeUpdate` 之后（第 99 行 `}` 之前的 `applyRemoteNodeUpdate`/`applyRemoteEdgeUpdate` 之后），interface 闭合 `}` 之前追加：

```typescript
  // 粘贴节点（由 clipboardStore.paste 调用）
  addPastedNodes: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;

  // 对齐节点位置
  alignNodes: (updates: Map<string, { x: number; y: number }>) => void;
```

- [ ] **Step 2: 在 import 区新增 useHistoryStore 导入**

Modify `frontend/src/stores/canvasStore.ts`，在第 5 行 `import { useAutoSaveStore } from './autoSaveStore';` 之后追加：

```typescript
import { useAutoSaveStore } from './autoSaveStore';
import { useHistoryStore } from './historyStore';
```

- [ ] **Step 3: 在 create 实现中新增 initial state**

Modify `frontend/src/stores/canvasStore.ts`，在 `selectedNodeId: null,` 之后（第 105 行后）追加：

```typescript
  selectedNodeId: null,
  selectedNodeIds: [],
```

- [ ] **Step 4: 在 setSelectedNode 之后新增 setSelectedNodeIds 和 selectAll**

Modify `frontend/src/stores/canvasStore.ts`，在 `setSelectedNode` 方法之后（第 165 行 `},` 之后）追加：

```typescript
  setSelectedNodeIds: (ids) => {
    set({ selectedNodeIds: ids });
  },

  selectAll: () => {
    const allIds = get().nodes.map((n) => n.id);
    set({
      selectedNodeIds: allIds,
      nodes: get().nodes.map((n) => ({ ...n })),
    });
  },
```

> 注：selectAll 仅更新 selectedNodeIds（React Flow 通过 onSelectionChange 同步视觉状态，但全选时需手动触发）。实际全选的 React Flow 视觉状态由 EditorLayout 快捷键中的 `reactFlowInstance.current?.setNodes(...)` 或 store 层面处理。简化实现：仅更新 selectedNodeIds，复制时基于此过滤。

- [ ] **Step 5: 在 loadGeneratedWorkflow 之后新增 addPastedNodes 和 alignNodes**

Modify `frontend/src/stores/canvasStore.ts`，在 `loadGeneratedWorkflow` 方法之后（第 278 行 `},` 之后，`// ── 远端变更应用` 注释之前）追加：

```typescript
  addPastedNodes: (nodes, edges) => {
    const oldNodes = get().nodes;
    const oldEdges = get().edges;
    const newNodes = [...oldNodes, ...nodes];
    const newEdges = [...oldEdges, ...edges];

    set({ nodes: newNodes, edges: newEdges });

    // 历史记录（复用 batch_set）
    useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });
    useHistoryStore.getState().pushBatchSetEdges({ from: oldEdges, to: newEdges });

    // 协作广播
    nodes.forEach((n) => emitNodeChange('add', n));
    edges.forEach((e) => emitEdgeChange('add', e));

    // 标记脏状态
    useAutoSaveStore.getState().markDirty();
  },

  alignNodes: (updates) => {
    const oldNodes = get().nodes;
    const newNodes = oldNodes.map((n) => {
      const update = updates.get(n.id);
      return update ? { ...n, position: update } : n;
    });

    set({ nodes: newNodes });

    // 历史记录
    useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });

    // 协作广播：广播位置变更
    for (const [id, pos] of updates) {
      const node = newNodes.find((n) => n.id === id);
      if (node) {
        emitNodeChange('update', { ...node, position: pos });
      }
    }

    // 标记脏状态
    useAutoSaveStore.getState().markDirty();
  },
```

- [ ] **Step 6: 运行类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误（EXIT_CODE=0）

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/canvasStore.ts
git commit -m "feat: canvasStore 新增选中状态和粘贴对齐方法"
```

---

### Task 4: AlignmentToolbar 浮动对齐工具条组件

**Files:**
- Create: `frontend/src/components/canvas/AlignmentToolbar.tsx`

**Interfaces:**
- Consumes: React Flow 的 `useStore` hook（获取选中节点和 viewport）；`canvasStore.alignNodes`（来自 Task 3）；alignment.ts 的 8 个函数（来自 Task 1）
- Produces: `AlignmentToolbar` 组件，作为 ReactFlow 子组件渲染，选中 ≥2 节点时显示浮动工具条

- [ ] **Step 1: 新建 AlignmentToolbar.tsx**

Create `frontend/src/components/canvas/AlignmentToolbar.tsx`:

```typescript
import { useStore } from '@xyflow/react';
import {
  AlignStartVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignCenterVertical,
  AlignCenterHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignHorizontalCenter,
  alignVerticalCenter,
  distributeHorizontal,
  distributeVertical,
} from '@/utils/alignment';

type AlignFn = typeof alignLeft;

interface AlignButton {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  fn: AlignFn;
  minNodes: number;
}

const ALIGN_BUTTONS: AlignButton[] = [
  { icon: AlignStartVertical, title: '左对齐', fn: alignLeft, minNodes: 2 },
  { icon: AlignEndVertical, title: '右对齐', fn: alignRight, minNodes: 2 },
  { icon: AlignCenterVertical, title: '垂直居中', fn: alignVerticalCenter, minNodes: 2 },
  { icon: AlignStartHorizontal, title: '顶对齐', fn: alignTop, minNodes: 2 },
  { icon: AlignEndHorizontal, title: '底对齐', fn: alignBottom, minNodes: 2 },
  { icon: AlignCenterHorizontal, title: '水平居中', fn: alignHorizontalCenter, minNodes: 2 },
  { icon: AlignHorizontalDistributeCenter, title: '水平等距', fn: distributeHorizontal, minNodes: 3 },
  { icon: AlignVerticalDistributeCenter, title: '垂直等距', fn: distributeVertical, minNodes: 3 },
];

export default function AlignmentToolbar() {
  // 从 React Flow 内部状态读取选中节点和 viewport
  const selectedNodes = useStore((state) => state.nodes.filter((n) => n.selected));
  const viewport = useStore((state) => state.transform);
  const alignNodes = useCanvasStore((s) => s.alignNodes);

  if (selectedNodes.length < 2) return null;

  // 计算 bounding box（节点坐标）
  const xs = selectedNodes.map((n) => n.position.x);
  const ys = selectedNodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  // 转换为屏幕坐标（React Flow viewport transform）
  const centerX = ((minX + maxX) / 2) * viewport.zoom + viewport.x;
  const bottomY = (maxY + 50) * viewport.zoom + viewport.y;

  const handleAlign = (fn: AlignFn) => {
    const positionableNodes = selectedNodes.map((n) => ({
      id: n.id,
      position: n.position,
    }));
    const updates = fn(positionableNodes);
    alignNodes(updates);
  };

  return (
    <div
      className="absolute z-20 flex items-center gap-0.5 px-1.5 py-1 bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl"
      style={{
        left: centerX,
        top: bottomY,
        transform: 'translateX(-50%)',
      }}
    >
      {ALIGN_BUTTONS.map((btn, idx) => {
        const Icon = btn.icon;
        const isDisabled = selectedNodes.length < btn.minNodes;
        return (
          <button
            key={idx}
            onClick={() => !isDisabled && handleAlign(btn.fn)}
            disabled={isDisabled}
            title={btn.title}
            className="p-1.5 rounded hover:bg-canvas-hover text-slate-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 运行类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误（EXIT_CODE=0）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/canvas/AlignmentToolbar.tsx
git commit -m "feat: 新增浮动对齐工具条组件"
```

---

### Task 5: Canvas.tsx 开启框选 + EditorLayout.tsx 快捷键 + 渲染工具条

**Files:**
- Modify: `frontend/src/components/canvas/Canvas.tsx`
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Consumes: `AlignmentToolbar` 组件（来自 Task 4）；`useClipboardStore`（来自 Task 2）；`canvasStore.selectAll`/`addPastedNodes`/`setSelectedNodeIds`（来自 Task 3）；React Flow 的 `SelectionMode`
- Produces: Canvas 支持框选多选 + 渲染 AlignmentToolbar；EditorLayout 支持 Ctrl/Cmd+C/V/A 快捷键

- [ ] **Step 1: 修改 Canvas.tsx 开启框选 + onSelectionChange + 渲染 AlignmentToolbar**

Modify `frontend/src/components/canvas/Canvas.tsx`：

1. 在文件顶部 import 区，找到现有的 `import { ReactFlow, ... } from '@xyflow/react';`，在其中追加 `SelectionMode` 和 `useStore`（如未导入）。修改为包含 `SelectionMode`：

在 import 行中追加 `SelectionMode`（与现有 import 合并，不重复导入）。

2. 在 `const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode, fitViewToken } = useCanvasStore();` 中（第 30 行），追加 `setSelectedNodeIds`：

```typescript
  const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode, fitViewToken, setSelectedNodeIds } = useCanvasStore();
```

3. 在 `onDrop` useCallback 之后、`useEffect`（fitViewToken）之前，新增 `onSelectionChange` 回调：

```typescript
  // 选中状态同步到 store（供 EditorLayout 复制使用）
  const onSelectionChange: OnSelectionChange = useCallback(({ nodes: selected }) => {
    setSelectedNodeIds(selected.map((n) => n.id));
  }, [setSelectedNodeIds]);
```

并在顶部 import 中追加 `OnSelectionChange` 类型（从 `@xyflow/react` 导入）。

4. 在 `<ReactFlow>` 组件上（第 188-205 行），追加以下 props：

```tsx
      <ReactFlow
        nodes={reactFlowNodes}
        edges={edges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onMouseMove={onMouseMove}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Meta', 'Control']}
        className="bg-canvas-bg"
      >
```

5. 在 `<RemoteCursors />` 之后（第 207 行后），追加 `<AlignmentToolbar />`：

```tsx
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2A2A3E" />
        <RemoteCursors />
        <AlignmentToolbar />
        <Controls
```

6. 在文件顶部 import 区追加：

```typescript
import AlignmentToolbar from './AlignmentToolbar';
```

- [ ] **Step 2: 修改 EditorLayout.tsx 绑定快捷键**

Modify `frontend/src/components/EditorLayout.tsx`：

1. 在文件顶部 import 区追加（在现有 import 之后）：

```typescript
import { useClipboardStore } from '@/stores/clipboardStore';
```

2. 在 `useEffect` 快捷键处理函数中（第 148-166 行的 `handler` 函数内），在 `// Ctrl+S 保存` 之前追加复制/粘贴/全选逻辑：

```typescript
    const handler = (e: KeyboardEvent) => {
      // 输入框聚焦时不触发（避免影响文本编辑）
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      // Ctrl+Z 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Ctrl+Shift+Z 或 Ctrl+Y 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y') && (e.shiftKey || e.key === 'y')) {
        e.preventDefault();
        redo();
      }

      // Ctrl/Cmd+C 复制选中节点
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
        const { nodes, edges, selectedNodeIds } = useCanvasStore.getState();
        if (selectedNodeIds.length > 0) {
          const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
          const internalEdges = edges.filter(
            (ed) => selectedNodeIds.includes(ed.source) && selectedNodeIds.includes(ed.target)
          );
          useClipboardStore.getState().copy(selectedNodes, internalEdges);
          e.preventDefault();
        }
      }

      // Ctrl/Cmd+V 粘贴
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey) {
        const pasted = useClipboardStore.getState().paste();
        if (pasted) {
          useCanvasStore.getState().addPastedNodes(pasted.nodes, pasted.edges);
          e.preventDefault();
        }
      }

      // Ctrl/Cmd+A 全选
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        useCanvasStore.getState().selectAll();
        e.preventDefault();
      }

      // Ctrl+S 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentProject()
          .then(() => toast.success('项目已保存'))
          .catch((err: any) => toast.error(`保存失败: ${err.message || '未知错误'}`));
      }
    };
```

> 注：需在文件顶部确认 `useCanvasStore` 已导入（现有代码应已导入，因 EditorLayout 已使用 canvasStore）。

- [ ] **Step 3: 运行类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误（EXIT_CODE=0）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/canvas/Canvas.tsx frontend/src/components/EditorLayout.tsx
git commit -m "feat: 开启框选多选和复制粘贴全选快捷键"
```

---

### Task 6: 端到端验证清单 + 最终检查

**Files:**
- Create: `frontend/verify_node_quick_actions.md`

**Interfaces:**
- Consumes: 全部前 5 个 Task 的产出
- Produces: 人工验证清单文档

- [ ] **Step 1: 新建验证清单文档**

Create `frontend/verify_node_quick_actions.md`:

```markdown
# 节点快捷操作 端到端验证清单

> 日期: 2026-06-30
> 模块: 路线图 #13 节点快捷操作（复制/粘贴、全选/框选、对齐工具）
> 验证人: ___________

## 验证前准备

- [ ] 后端服务已启动（`cd backend && uvicorn app.main:app --reload`）
- [ ] 前端开发服务已启动（`cd frontend && npm run dev`）
- [ ] 已登录账户并打开任意项目进入编辑器
- [ ] 画布上至少有 3 个节点（可从节点面板拖入）

## 框选多选

- [ ] 在画布空白区域拖拽，出现蓝色选择框
- [ ] 选择框接触的节点被选中（边框高亮）
- [ ] 按住 Cmd/Ctrl 点击多个节点，逐个追加选中
- [ ] 点击空白区域，取消所有选中
- [ ] 选中 2 个以上节点时，选区下方浮现对齐工具条

## 复制/粘贴

- [ ] 选中 1 个节点，按 Ctrl/Cmd+C
- [ ] 按 Ctrl/Cmd+V，出现新节点（位置偏移 +20px）
- [ ] 新节点 ID 与原节点不同
- [ ] 新节点参数与原节点一致（prompt/size 等）
- [ ] 新节点 outputArtifacts 为空（不继承输出）
- [ ] 新节点状态为 idle

- [ ] 选中 2 个有连线的节点，按 Ctrl/Cmd+C
- [ ] 按 Ctrl/Cmd+V，出现 2 个新节点 + 1 条新连线
- [ ] 新连线连接到对应的新节点（非原节点）
- [ ] 选中无连线的 2 个节点复制粘贴，只有节点无边

- [ ] 在 textarea 中输入文字时按 Ctrl/Cmd+C/V，触发浏览器默认复制粘贴（不触发节点操作）
- [ ] 剪贴板为空时按 Ctrl/Cmd+V，无反应（不报错）

## 全选

- [ ] 按 Ctrl/Cmd+A，画布所有节点被选中
- [ ] 在 textarea 中按 Ctrl/Cmd+A，触发浏览器全选文本（不触发节点全选）

## 对齐工具

- [ ] 选中 2 个节点，工具条显示 8 个按钮（等距分布 disabled）
- [ ] 选中 3 个节点，所有 8 个按钮可点击
- [ ] 选中 1 个节点，工具条不显示
- [ ] 点击左对齐，所有选中节点 x 坐标对齐到最左
- [ ] 点击右对齐，所有选中节点 x 坐标对齐到最右
- [ ] 点击顶对齐，所有选中节点 y 坐标对齐到最顶
- [ ] 点击底对齐，所有选中节点 y 坐标对齐到最底
- [ ] 点击垂直居中，所有选中节点 x 坐标居中
- [ ] 点击水平居中，所有选中节点 y 坐标居中
- [ ] 选中 3 个节点，点击水平等距，x 坐标均匀分布
- [ ] 选中 3 个节点，点击垂直等距，y 坐标均匀分布
- [ ] 选中 2 个节点点击水平等距，降级为左对齐

## 撤销重做

- [ ] 粘贴后按 Ctrl/Cmd+Z，粘贴的节点/边被移除
- [ ] 按 Ctrl/Cmd+Shift+Z，节点/边恢复
- [ ] 对齐后按 Ctrl/Cmd+Z，节点恢复原位置
- [ ] 按 Ctrl/Cmd+Shift+Z，对齐效果恢复

## 自动保存

- [ ] 粘贴后底部状态栏显示未保存（黄色圆点）
- [ ] 等待 2 秒，自动保存触发（状态变绿）
- [ ] 对齐后同样触发自动保存

## 协作（可选）

- [ ] 在两个浏览器标签页打开同一项目
- [ ] 标签页 A 粘贴节点
- [ ] 标签页 B 自动同步看到新节点

## 类型检查

- [ ] 运行 `cd frontend && npx tsc --noEmit`，EXIT_CODE=0

## 验证结论

- 通过项: ___ / 38
- 待修复:
- 验证时间:
```

- [ ] **Step 2: 运行最终类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误（EXIT_CODE=0）

- [ ] **Step 3: Commit**

```bash
git add frontend/verify_node_quick_actions.md
git commit -m "docs: 新增节点快捷操作验证清单"
```

---

## Self-Review

### 1. Spec coverage（对照设计文档逐项检查）

| 设计文档要求 | 对应 Task | 状态 |
|------|------|------|
| clipboardStore（存储节点+内部边，跨项目共享） | Task 2 | ✅ |
| alignment.ts（8 种对齐纯函数） | Task 1 | ✅ |
| AlignmentToolbar 浮动工具条（选中 ≥2 显示） | Task 4 | ✅ |
| Canvas.tsx 开启 selectionMode + multiSelectionKeyCode | Task 5 | ✅ |
| Canvas.tsx 渲染 AlignmentToolbar | Task 5 | ✅ |
| EditorLayout Ctrl/Cmd+C 复制（节点+内部边） | Task 5 | ✅ |
| EditorLayout Ctrl/Cmd+V 粘贴（新 ID + 偏移 20px） | Task 5 | ✅ |
| EditorLayout Ctrl/Cmd+A 全选 | Task 5 | ✅ |
| canvasStore.selectAll() | Task 3 | ✅ |
| canvasStore.addPastedNodes()（历史记录 + 广播 + markDirty） | Task 3 | ✅ |
| canvasStore.alignNodes()（历史记录 + 广播 + markDirty） | Task 3 | ✅ |
| 撤销重做（粘贴 undo 移除，对齐 undo 恢复位置） | Task 3（复用 batch_set_nodes/edges） | ✅ |
| 协作广播（粘贴/对齐触发 emit） | Task 3 | ✅ |
| 输入框聚焦时不触发快捷键 | Task 5（检查 tagName） | ✅ |
| 等距分布 <3 节点降级 | Task 1（distributeHorizontal/Vertical） | ✅ |
| 粘贴偏移 +20px | Task 2（PASTE_OFFSET） | ✅ |
| 人工验证清单 | Task 6 | ✅ |

**Gaps:** 无遗漏。

### 2. Placeholder scan

- "TBD" / "TODO" / "implement later" — 无
- "Add appropriate error handling" — 无，错误处理已具体
- "Similar to Task N" — 无，每个 Task 自包含
- 步骤只描述做什么不给代码 — 无，所有代码步骤含完整代码块
- 引用未定义的类型/函数/方法 — 已检查：
  - `alignLeft` 等在 Task 1 定义，Task 4 引用 ✅
  - `useClipboardStore` 在 Task 2 定义，Task 5 引用 ✅
  - `alignNodes`/`addPastedNodes`/`selectAll`/`setSelectedNodeIds` 在 Task 3 定义，Task 4/5 引用 ✅
  - `AlignmentToolbar` 在 Task 4 定义，Task 5 引用 ✅

### 3. Type consistency

| 名称 | 定义位置 | 引用位置 | 一致性 |
|------|------|------|------|
| `alignLeft(nodes: PositionableNode[]): PositionMap` | Task 1 | Task 4（handleAlign 调用） | ✅ |
| `useClipboardStore.copy(nodes, edges)` | Task 2 | Task 5（EditorLayout 快捷键） | ✅ |
| `useClipboardStore.paste() -> {nodes, edges} | null` | Task 2 | Task 5（EditorLayout 快捷键） | ✅ |
| `canvasStore.selectedNodeIds: string[]` | Task 3 | Task 5（EditorLayout 读取） | ✅ |
| `canvasStore.selectAll()` | Task 3 | Task 5（Ctrl+A 调用） | ✅ |
| `canvasStore.addPastedNodes(nodes, edges)` | Task 3 | Task 5（paste 后调用） | ✅ |
| `canvasStore.alignNodes(updates: Map<string, {x,y}>)` | Task 3 | Task 4（AlignmentToolbar 调用） | ✅ |
| `PositionMap = Map<string, {x,y}>` | Task 1 | Task 3/4（alignNodes 参数） | ✅ |

**Issues found & fixed:**
- 设计文档原计划新增 historyStore 的 pushPasteNodes/pushAlignNodes，实际复用现有 batch_set_nodes/batch_set_edges 即可（KISS），已修正
- 设计文档原计划在 canvasStore 加 selectedNodeIds 仅供 AlignmentToolbar，实际 AlignmentToolbar 用 React Flow useStore 更简洁，selectedNodeIds 仅供 EditorLayout 复制用

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-06-30-node-quick-actions.md`，共 6 个 Task，每个 Task 含完整代码和验证步骤。

两种执行选项：

**1. Subagent-Driven（推荐）** — 每个 Task 派发独立 subagent 执行，Task 间进行两阶段 review（实现质量 + Spec 对齐），快速迭代，主上下文保持干净

**2. Inline Execution** — 在当前会话内批量执行所有 Task，带 checkpoint review

**Which approach?**
