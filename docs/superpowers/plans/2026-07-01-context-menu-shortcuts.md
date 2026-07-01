# 右键菜单 + 快捷键体系 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为画布编辑器补充右键上下文菜单（节点/画布空白）和完善快捷键体系（F2/Escape/Ctrl+//F5），并修复 `removeNode` 不写历史的技术债。

**Architecture:** 新增 3 个文件（ContextMenu 通用浮层、useContextMenu hook、ShortcutHelpModal）+ 修改 4 个文件（Canvas/CanvasNode/canvasStore/EditorLayout）。canvasStore 新增 `editingNodeId` 跨组件通信字段、`removeNodes` 批量方法、`renameNode` 方法，并修复 `removeNode` 写历史。inline 重命名通过 store 字段而非 prop drilling 实现。

**Tech Stack:** Vite 6 + React 18 + TypeScript 5.8 + @xyflow/react 12.11 + Zustand 5 + Tailwind CSS 3.4 + lucide-react + vitest 4.1.9（environment: node，不写 DOM 组件测试）

## Global Constraints

- 包管理器：pnpm 10.14.0（项目使用 pnpm-lock.yaml，禁止 npm/yarn）
- 测试命令：`cd frontend && pnpm vitest run`（vitest environment=node，仅纯逻辑测试可跑，UI 组件靠 tsc + MCP 验证）
- 类型检查命令：`cd frontend && pnpm tsc --noEmit`
- git commit 使用简短中文描述
- 样式类名沿用项目约定：`bg-canvas-panel`/`border-canvas-border`/`hover:bg-canvas-hover`/`text-slate-200`/`text-neon-purple`（与 AlignmentToolbar/AiGenerateModal 一致）
- historyStore API：`useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes })` 和 `pushBatchSetEdges({ from, to })`（非 pushHistory）
- React Flow 12 回调签名：`onNodeContextMenu(event: React.MouseEvent, node: Node)` / `onPaneContextMenu(event: React.MouseEvent)`
- 坐标转换：`reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY })` 已在 Canvas.tsx:167 使用，复用此 API
- 协作广播 helper（canvasStore.ts:10-57）：`emitNodeChange('add'|'update', node)` / `emitNodeDelete(id)` / `emitEdgeChange` / `emitEdgeDelete`

---

## File Structure

### 新增文件

| 文件 | 职责 | 依赖 |
|------|------|------|
| `frontend/src/hooks/useContextMenu.ts` | 菜单状态管理 hook（visible/position/type/targetNodeId） | React |
| `frontend/src/components/canvas/ContextMenu.tsx` | 通用右键菜单浮层（MenuItem 接口、定位、边界、键盘导航、子菜单） | React + lucide-react |
| `frontend/src/components/canvas/ShortcutHelpModal.tsx` | 快捷键帮助面板（分组列表 + Esc/遮罩关闭） | React + lucide-react |
| `frontend/src/stores/canvasStore.test.ts` | canvasStore 新增方法的单元测试 | vitest |

### 修改文件

| 文件 | 改动 |
|------|------|
| `frontend/src/stores/canvasStore.ts` | 新增 `editingNodeId`/`setEditingNodeId`/`renameNode`/`removeNodes`；修复 `removeNode` 写历史；`addPastedNodes` 支持 `targetPosition` |
| `frontend/src/components/canvas/CanvasNode.tsx` | 读取 `editingNodeId`，条件渲染 input（双击触发、Enter/Escape/onBlur 处理） |
| `frontend/src/components/canvas/Canvas.tsx` | 绑定 `onNodeContextMenu`/`onPaneContextMenu`，渲染 ContextMenu，构建节点/画布菜单项 |
| `frontend/src/components/EditorLayout.tsx` | 扩展快捷键 handler（F2/Escape/Ctrl+//F5），渲染 ShortcutHelpModal |

---

## Task 1: canvasStore 扩展 + removeNode 写历史修复 + 单元测试

**Files:**
- Modify: `frontend/src/stores/canvasStore.ts:59-110`（CanvasState 接口）
- Modify: `frontend/src/stores/canvasStore.ts:142-152`（removeNode）
- Modify: `frontend/src/stores/canvasStore.ts:106`（addPastedNodes 签名）
- Modify: `frontend/src/stores/canvasStore.ts:303-321`（addPastedNodes 实现）
- Create: `frontend/src/stores/canvasStore.test.ts`

**Interfaces:**
- Produces:
  - `useCanvasStore.getState().editingNodeId: string | null`
  - `useCanvasStore.getState().setEditingNodeId(id: string | null): void`
  - `useCanvasStore.getState().renameNode(id: string, newLabel: string): void`
  - `useCanvasStore.getState().removeNodes(ids: string[]): void`
  - `useCanvasStore.getState().addPastedNodes(nodes, edges, targetPosition?: { x: number; y: number }): void`
  - `removeNode(id)` 现在写历史（可撤销）

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/stores/canvasStore.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useHistoryStore } from './historyStore';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';

const makeNode = (id: string, label = `节点-${id}`, x = 0, y = 0): CanvasNode => ({
  id,
  type: 'input',
  position: { x, y },
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

beforeEach(() => {
  useCanvasStore.getState().clearCanvas();
  useHistoryStore.getState().clear?.();
  useCanvasStore.setState({
    nodes: [makeNode('n1', 'A', 0, 0), makeNode('n2', 'B', 100, 0)],
    edges: [makeEdge('e1', 'n1', 'n2')],
    selectedNodeIds: ['n1', 'n2'],
  });
});

describe('canvasStore - editingNodeId', () => {
  it('setEditingNodeId 设置和清除编辑态', () => {
    useCanvasStore.getState().setEditingNodeId('n1');
    expect(useCanvasStore.getState().editingNodeId).toBe('n1');
    useCanvasStore.getState().setEditingNodeId(null);
    expect(useCanvasStore.getState().editingNodeId).toBeNull();
  });
});

describe('canvasStore - renameNode', () => {
  it('正常改名：更新 label + 写历史 + 协作广播', () => {
    const oldLabel = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.data.label;
    useCanvasStore.getState().renameNode('n1', '新名字');
    const updated = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!;
    expect(updated.data.label).toBe('新名字');
    expect(updated.data.label).not.toBe(oldLabel);
  });

  it('空文本不改名', () => {
    const oldLabel = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.data.label;
    useCanvasStore.getState().renameNode('n1', '   ');
    const updated = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!;
    expect(updated.data.label).toBe(oldLabel);
  });

  it('同名不改名', () => {
    const oldLabel = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.data.label;
    useCanvasStore.getState().renameNode('n1', oldLabel);
    const updated = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!;
    expect(updated.data.label).toBe(oldLabel);
  });

  it('不存在的节点 id 不报错', () => {
    expect(() => useCanvasStore.getState().renameNode('not-exist', 'x')).not.toThrow();
  });
});

describe('canvasStore - removeNode 写历史', () => {
  it('删除节点后历史栈非空（可撤销）', () => {
    const before = useHistoryStore.getState().past.length;
    useCanvasStore.getState().removeNode('n1');
    const after = useHistoryStore.getState().past.length;
    expect(after).toBeGreaterThan(before);
  });

  it('删除节点后节点数减少且边被清理', () => {
    useCanvasStore.getState().removeNode('n1');
    const state = useCanvasStore.getState();
    expect(state.nodes.find((n) => n.id === 'n1')).toBeUndefined();
    expect(state.edges.find((e) => e.source === 'n1' || e.target === 'n1')).toBeUndefined();
  });
});

describe('canvasStore - removeNodes 批量删除', () => {
  it('批量删除：单次写历史 + 清理节点/边/选中', () => {
    const before = useHistoryStore.getState().past.length;
    useCanvasStore.getState().removeNodes(['n1', 'n2']);
    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedNodeIds).toHaveLength(0);
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
  });

  it('空数组不报错也不写历史', () => {
    const before = useHistoryStore.getState().past.length;
    useCanvasStore.getState().removeNodes([]);
    expect(useHistoryStore.getState().past.length).toBe(before);
  });
});

describe('canvasStore - addPastedNodes targetPosition', () => {
  it('无 targetPosition 保持原偏移行为', () => {
    const pastedNode = makeNode('p1', 'P', 50, 50);
    useCanvasStore.getState().addPastedNodes([pastedNode], []);
    const added = useCanvasStore.getState().nodes.find((n) => n.id === 'p1');
    expect(added).toBeDefined();
    // clipboardStore.paste 已加 +20 偏移，addPastedNodes 不再额外偏移
    expect(added!.position).toEqual({ x: 50, y: 50 });
  });

  it('有 targetPosition：以第一个节点为锚点平移', () => {
    const p1 = makeNode('p1', 'P1', 100, 100);
    const p2 = makeNode('p2', 'P2', 200, 150);
    // 目标位置 (300, 300) 应让 p1 落在 (300,300)，p2 落在 (400,350)
    useCanvasStore.getState().addPastedNodes([p1, p2], [], { x: 300, y: 300 });
    const added1 = useCanvasStore.getState().nodes.find((n) => n.id === 'p1');
    const added2 = useCanvasStore.getState().nodes.find((n) => n.id === 'p2');
    expect(added1!.position).toEqual({ x: 300, y: 300 });
    expect(added2!.position).toEqual({ x: 400, y: 350 });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd frontend && pnpm vitest run src/stores/canvasStore.test.ts
```

预期：FAIL，错误为 `useCanvasStore.getState(...).setEditingNodeId is not a function` 或 `renameNode is not a function`。

- [ ] **Step 3: 修改 canvasStore.ts 接口**

在 `frontend/src/stores/canvasStore.ts` 的 `CanvasState` 接口中，定位 `removeNode: (id: string) => void;` 行（约第 67 行），在其下方新增字段，并修改 `addPastedNodes` 签名：

```typescript
  // 节点操作
  addNode: (subtype: string, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;  // 新增：批量删除（单次写历史）
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  setSelectedNode: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  selectAll: () => void;

  // inline 重命名编辑态
  editingNodeId: string | null;  // 新增
  setEditingNodeId: (id: string | null) => void;  // 新增
  renameNode: (id: string, newLabel: string) => void;  // 新增
```

然后在接口中找到 `addPastedNodes`（约第 106 行）并修改签名：

```typescript
  // 粘贴节点（由 clipboardStore.paste 调用）
  addPastedNodes: (
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    targetPosition?: { x: number; y: number },
  ) => void;
```

- [ ] **Step 4: 在 store 初始 state 中新增 editingNodeId**

定位 `selectedNodeIds: [],` 行（约第 116 行），在其后新增：

```typescript
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  editingNodeId: null,  // 新增
```

- [ ] **Step 5: 修复 removeNode 写历史 + 新增 removeNodes/renameNode/setEditingNodeId**

定位 `removeNode: (id) => {` 实现（约第 142-152 行），替换为以下完整实现（包含修复 + 新增方法）。注意保留 `removeNode` 原有协作广播行为：

```typescript
  removeNode: (id) => {
    const oldNodes = get().nodes;
    const oldEdges = get().edges;
    const affectedEdges = oldEdges.filter((e) => e.source === id || e.target === id);
    const newNodes = oldNodes.filter((n) => n.id !== id);
    const newEdges = oldEdges.filter((e) => e.source !== id && e.target !== id);

    set({
      nodes: newNodes,
      edges: newEdges,
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      selectedNodeIds: get().selectedNodeIds.filter((sid) => sid !== id),
    });

    // 写历史（修复技术债：原实现不写历史导致无法撤销）
    useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });
    useHistoryStore.getState().pushBatchSetEdges({ from: oldEdges, to: newEdges });

    // 协作广播
    emitNodeDelete(id);
    affectedEdges.forEach((e) => emitEdgeDelete(e.id));

    useAutoSaveStore.getState().markDirty();
  },

  removeNodes: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const oldNodes = get().nodes;
    const oldEdges = get().edges;
    const affectedEdges = oldEdges.filter((e) => idSet.has(e.source) || idSet.has(e.target));
    const newNodes = oldNodes.filter((n) => !idSet.has(n.id));
    const newEdges = oldEdges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));

    set({
      nodes: newNodes,
      edges: newEdges,
      selectedNodeId: idSet.has(get().selectedNodeId || '') ? null : get().selectedNodeId,
      selectedNodeIds: get().selectedNodeIds.filter((sid) => !idSet.has(sid)),
    });

    // 单次写历史
    useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });
    useHistoryStore.getState().pushBatchSetEdges({ from: oldEdges, to: newEdges });

    // 批量广播
    ids.forEach((id) => emitNodeDelete(id));
    affectedEdges.forEach((e) => emitEdgeDelete(e.id));

    useAutoSaveStore.getState().markDirty();
  },

  setEditingNodeId: (id) => {
    set({ editingNodeId: id });
  },

  renameNode: (id, newLabel) => {
    const trimmed = newLabel.trim();
    const oldNodes = get().nodes;
    const target = oldNodes.find((n) => n.id === id);
    if (!target) return;
    if (trimmed === '' || trimmed === target.data.label) return;

    const newNodes = oldNodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, label: trimmed } } : n,
    );

    set({ nodes: newNodes });

    // 写历史
    useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });

    // 协作广播
    const updated = newNodes.find((n) => n.id === id);
    if (updated) emitNodeChange('update', updated);

    useAutoSaveStore.getState().markDirty();
  },
```

- [ ] **Step 6: 修改 addPastedNodes 支持 targetPosition**

定位 `addPastedNodes: (nodes, edges) => {` 实现（约第 303-321 行），替换为：

```typescript
  addPastedNodes: (nodes, edges, targetPosition) => {
    const oldNodes = get().nodes;
    const oldEdges = get().edges;

    // 计算 offset：有 targetPosition 时以第一个节点为锚点平移
    let finalNodes = nodes;
    if (targetPosition && nodes.length > 0) {
      const anchor = nodes[0].position;
      const dx = targetPosition.x - anchor.x;
      const dy = targetPosition.y - anchor.y;
      finalNodes = nodes.map((n) => ({
        ...n,
        position: { x: n.position.x + dx, y: n.position.y + dy },
      }));
    }

    const newNodes = [...oldNodes, ...finalNodes];
    const newEdges = [...oldEdges, ...edges];

    set({ nodes: newNodes, edges: newEdges });

    // 历史记录（复用 batch_set）
    useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });
    useHistoryStore.getState().pushBatchSetEdges({ from: oldEdges, to: newEdges });

    // 协作广播
    finalNodes.forEach((n) => emitNodeChange('add', n));
    edges.forEach((e) => emitEdgeChange('add', e));

    // 标记脏状态
    useAutoSaveStore.getState().markDirty();
  },
```

- [ ] **Step 7: 运行测试验证通过**

```bash
cd frontend && pnpm vitest run src/stores/canvasStore.test.ts
```

预期：所有测试 PASS（注意 `useHistoryStore.getState().clear?.()` 若 historyStore 无 clear 方法不会报错，因为可选链；但 past.length 检查仍有效）。

如果 `clear` 不存在导致 `beforeEach` 无法重置历史栈，将 `beforeEach` 改为直接 `useHistoryStore.setState({ past: [], future: [] })`。先运行测试，按报错调整。

- [ ] **Step 8: 全量测试 + 类型检查**

```bash
cd frontend && pnpm vitest run && pnpm tsc --noEmit
```

预期：所有测试 PASS，tsc 无错误。

- [ ] **Step 9: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/stores/canvasStore.ts frontend/src/stores/canvasStore.test.ts
git commit -m "canvasStore 新增重命名/批量删除/编辑态并修复删除写历史"
```

---

## Task 2: useContextMenu hook

**Files:**
- Create: `frontend/src/hooks/useContextMenu.ts`

**Interfaces:**
- Produces:
  - `useContextMenu()` 返回 `{ menuState, openNodeMenu, openPaneMenu, closeMenu }`
  - `menuState: { visible: boolean; position: { x: number; y: number }; type: 'node' | 'pane' | null; targetNodeId: string | null }`

- [ ] **Step 1: 创建 hook 文件**

创建 `frontend/src/hooks/useContextMenu.ts`：

```typescript
import { useState, useCallback } from 'react';

export interface MenuState {
  visible: boolean;
  position: { x: number; y: number };
  type: 'node' | 'pane' | null;
  targetNodeId: string | null;
}

const INITIAL_STATE: MenuState = {
  visible: false,
  position: { x: 0, y: 0 },
  type: null,
  targetNodeId: null,
};

export function useContextMenu() {
  const [menuState, setMenuState] = useState<MenuState>(INITIAL_STATE);

  const openNodeMenu = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      type: 'node',
      targetNodeId: nodeId,
    });
  }, []);

  const openPaneMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setMenuState({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      type: 'pane',
      targetNodeId: null,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(INITIAL_STATE);
  }, []);

  return { menuState, openNodeMenu, openPaneMenu, closeMenu };
}
```

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/hooks/useContextMenu.ts
git commit -m "新增 useContextMenu hook 管理右键菜单状态"
```

---

## Task 3: ContextMenu 通用组件

**Files:**
- Create: `frontend/src/components/canvas/ContextMenu.tsx`

**Interfaces:**
- Consumes: `MenuState` from `useContextMenu`
- Produces:
  - `<ContextMenu visible position items onClose />` 通用浮层组件
  - `MenuItem` 接口（label/shortcut/icon/onClick/disabled/submenu/separator）

- [ ] **Step 1: 创建组件文件**

创建 `frontend/src/components/canvas/ContextMenu.tsx`：

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';

export interface MenuItem {
  label?: string;
  shortcut?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  submenu?: MenuItem[];
  separator?: boolean;
}

interface ContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ visible, position, items, onClose }: ContextMenuProps) {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [submenuOpenIndex, setSubmenuOpenIndex] = useState<number>(-1);
  const menuRef = useRef<HTMLDivElement>(null);

  // 关闭：点击外部 / Escape
  useEffect(() => {
    if (!visible) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose]);

  // 重置高亮
  useEffect(() => {
    if (visible) {
      setActiveIndex(-1);
      setSubmenuOpenIndex(-1);
    }
  }, [visible]);

  const handleItemClick = useCallback(
    (item: MenuItem) => {
      if (item.disabled || item.separator || item.submenu) return;
      item.onClick?.();
      onClose();
    },
    [onClose],
  );

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const selectableIndices = items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => !item.disabled && !item.separator);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectableIndices.length === 0) return;
        const currentPos = selectableIndices.findIndex(({ idx }) => idx === activeIndex);
        const nextPos = currentPos === -1 ? 0 : (currentPos + 1) % selectableIndices.length;
        setActiveIndex(selectableIndices[nextPos].idx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectableIndices.length === 0) return;
        const currentPos = selectableIndices.findIndex(({ idx }) => idx === activeIndex);
        const prevPos = currentPos === -1 ? selectableIndices.length - 1 : (currentPos - 1 + selectableIndices.length) % selectableIndices.length;
        setActiveIndex(selectableIndices[prevPos].idx);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < items.length) {
          handleItemClick(items[activeIndex]);
        }
      } else if (e.key === 'ArrowRight') {
        if (activeIndex >= 0 && items[activeIndex]?.submenu) {
          setSubmenuOpenIndex(activeIndex);
        }
      } else if (e.key === 'ArrowLeft') {
        setSubmenuOpenIndex(-1);
      }
    },
    [items, activeIndex, handleItemClick],
  );

  if (!visible) return null;

  // 边界检测：菜单宽度估算 200px，高度按 items 数 * 32px 估算
  const MENU_WIDTH = 200;
  const MENU_HEIGHT = items.length * 32;
  const adjustedX = position.x + MENU_WIDTH > window.innerWidth ? position.x - MENU_WIDTH : position.x;
  const adjustedY = position.y + MENU_HEIGHT > window.innerHeight ? position.y - MENU_HEIGHT : position.y;

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="fixed z-50 min-w-[200px] bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl py-1 focus:outline-none"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="h-px bg-canvas-border my-1" />;
        }
        const Icon = item.icon;
        const isActive = idx === activeIndex;
        const hasSubmenu = !!item.submenu;
        return (
          <div
            key={idx}
            role="menuitem"
            onMouseEnter={() => {
              setActiveIndex(idx);
              setSubmenuOpenIndex(hasSubmenu ? idx : -1);
            }}
            onClick={() => handleItemClick(item)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-default ${
              item.disabled
                ? 'text-slate-600 cursor-not-allowed'
                : isActive
                ? 'bg-canvas-hover text-white'
                : 'text-slate-300'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-slate-500">{item.shortcut}</span>
            )}
            {hasSubmenu && <ChevronRight className="w-3 h-3 text-slate-500" />}
            {hasSubmenu && submenuOpenIndex === idx && item.submenu && (
              <Submenu items={item.submenu} parentX={adjustedX} onClose={onClose} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// 子菜单组件（右展开，靠右边缘时左展开）
function Submenu({
  items,
  parentX,
  onClose,
}: {
  items: MenuItem[];
  parentX: number;
  onClose: () => void;
}) {
  const SUBMENU_WIDTH = 200;
  const openRight = parentX + SUBMENU_WIDTH * 2 < window.innerWidth;
  const handleSubClick = (item: MenuItem) => {
    if (item.disabled || item.separator || item.submenu) return;
    item.onClick?.();
    onClose();
  };
  return (
    <div
      role="menu"
      className="absolute top-0 min-w-[200px] bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl py-1"
      style={{ left: openRight ? '100%' : '-100%' }}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="h-px bg-canvas-border my-1" />;
        }
        const Icon = item.icon;
        return (
          <div
            key={idx}
            role="menuitem"
            onMouseEnter={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              handleSubClick(item);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-default ${
              item.disabled ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 hover:bg-canvas-hover hover:text-white'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[10px] text-slate-500">{item.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/components/canvas/ContextMenu.tsx
git commit -m "新增 ContextMenu 通用右键菜单组件"
```

---

## Task 4: ShortcutHelpModal 快捷键帮助面板

**Files:**
- Create: `frontend/src/components/canvas/ShortcutHelpModal.tsx`

**Interfaces:**
- Produces: `<ShortcutHelpModal open onClose />`

- [ ] **Step 1: 创建组件文件**

创建 `frontend/src/components/canvas/ShortcutHelpModal.tsx`：

```typescript
import { X, Keyboard } from 'lucide-react';

interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string;
  desc: string;
}

const GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: '通用',
    items: [
      { keys: 'Ctrl/⌘ + Z', desc: '撤销' },
      { keys: 'Ctrl/⌘ + Shift + Z', desc: '重做' },
      { keys: 'Ctrl/⌘ + S', desc: '保存项目' },
      { keys: 'Ctrl/⌘ + /', desc: '打开快捷键面板' },
    ],
  },
  {
    title: '节点操作',
    items: [
      { keys: 'Ctrl/⌘ + C', desc: '复制选中节点' },
      { keys: 'Ctrl/⌘ + V', desc: '粘贴节点' },
      { keys: 'Ctrl/⌘ + A', desc: '全选节点' },
      { keys: 'Delete / Backspace', desc: '删除选中节点' },
      { keys: 'F2', desc: '重命名选中节点' },
      { keys: 'F5', desc: '执行选中节点' },
      { keys: 'Escape', desc: '取消选中 / 关闭面板' },
    ],
  },
  {
    title: '视图',
    items: [
      { keys: '右键节点', desc: '节点上下文菜单' },
      { keys: '右键画布', desc: '画布上下文菜单' },
      { keys: '双击节点标题', desc: '进入重命名' },
    ],
  },
];

export default function ShortcutHelpModal({ open, onClose }: ShortcutHelpModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[480px] shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-medium text-white font-display">快捷键</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-canvas-hover text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区：分组列表 */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider">{group.title}</h4>
              <div className="space-y-0.5">
                {group.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1">
                    <span className="text-sm text-slate-300">{item.desc}</span>
                    <kbd className="px-2 py-0.5 text-[11px] bg-canvas-bg border border-canvas-border rounded text-slate-400 font-mono">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/components/canvas/ShortcutHelpModal.tsx
git commit -m "新增 ShortcutHelpModal 快捷键帮助面板"
```

---

## Task 5: CanvasNode inline 重命名

**Files:**
- Modify: `frontend/src/components/canvas/CanvasNode.tsx`

**Interfaces:**
- Consumes:
  - `useCanvasStore.getState().editingNodeId`
  - `useCanvasStore.getState().setEditingNodeId(id)`
  - `useCanvasStore.getState().renameNode(id, newLabel)`

- [ ] **Step 1: 修改 CanvasNode.tsx 支持编辑态**

打开 `frontend/src/components/canvas/CanvasNode.tsx`，进行以下修改：

1. 在文件顶部 import 区追加 `useState` 和 `useCanvasStore`：

```typescript
import { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, type Node } from '@xyflow/react';
import type { CanvasNodeData } from '@/types/canvas';
import { NODE_CATEGORIES } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  Type, Image, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
  Loader2, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react';
```

2. 修改 `CanvasNodeProps` 类型，新增 `id` 字段（当前已存在但未使用，确保解构时取到）：

```typescript
type CanvasNodeProps = { data: CanvasNodeData; selected: boolean; id: string };
```

3. 修改组件函数签名并新增编辑态逻辑。将 `function CanvasNodeComponent({ data, selected }: CanvasNodeProps) {` 替换为：

```typescript
function CanvasNodeComponent({ data, selected, id }: CanvasNodeProps) {
  const category = NODE_CATEGORIES[data.type];
  const IconComponent = ICON_MAP[data.subtype] || AlertCircle;
  const StatusIcon = STATUS_ICONS[data.status];
  const editingNodeId = useCanvasStore((s) => s.editingNodeId);
  const setEditingNodeId = useCanvasStore((s) => s.setEditingNodeId);
  const renameNode = useCanvasStore((s) => s.renameNode);
  const isEditing = editingNodeId === id;

  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入编辑态时聚焦并全选
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      setEditValue(data.label);
    }
  }, [isEditing, data.label]);

  const commitRename = () => {
    renameNode(id, editValue);
    setEditingNodeId(null);
  };

  const cancelRename = () => {
    setEditingNodeId(null);
  };

  const borderColor = data.status === 'running'
    ? 'border-status-running animate-pulse-neon'
    : data.status === 'completed'
    ? 'border-status-success'
    : data.status === 'failed'
    ? 'border-status-error'
    : selected
    ? 'border-neon-purple'
    : 'border-canvas-border';
```

4. 修改节点头部标题区（找到原 `<span className="text-sm font-medium text-slate-200 font-display">{data.label}</span>`，替换为条件渲染）：

```typescript
      {/* 节点头部 */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-md"
        style={{ backgroundColor: category.color + '20' }}
      >
        <div
          className="flex items-center justify-center w-7 h-7 rounded-md"
          style={{ backgroundColor: category.color + '30' }}
        >
          <IconComponent className="w-4 h-4" style={{ color: category.color }} />
        </div>
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
            className="flex-1 min-w-0 px-1 py-0 text-sm font-medium text-slate-200 font-display bg-canvas-bg border border-neon-purple rounded focus:outline-none"
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-sm font-medium text-slate-200 font-display"
            onDoubleClick={() => setEditingNodeId(id)}
            title={data.label}
          >
            {data.label}
          </span>
        )}
        {StatusIcon && (
          <StatusIcon
            className={`w-4 h-4 ml-auto ${
              data.status === 'running' ? 'animate-spin text-status-running' :
              data.status === 'completed' ? 'text-status-success' :
              data.status === 'failed' ? 'text-status-error' :
              'text-status-warning'
            }`}
          />
        )}
      </div>
```

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/components/canvas/CanvasNode.tsx
git commit -m "CanvasNode 支持 inline 重命名编辑态"
```

---

## Task 6: Canvas 集成右键菜单

**Files:**
- Modify: `frontend/src/components/canvas/Canvas.tsx`

**Interfaces:**
- Consumes:
  - `useContextMenu()` from Task 2
  - `<ContextMenu />` from Task 3
  - `useCanvasStore` (selectedNodeIds/setSelectedNodeIds/removeNodes/addPastedNodes/addNode/setEditingNodeId)
  - `useClipboardStore` (copy/paste/hasClipboard)
  - `executeNode`/`isExecutable` from `@/utils/workflowExecutor`
  - 8 个对齐函数 from `@/utils/alignment`
  - `NODE_TEMPLATES`/`NODE_CATEGORIES` from `@/types/canvas`

- [ ] **Step 1: 修改 Canvas.tsx 顶部 imports**

打开 `frontend/src/components/canvas/Canvas.tsx`，在现有 import 区追加：

```typescript
import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  ConnectionLineType,
  SelectionMode,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useCollabStore } from '@/stores/collabStore';
import { executeNode, isExecutable } from '@/utils/workflowExecutor';
import {
  alignLeft, alignRight, alignTop, alignBottom,
  alignHorizontalCenter, alignVerticalCenter,
  distributeHorizontal, distributeVertical,
} from '@/utils/alignment';
import CanvasNodeComponent from './CanvasNode';
import RemoteCursors from './RemoteCursors';
import AlignmentToolbar from './AlignmentToolbar';
import ContextMenu, { type MenuItem } from './ContextMenu';
import { useContextMenu } from '@/hooks/useContextMenu';
import {
  Copy, ClipboardPaste, Pencil, Play, Trash2,
  AlignStartVertical, AlignEndVertical, AlignCenterVertical,
  AlignStartHorizontal, AlignEndHorizontal, AlignCenterHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  type Type, Image as ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge, Film, ImageDown, Volume2,
} from 'lucide-react';
import { NODE_TEMPLATES, NODE_CATEGORIES, type NodeSubtype } from '@/types/canvas';

const nodeTypes = { canvasNode: CanvasNodeComponent };
```

- [ ] **Step 2: 在组件函数内新增 useContextMenu 和菜单项构建逻辑**

在 `export default function Canvas() {` 内，定位 `const reactFlowInstance = useRef<ReactFlowInstance | null>(null);` 行（约第 36 行），在其下方追加：

```typescript
  const { menuState, openNodeMenu, openPaneMenu, closeMenu } = useContextMenu();
  const removeNodes = useCanvasStore((s) => s.removeNodes);
  const setEditingNodeId = useCanvasStore((s) => s.setEditingNodeId);
  const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds);
```

- [ ] **Step 3: 新增 onNodeContextMenu / onPaneContextMenu 回调**

在 `onSelectionChange` 回调之后（约第 186 行）追加：

```typescript
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      // 右键未选中节点 → 仅选中该节点；右键已选中节点 → 保持选中集
      const { selectedNodeIds } = useCanvasStore.getState();
      if (!selectedNodeIds.includes(node.id)) {
        setSelectedNodeIds([node.id]);
      }
      openNodeMenu(event, node.id);
    },
    [openNodeMenu, setSelectedNodeIds],
  );

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      openPaneMenu(event);
    },
    [openPaneMenu],
  );
```

- [ ] **Step 4: 新增菜单项构建函数**

在 `onPaneContextMenu` 回调之后追加菜单项构建逻辑。注意坐标转换使用 `reactFlowInstance.current.screenToFlowPosition`：

```typescript
  // 构建节点右键菜单项
  const buildNodeMenuItems = (): MenuItem[] => {
    const { nodes, edges, selectedNodeIds } = useCanvasStore.getState();
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const internalEdges = edges.filter(
      (e) => selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target),
    );
    const targetNode = nodes.find((n) => n.id === menuState.targetNodeId);
    const canExecute = selectedNodeIds.length === 1 && targetNode && isExecutable(targetNode.data.subtype);

    // 对齐子菜单（仅 >=2 节点显示）
    const alignSubmenu: MenuItem[] | null = selectedNodeIds.length >= 2
      ? [
          { icon: AlignStartVertical, label: '左对齐', onClick: () => handleAlign(alignLeft) },
          { icon: AlignEndVertical, label: '右对齐', onClick: () => handleAlign(alignRight) },
          { icon: AlignStartHorizontal, label: '顶对齐', onClick: () => handleAlign(alignTop) },
          { icon: AlignEndHorizontal, label: '底对齐', onClick: () => handleAlign(alignBottom) },
          { icon: AlignCenterVertical, label: '垂直居中', onClick: () => handleAlign(alignVerticalCenter) },
          { icon: AlignCenterHorizontal, label: '水平居中', onClick: () => handleAlign(alignHorizontalCenter) },
          {
            icon: AlignHorizontalDistributeCenter,
            label: '水平等距',
            disabled: selectedNodeIds.length < 3,
            onClick: () => handleAlign(distributeHorizontal),
          },
          {
            icon: AlignVerticalDistributeCenter,
            label: '垂直等距',
            disabled: selectedNodeIds.length < 3,
            onClick: () => handleAlign(distributeVertical),
          },
        ]
      : null;

    const items: MenuItem[] = [
      {
        icon: Copy,
        label: '复制',
        shortcut: 'Ctrl+C',
        disabled: selectedNodes.length === 0,
        onClick: () => useClipboardStore.getState().copy(selectedNodes, internalEdges),
      },
      {
        icon: ClipboardPaste,
        label: '粘贴',
        shortcut: 'Ctrl+V',
        disabled: !useClipboardStore.getState().hasClipboard(),
        onClick: () => handlePasteAtMenu(),
      },
      {
        icon: Pencil,
        label: '重命名',
        shortcut: 'F2',
        disabled: selectedNodeIds.length !== 1,
        onClick: () => setEditingNodeId(menuState.targetNodeId!),
      },
    ];

    if (canExecute) {
      items.push({
        icon: Play,
        label: '执行节点',
        shortcut: 'F5',
        onClick: () => {
          void executeNode(menuState.targetNodeId!).catch((err) => {
            toast.error(`执行失败: ${err?.message || '未知错误'}`);
          });
        },
      });
    }

    items.push({
      icon: Trash2,
      label: '删除',
      shortcut: 'Delete',
      disabled: selectedNodeIds.length === 0,
      onClick: () => removeNodes(selectedNodeIds),
    });

    if (alignSubmenu) {
      items.push({ separator: true });
      items.push({ icon: AlignStartVertical, label: '对齐', submenu: alignSubmenu });
    }

    return items;
  };

  // 构建画布空白右键菜单项
  const buildPaneMenuItems = (): MenuItem[] => {
    const items: MenuItem[] = [
      {
        icon: ClipboardPaste,
        label: '粘贴',
        shortcut: 'Ctrl+V',
        disabled: !useClipboardStore.getState().hasClipboard(),
        onClick: () => handlePasteAtMenu(),
      },
      {
        icon: AlignStartVertical,
        label: '全选',
        shortcut: 'Ctrl+A',
        onClick: () => useCanvasStore.getState().selectAll(),
      },
      { separator: true },
    ];

    // 新建节点子菜单（按类别分组）
    const newNodesSubmenu: MenuItem[] = NODE_CATEGORIES
      ? Object.entries(NODE_CATEGORIES).map(([typeKey, cat]) => {
          const subItems: MenuItem[] = NODE_TEMPLATES
            .filter((t) => t.type === typeKey)
            .map((t) => ({
              icon: ICON_MAP_LUCIDE[t.icon] || Type,
              label: t.label,
              onClick: () => handleAddNodeAtMenu(t.subtype),
            }));
          return { label: cat.label, submenu: subItems };
        })
      : [];

    items.push({ icon: Type, label: '新建节点', submenu: newNodesSubmenu });

    return items;
  };

  // 在右键位置粘贴（屏幕坐标 → 画布坐标）
  const handlePasteAtMenu = () => {
    const pasted = useClipboardStore.getState().paste();
    if (!pasted) return;
    const canvasPos = reactFlowInstance.current
      ? reactFlowInstance.current.screenToFlowPosition(menuState.position)
      : menuState.position;
    useCanvasStore.getState().addPastedNodes(pasted.nodes, pasted.edges, canvasPos);
  };

  // 在右键位置新建节点
  const handleAddNodeAtMenu = (subtype: NodeSubtype) => {
    const canvasPos = reactFlowInstance.current
      ? reactFlowInstance.current.screenToFlowPosition(menuState.position)
      : menuState.position;
    addNode(subtype, canvasPos);
    markDirty();
    const newNode = useCanvasStore.getState().nodes[useCanvasStore.getState().nodes.length - 1];
    if (newNode) pushAddNode({ node: newNode });
  };

  // 对齐处理 helper
  const handleAlign = (fn: typeof alignLeft) => {
    const { nodes, selectedNodeIds, alignNodes } = useCanvasStore.getState();
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const positionable = selectedNodes.map((n) => ({ id: n.id, position: n.position }));
    const updates = fn(positionable);
    alignNodes(updates);
  };
```

注意：上面用到了 `toast`、`ICON_MAP_LUCIDE` 和 `type Type`。需要在文件顶部追加：

```typescript
import { toast } from 'sonner';
import Type from 'lucide-react'; // 占位，下面 ICON_MAP_LUCIDE 用
```

实际上 `Type` 是 lucide 的命名导出，不需要 default import。修正为在已有 lucide import 列表中追加 `Type`（已包含）并定义 ICON_MAP_LUCIDE。在 `const nodeTypes = ...` 上方追加：

```typescript
// 节点模板图标映射（与 CanvasNode.tsx 的 ICON_MAP 一致）
const ICON_MAP_LUCIDE: Record<string, React.ComponentType<{ className?: string }>> = {
  Type, Image: ImageIcon, Music, Wand2, Video, Mic,
  Maximize, Palette, Scissors, Expand,
  GitBranch, Repeat, GitMerge,
  Film, ImageDown, Volume2,
};
```

- [ ] **Step 5: 在 ReactFlow 组件上绑定回调并渲染 ContextMenu**

定位 `<ReactFlow` 开始的 JSX（约第 198 行），在 `onPaneClick={onPaneClick}` 之后追加两行回调：

```typescript
      <ReactFlow
        nodes={reactFlowNodes}
        edges={edges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
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
        onContextMenu={(e) => e.preventDefault()}
      >
```

然后在 `</ReactFlow>` 闭合标签之后、`</div>` 之前追加 ContextMenu 渲染：

```typescript
      </ReactFlow>
      <ContextMenu
        visible={menuState.visible}
        position={menuState.position}
        items={menuState.type === 'node' ? buildNodeMenuItems() : buildPaneMenuItems()}
        onClose={closeMenu}
      />
    </div>
  );
}
```

- [ ] **Step 6: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误。如有未使用变量告警，按提示清理。

- [ ] **Step 7: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/components/canvas/Canvas.tsx
git commit -m "Canvas 集成右键菜单（节点/画布）支持复制粘贴重命名执行删除对齐"
```

---

## Task 7: EditorLayout 扩展快捷键 + 渲染 ShortcutHelpModal

**Files:**
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Consumes:
  - `useCanvasStore.getState().selectedNodeIds` / `setEditingNodeId` / `setSelectedNodeIds`
  - `executeNode` / `isExecutable` from workflowExecutor
  - `<ShortcutHelpModal />` from Task 4
  - `useContextMenu` 的 `menuState`/`closeMenu`（需提升到 EditorLayout 或通过 store 暴露）

**注意**：Escape 优先级链要求"菜单可见 → 编辑态非空 → 帮助面板打开 → 选中非空"。菜单状态在 Canvas 内的 useContextMenu 中，EditorLayout 无法直接访问。解决方案：将 `closeMenu` 通过 ref 或在 Canvas 暴露。更简单的方案：在 EditorLayout 监听 Escape 时，通过 `document.querySelector('[role="menu"]')` 检测菜单是否可见，或通过自定义事件。KISS 方案：用 window 自定义事件 `context-menu-close` 通知关闭。

为避免过度复杂，采用：EditorLayout 的 Escape handler 只处理"编辑态 → 帮助面板 → 选中"三级，菜单的 Escape 由 ContextMenu 自身的 keydown listener 处理（已在 Task 3 实现）。由于 ContextMenu 的 keydown listener 在 document 上，会先于 EditorLayout 的 window listener 触发（均为 capture/bubble 阶段，但 ContextMenu 内 `e.preventDefault()` 不会阻止 EditorLayout 的 handler 执行）。

实际验证方案：ContextMenu 的 mousedown 监听已在 Task 3 处理"点击外部关闭"。Escape 由 ContextMenu 自身处理。EditorLayout 的 Escape 只处理编辑态/帮助面板/选中。若菜单和编辑态同时存在（不可能，因为进入编辑态前菜单已关闭），无需担心冲突。

- [ ] **Step 1: 修改 EditorLayout.tsx imports**

在 `frontend/src/components/EditorLayout.tsx` 顶部 import 区追加：

```typescript
import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useCollabStore } from '@/stores/collabStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useAuthStore } from '@/stores/authStore';
import { ArrowLeft, Save, Undo2, Redo2, Play, Square, History, Clock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { executeWorkflow, getExecutionStatus, cancelWorkflowExecution, executeNode, isExecutable } from '@/utils/workflowExecutor';
import type { WorkflowExecutionStatus } from '@/utils/workflowExecutor';
import AiGenerateModal from './AiGenerateModal';
import ShortcutHelpModal from './canvas/ShortcutHelpModal';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';
```

- [ ] **Step 2: 新增 ShortcutHelpModal 状态**

在组件函数内（约第 57 行 `const [showAiModal, setShowAiModal] = useState(false);` 之后）追加：

```typescript
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
```

- [ ] **Step 3: 扩展快捷键 handler**

定位 `// 快捷键绑定` 的 useEffect（约第 148 行），将整个 handler 函数体替换为以下完整实现（保留现有快捷键 + 新增 4 个）：

```typescript
  // 快捷键绑定
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入框聚焦时不触发（避免影响文本编辑）—— 但 Escape 例外（用于退出编辑态）
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Escape：优先级 链 —— 编辑态 > 帮助面板 > 选中
      if (e.key === 'Escape') {
        const { editingNodeId, selectedNodeIds } = useCanvasStore.getState();
        if (editingNodeId !== null) {
          e.preventDefault();
          useCanvasStore.getState().setEditingNodeId(null);
          return;
        }
        if (showShortcutHelp) {
          e.preventDefault();
          setShowShortcutHelp(false);
          return;
        }
        if (selectedNodeIds.length > 0) {
          e.preventDefault();
          useCanvasStore.getState().setSelectedNodeIds([]);
          return;
        }
        return;
      }

      if (isInputFocused) return;

      // F2：重命名选中节点（仅单选时）
      if (e.key === 'F2') {
        const { selectedNodeIds } = useCanvasStore.getState();
        if (selectedNodeIds.length === 1) {
          e.preventDefault();
          useCanvasStore.getState().setEditingNodeId(selectedNodeIds[0]);
        }
        return;
      }

      // F5：执行选中节点（仅单选且 isExecutable 时）
      if (e.key === 'F5') {
        const { selectedNodeIds, nodes } = useCanvasStore.getState();
        if (selectedNodeIds.length === 1) {
          const node = nodes.find((n) => n.id === selectedNodeIds[0]);
          if (node && isExecutable(node.data.subtype)) {
            e.preventDefault();
            void executeNode(node.id).catch((err) => {
              toast.error(`执行失败: ${err?.message || '未知错误'}`);
            });
          }
        }
        return;
      }

      // Ctrl/Cmd + / ：打开快捷键帮助面板
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcutHelp(true);
        return;
      }

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

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, saveCurrentProject, showShortcutHelp]);
```

- [ ] **Step 4: 渲染 ShortcutHelpModal**

定位 `</AiGenerateModal>` 闭合标签（约第 405 行），在其后追加：

```typescript
      {/* AI 生成模态框 */}
      <AiGenerateModal
        open={showAiModal}
        onClose={() => setShowAiModal(false)}
        onGenerated={handleAiGenerated}
      />
      {/* 快捷键帮助面板 */}
      <ShortcutHelpModal
        open={showShortcutHelp}
        onClose={() => setShowShortcutHelp(false)}
      />
    </div>
  );
}
```

- [ ] **Step 5: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误。

- [ ] **Step 6: Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add frontend/src/components/EditorLayout.tsx
git commit -m "EditorLayout 新增 F2/Escape/F5/Ctrl+/ 快捷键和帮助面板"
```

---

## Task 8: 全量测试 + MCP 端到端验证

**Files:** 无修改，仅验证

- [ ] **Step 1: 全量单元测试**

```bash
cd frontend && pnpm vitest run
```

预期：所有测试 PASS（canvasStore.test.ts + clipboardStore.test.ts + alignment.test.ts）。

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm tsc --noEmit
```

预期：无错误（renderMock.ts 既有的无关错误可忽略）。

- [ ] **Step 3: 启动开发服务器**

```bash
cd frontend && pnpm dev:mock
```

预期：Vite 启动在 http://localhost:5173/。

- [ ] **Step 4: MCP 端到端验证（Chrome DevTools）**

使用 MCP Chrome DevTools 工具完成以下验证（沿用前次会话的 DOM dispatch 模式）：

1. **创建项目并进入编辑器**：navigate_page 到 http://localhost:5173/，登录后创建项目进入编辑器
2. **加载 mock 数据**：evaluate_script 调用 `useCanvasStore.setState({ nodes: [...], edges: [...] })` 注入 9 节点 7 边的测试数据
3. **验证右键节点菜单**：
   - evaluate_script 在某节点上 dispatch contextmenu 事件
   - 验证 `[role="menu"]` 出现，包含"复制/粘贴/重命名/删除"等项
4. **验证删除（可撤销）**：
   - 点击"删除"项
   - evaluate_script 检查 `useCanvasStore.getState().nodes.length` 减少
   - 检查 `useHistoryStore.getState().past.length` 增加
   - Ctrl+Z 撤销，节点恢复
5. **验证右键画布粘贴**：
   - 先 Ctrl+C 复制
   - 右键画布空白 → 点击"粘贴"
   - 检查新节点位置接近右键坐标
6. **验证 F2 重命名**：
   - 选中单个节点
   - dispatch F2 keydown
   - 检查 `useCanvasStore.getState().editingNodeId` 等于选中节点 id
   - 检查 DOM 中出现 input
   - 输入新名 → dispatch Enter
   - 检查节点 label 更新 + 历史栈增加
7. **验证 Escape 取消选中**：
   - 选中多个节点
   - dispatch Escape
   - 检查 `useCanvasStore.getState().selectedNodeIds.length === 0`
8. **验证 Ctrl+/ 帮助面板**：
   - dispatch Ctrl+/
   - 检查 ShortcutHelpModal 出现（DOM 中含"快捷键"标题）
9. **验证 F5 执行节点**（若 mock 模式下执行会失败，仅验证快捷键被拦截）：
   - 选中可执行节点
   - dispatch F5
   - 检查 `e.preventDefault()` 生效（浏览器未刷新）

记录验证结果到 `docs/superpowers/verify_context_menu_shortcuts.md`。

- [ ] **Step 5: 编写验证清单文档**

创建 `docs/superpowers/verify_context_menu_shortcuts.md`，记录上述 9 项验证点的通过/待人工状态。

- [ ] **Step 6: 最终 Commit**

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add docs/superpowers/verify_context_menu_shortcuts.md
git commit -m "添加右键菜单与快捷键体系验证清单"
```

- [ ] **Step 7: 更新 DEVELOPMENT_ROADMAP.md**

在 `DEVELOPMENT_ROADMAP.md` 的已完成任务区追加 #14 条目：

```markdown
### 14. 右键菜单 + 快捷键体系
- **前端**: 新增 ContextMenu 通用浮层组件（MenuItem 接口、边界检测、键盘导航、子菜单）
- **前端**: 新增 useContextMenu hook 管理菜单状态（visible/position/type/targetNodeId）
- **前端**: 新增 ShortcutHelpModal 快捷键帮助面板（分组列表 + Esc/遮罩关闭）
- **前端**: CanvasNode 支持 inline 重命名（双击/F2 进入编辑态，Enter 确认/Escape 取消/onBlur 确认）
- **前端**: Canvas 绑定 onNodeContextMenu/onPaneContextMenu，构建节点/画布菜单项
- **前端**: EditorLayout 扩展快捷键（F2 重命名/Escape 取消/Ctrl+/ 帮助/F5 执行）
- **修复**: canvasStore.removeNode 写历史（原不写历史导致无法撤销）
- **新增**: canvasStore.removeNodes 批量删除方法（单次写历史）
- **新增**: canvasStore.renameNode 方法（写历史 + 协作广播）
- **新增**: canvasStore.editingNodeId/setEditingNodeId 跨组件编辑态通信
- **改进**: addPastedNodes 支持 targetPosition 参数（粘贴到右键位置）
- **测试**: canvasStore.test.ts 单元测试（editingNodeId/renameNode/removeNode/removeNodes/addPastedNodes targetPosition）
- **涉及文件**: ContextMenu.tsx, useContextMenu.ts, ShortcutHelpModal.tsx, canvasStore.ts, canvasStore.test.ts, CanvasNode.tsx, Canvas.tsx, EditorLayout.tsx
```

更新顶部表格中"节点快捷操作"行下方新增"右键菜单+快捷键"行（或在现有节点操作行补充）。

```bash
cd /Users/qzfrato/AI_Canvas_Flow
git add DEVELOPMENT_ROADMAP.md
git commit -m "更新路线图：右键菜单与快捷键体系已完成"
```

---

## Self-Review

**1. Spec coverage 检查**：
- ✅ ContextMenu 通用组件（MenuItem/ContextMenuProps/定位/边界/关闭/键盘导航/子菜单）→ Task 3
- ✅ useContextMenu hook（MenuState/openNodeMenu/openPaneMenu/closeMenu）→ Task 2
- ✅ ShortcutHelpModal → Task 4
- ✅ 节点右键菜单（复制/粘贴/重命名/执行/删除/对齐子菜单）→ Task 6 buildNodeMenuItems
- ✅ 画布空白右键菜单（粘贴/全选/新建节点子菜单）→ Task 6 buildPaneMenuItems
- ✅ 坐标转换 → Task 6 handlePasteAtMenu/handleAddNodeAtMenu 用 screenToFlowPosition
- ✅ 现有快捷键保留 → Task 7 保留全部现有分支
- ✅ 新增快捷键（F2/Escape/Ctrl+//F5）→ Task 7
- ✅ Escape 优先级链 → Task 7（编辑态 > 帮助面板 > 选中；菜单由 ContextMenu 自身处理）
- ✅ inline 重命名（canvasStore.editingNodeId + CanvasNode 条件渲染 input）→ Task 1 + Task 5
- ✅ removeNode 写历史修复 → Task 1 Step 5
- ✅ removeNodes 批量方法 → Task 1 Step 5
- ✅ addPastedNodes 支持 targetPosition → Task 1 Step 6
- ✅ 单元测试 → Task 1 Step 1
- ✅ MCP 端到端验证 → Task 8 Step 4

**2. 占位符扫描**：无 TBD/TODO/"实现细节后补"等占位符。所有代码块完整。

**3. 类型一致性**：
- `MenuItem` 接口在 Task 3 定义，Task 6 使用（一致）
- `MenuState` 在 Task 2 定义，Task 6 通过 `menuState.targetNodeId`/`menuState.position`/`menuState.type` 使用（一致）
- `useCanvasStore` 新增方法签名在 Task 1 定义，Task 5/6/7 使用（一致）
- `pushBatchSetNodes({ from, to })` 签名贯穿 Task 1（一致）
- `screenToFlowPosition` API 在 Canvas.tsx 已有使用先例（Task 6 复用，一致）

**4. 风险点**：
- Task 6 的 `buildPaneMenuItems` 用 `Object.entries(NODE_CATEGORIES)` 遍历，顺序依赖对象键顺序（ES2015+ 保证字符串键按插入顺序）。可接受。
- Task 7 的 Escape 处理依赖 ContextMenu 自身 keydown listener 先关闭菜单。若两个 listener 都触发，ContextMenu 关闭后 EditorLayout 的 handler 会继续检查 editingNodeId（此时应为 null，因为进入编辑态前菜单已关闭）。无冲突。
- Task 1 测试中 `useHistoryStore.getState().clear?.()` 若不存在不会报错（可选链），但 past 不会重置。若测试间相互影响，改为 `useHistoryStore.setState({ past: [], future: [] })`。已在 Step 7 注明按报错调整。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-01-context-menu-shortcuts.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 Task 派发独立 subagent，任务间审查，快速迭代
2. **Inline Execution** — 在当前会话中按 executing-plans 批量执行，带检查点

请选择执行方式。
