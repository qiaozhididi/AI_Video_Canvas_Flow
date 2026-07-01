# 右键菜单 + 快捷键体系 设计文档

> 创建时间: 2026-07-01
> 状态: 已批准，待实现

## 目标

为画布编辑器补充右键上下文菜单和完善快捷键体系，提升专业工具的操作效率。复用现有 canvasStore/clipboardStore/workflowExecutor 机制，保持纯 Tailwind + lucide-react 技术栈一致性。

## 架构

新增 3 个文件，修改 4 个文件。ContextMenu 作为通用浮层组件，由 Canvas 通过 `onNodeContextMenu`/`onPaneContextMenu` 驱动；快捷键在 EditorLayout 现有 handler 中扩展；inline 重命名通过 canvasStore 的 `editingNodeId` 字段跨组件通信。

### 技术栈

- 纯 Tailwind CSS + lucide-react 图标（与 AlignmentToolbar 一致）
- React Flow 12 的 `onNodeContextMenu`/`onPaneContextMenu` 回调
- Zustand store 管理编辑态
- 无新依赖

---

## 组件设计

### 1. ContextMenu 通用组件

**文件**: `frontend/src/components/canvas/ContextMenu.tsx`

通用右键菜单浮层，支持子菜单、快捷键标注、禁用项、键盘导航。

```typescript
interface MenuItem {
  label: string;           // 菜单项文本
  shortcut?: string;       // 快捷键标注（如 "Ctrl+C"，仅展示）
  icon?: React.ComponentType<{ className?: string }>;  // lucide 图标
  onClick?: () => void;    // 点击回调（与 submenu 互斥）
  disabled?: boolean;      // 禁用态
  submenu?: MenuItem[];    // 子菜单（与 onClick 互斥）
  separator?: boolean;     // 分隔线（为 true 时其他字段忽略）
}

interface ContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };  // 屏幕坐标（clientX/clientY）
  items: MenuItem[];
  onClose: () => void;
}
```

**行为**:
- 定位：`position.fixed`，`left/top` 设为 `position.x/y`
- 边界检测：若 `x + width > window.innerWidth`，则向左展开（`left = x - width`）；若 `y + height > window.innerHeight`，则向上展开
- 关闭：点击菜单外部（`onMouseDown` 监听 document）、按 Escape、点击非子菜单项后
- 子菜单：hover 触发展开，定位在父项右侧（靠右边缘时左侧）
- 键盘导航：上下方向键高亮项，Enter 触发，左右方向键进出子菜单，Escape 关闭
- 样式：`bg-canvas-panel border border-canvas-border rounded-lg shadow-2xl`，项 `hover:bg-canvas-hover`，与 AlignmentToolbar 一致

### 2. useContextMenu hook

**文件**: `frontend/src/hooks/useContextMenu.ts`

管理菜单可见性、位置、类型。

```typescript
interface MenuState {
  visible: boolean;
  position: { x: number; y: number };
  type: 'node' | 'pane' | null;
  targetNodeId: string | null;  // type='node' 时为右键的节点 id
}

function useContextMenu(): {
  menuState: MenuState;
  openNodeMenu: (event: React.MouseEvent, nodeId: string) => void;
  openPaneMenu: (event: React.MouseEvent) => void;
  closeMenu: () => void;
}
```

`openNodeMenu`/`openPaneMenu` 调用 `event.preventDefault()` 阻止浏览器默认菜单，并设置状态。

### 3. ShortcutHelpModal 快捷键帮助面板

**文件**: `frontend/src/components/canvas/ShortcutHelpModal.tsx`

模态弹窗，分组列出所有快捷键。

```typescript
interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
}
```

**分组**:
- 通用：Ctrl+Z 撤销、Ctrl+Shift+Z 重做、Ctrl+S 保存、Ctrl+/ 帮助
- 节点操作：Ctrl+C 复制、Ctrl+V 粘贴、Ctrl+A 全选、Delete 删除、F2 重命名、F5 执行
- 视图：Backspace 删除（同 Delete）

**行为**: Esc 或点击遮罩关闭。纯展示无交互。样式参考 AiGenerateModal 的模态结构。

---

## 右键菜单项

### 节点右键菜单（onNodeContextMenu）

右键未选中节点 → `setSelectedNodeIds([nodeId])` 仅选中该节点；右键已选中节点 → 保持选中集不变。菜单作用于当前 `selectedNodeIds`。

```
复制          Ctrl+C
粘贴          Ctrl+V    （粘贴到右键位置）
重命名        F2
执行节点      F5        （仅 isExecutable(subtype) 节点显示，否则隐藏该项）
删除          Delete
──────────────────────
对齐 ▶                  （仅 selectedNodeIds.length >= 2 显示）
                        子菜单 8 项：
                        左对齐 / 右对齐 / 顶对齐 / 底对齐
                        垂直居中 / 水平居中
                        水平等距（>=3 启用）/ 垂直等距（>=3 启用）
```

- 复制：`clipboardStore.copy(selectedNodes, internalEdges)`
- 粘贴：`clipboardStore.paste()` → `canvasStore.addPastedNodes(nodes, edges, rightClickPosition)`
- 重命名：`canvasStore.setEditingNodeId(nodeId)`
- 执行节点：`workflowExecutor.executeNode(nodeId)`，仅当 `selectedNodeIds.length === 1` 且 `isExecutable` 时显示
- 删除：调用 `removeNodes(selectedNodeIds)` 批量删除（单次写历史）
- 对齐：复用 `AlignmentToolbar` 的 `alignNodes(updates)` 逻辑，8 个函数对应 8 个子菜单项

### 画布空白右键菜单（onPaneContextMenu）

```
粘贴          Ctrl+V    （粘贴到右键位置，仅 clipboardStore.hasClipboard() 启用）
全选          Ctrl+A
──────────────────────
新建节点 ▶              （子菜单按类别展开）
                        输入 ▶  文本输入 / 图片输入 / 音频输入
                        AI 推理 ▶  文生图 / 图生视频 / 文生语音
                        处理 ▶  高清放大 / 风格化 / 抠图 / 扩图
                        控制 ▶  条件分支 / 循环 / 合并
                        输出 ▶  视频输出 / 图片输出 / 音频输出
```

- 粘贴：同节点右键粘贴，位置为右键坐标
- 全选：`canvasStore.selectAll()`
- 新建节点：`canvasStore.addNode(subtype, rightClickPosition)`，位置为右键坐标（需将屏幕坐标转换为画布坐标，用 `useStore` 获取 viewport transform 反算）

**坐标转换**（画布坐标 = (屏幕坐标 - viewport.x) / zoom）：
```typescript
const { x, y, zoom } = useViewport();  // 或 useStore(state => state.transform)
const canvasPos = {
  x: (clientX - x) / zoom,
  y: (clientY - y) / zoom,
};
```

---

## 快捷键体系

### 现有快捷键（保留不动）

| 快捷键 | 功能 | 位置 |
|--------|------|------|
| Ctrl/Cmd+Z | 撤销 | EditorLayout.tsx:155 |
| Ctrl/Cmd+Shift+Z / Ctrl+Y | 重做 | EditorLayout.tsx:160 |
| Ctrl/Cmd+C | 复制 | EditorLayout.tsx:165 |
| Ctrl/Cmd+V | 粘贴 | EditorLayout.tsx:178 |
| Ctrl/Cmd+A | 全选 | EditorLayout.tsx:187 |
| Ctrl/Cmd+S | 保存 | EditorLayout.tsx:193 |
| Backspace/Delete | 删除 | Canvas.tsx:214（React Flow 内置） |
| Ctrl/Cmd+Enter | AI 生成提交 | AiGenerateModal.tsx:54 |

### 新增快捷键

在 `EditorLayout.tsx` 的 `handler` 函数内（第 149 行起）追加分支，复用现有 INPUT/TEXTAREA 聚焦过滤（第 152 行）：

| 快捷键 | 功能 | 实现 |
|--------|------|------|
| **F2** | 重命名选中节点 | 若 `selectedNodeIds.length === 1`，调 `setEditingNodeId(id)` |
| **Escape** | 取消全选 / 关闭菜单 / 退出重命名 / 关闭帮助面板 | 优先级：关闭菜单 > 退出重命名(setEditingNodeId(null)) > 关闭帮助面板 > 取消全选(setSelectedNodeIds([])) |
| **Ctrl/Cmd+/** | 打开快捷键帮助面板 | `setShortcutHelpOpen(true)` |
| **F5** | 执行选中节点 | 若 `selectedNodeIds.length === 1` 且 `isExecutable`，调 `executeNode(id)`；阻止浏览器默认刷新（`e.preventDefault()`） |

**Escape 优先级处理**：检查顺序为 菜单可见 → 编辑态非空 → 帮助面板打开 → 选中非空，命中任一即处理并 return，不继续后续。

---

## inline 重命名交互

### canvasStore 新增字段

```typescript
interface CanvasState {
  // ... 现有字段
  editingNodeId: string | null;        // 新增：当前正在 inline 编辑的节点 id
  setEditingNodeId: (id: string | null) => void;  // 新增
  renameNode: (id: string, newLabel: string) => void;  // 新增
}
```

- `editingNodeId`：null 表示无编辑态。CanvasNode 读取此字段判断是否渲染 input。
- `setEditingNodeId(id)`：设置/清除编辑态，不写历史。
- `renameNode(id, newLabel)`：若 `newLabel.trim()` 为空或与原值相同则不操作；否则调 `updateNodeData(id, { label: newLabel })` + `useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes })` 写历史 + `emitNodeChange('update', node)`（协作广播）+ `useAutoSaveStore.getState().markDirty()`。

### CanvasNode 改造

**文件**: `frontend/src/components/canvas/CanvasNode.tsx`

读取 `editingNodeId`：
```typescript
const editingNodeId = useCanvasStore((s) => s.editingNodeId);
const isEditing = editingNodeId === node.id;
```

标题区条件渲染：
- `isEditing === false`：渲染现有标题 `<div>`，双击触发 `setEditingNodeId(node.id)`
- `isEditing === true`：渲染 `<input>`，`autoFocus` + `select()` 全选文本，`value` 用局部 state（`useState(node.data.label)`）
  - `onKeyDown`：Enter → `renameNode(id, value)` + `setEditingNodeId(null)`；Escape → `setEditingNodeId(null)`（不保存）
  - `onBlur`：等价于 Enter（确认保存），避免点击其他地方丢失编辑
  - `className`：复用标题样式 + input 适配（`bg-transparent border border-canvas-border rounded px-1`）

---

## 技术债修复：removeNode 写历史

### 问题

`canvasStore.removeNode`（第 142-152 行）当前不调用 `pushHistory`，导致右键删除和 store API 删除无法撤销。而 Backspace 走 React Flow 内置 `onNodesChange` 的 `remove` 路径，由 `applyNodeChanges` 处理，也不写历史（历史由 `pushBatchSetNodes` 在批量操作时写）。

### 修复

`removeNode` 内部新增历史记录（在 `set` 之前快照当前 nodes/edges），用 `pushBatchSetNodes`/`pushBatchSetEdges` 写历史，保证删除可撤销。同时保留现有 `emitNodeDelete` 协作广播。

```typescript
removeNode: (id) => {
  const oldNodes = get().nodes;
  const oldEdges = get().edges;
  const affectedEdges = oldEdges.filter(e => e.source === id || e.target === id);
  const newNodes = oldNodes.filter(n => n.id !== id);
  const newEdges = oldEdges.filter(e => e.source !== id && e.target !== id);

  set({
    nodes: newNodes,
    edges: newEdges,
    selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
  });

  // 写历史（复用 batch_set 模式，与 addPastedNodes/alignNodes 一致）
  useHistoryStore.getState().pushBatchSetNodes({ from: oldNodes, to: newNodes });
  useHistoryStore.getState().pushBatchSetEdges({ from: oldEdges, to: newEdges });

  // 协作广播
  emitNodeDelete(id);
  affectedEdges.forEach(e => emitEdgeDelete(e.id));

  useAutoSaveStore.getState().markDirty();
}
```

> 注：`removeNodes(ids[])` 批量方法逻辑相同，只是过滤条件改为 `!ids.includes(id)`，单次写历史。

### 新增 removeNodes 批量方法

```typescript
removeNodes: (ids: string[]) => void;
```

一次性删除多个节点，单次写历史（快照删除前状态），批量清理边和选中态，批量广播。右键删除选中集时用此方法。

---

## addPastedNodes 支持目标位置

### 修改

`canvasStore.addPastedNodes` 增加可选第三参数 `targetPosition`：

```typescript
addPastedNodes: (
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  targetPosition?: { x: number; y: number }
) => void;
```

- 无 `targetPosition`：保持现有行为（节点带 +20 偏移）
- 有 `targetPosition`：计算偏移 = `targetPosition - nodes[0].position`（以第一个节点为锚点），所有节点应用该偏移

右键粘贴时传入右键画布坐标，使粘贴内容落在右键位置附近。

---

## 文件清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `frontend/src/components/canvas/ContextMenu.tsx` | 通用右键菜单浮层组件 |
| `frontend/src/hooks/useContextMenu.ts` | 菜单状态管理 hook |
| `frontend/src/components/canvas/ShortcutHelpModal.tsx` | 快捷键帮助面板 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/canvas/Canvas.tsx` | 绑定 `onNodeContextMenu`/`onPaneContextMenu`，渲染 ContextMenu，构建菜单项 |
| `frontend/src/components/canvas/CanvasNode.tsx` | inline 重命名编辑态（条件渲染 input） |
| `frontend/src/stores/canvasStore.ts` | 新增 `editingNodeId`/`setEditingNodeId`/`renameNode`/`removeNodes`，修改 `removeNode` 写历史，`addPastedNodes` 支持 targetPosition |
| `frontend/src/components/EditorLayout.tsx` | 扩展快捷键 handler（F2/Escape/Ctrl+//F5），渲染 ShortcutHelpModal |

---

## 测试策略

### 单元测试（vitest，沿用现有配置）

1. **canvasStore 新增方法测试**（扩展 `canvasStore.test.ts` 或新建）：
   - `renameNode`：正常改名写历史+广播；空文本不改；同名不改
   - `removeNode`：删除后可撤销（历史栈非空）
   - `removeNodes`：批量删除，单次写历史，清理边和选中
   - `addPastedNodes` 带 targetPosition：节点位置偏移正确
   - `setEditingNodeId`：设置/清除编辑态

2. **ContextMenu 组件测试**（可选，若时间允许）：
   - 渲染菜单项、disabled 态、separator
   - 点击项触发回调后关闭

### MCP 端到端验证

沿用本次验证方式（DOM dispatch 事件 + evaluate_script 读状态）：
1. 右键节点 → 菜单显示 → 点击删除 → 节点减少 + 可撤销
2. 右键画布 → 粘贴 → 节点出现在右键位置
3. F2 → 节点标题变 input → 输入新名 → Enter → 标题更新
4. Escape → 取消选中/关闭菜单
5. Ctrl+/ → 帮助面板弹出
6. F5 → 执行节点（触发渲染任务）

---

## 设计决策记录

1. **自建 ContextMenu 而非 Radix**：项目纯 Tailwind 无组件库，AlignmentToolbar 是浮动定位先例。自建可控且无新依赖，符合 KISS。
2. **editingNodeId 放 canvasStore 而非组件 state**：F2 在 EditorLayout 触发，CanvasNode 在深层渲染，需跨组件通信。Store 字段比 prop drilling 简洁。
3. **右键选中行为（右键即选中）**：遵循 Figma/PS/文件管理器惯例，右键未选中节点时仅选中该节点，避免菜单作用于意外的大选中集。
4. **removeNodes 批量方法**：右键删除选中集时避免循环 removeNode 导致多次写历史，批量方法单次快照更符合撤销直觉。
5. **Escape 优先级链**：菜单 > 编辑 > 帮助面板 > 选中，逐级检查命中即 return，避免一个 Escape 同时触发多个清理。
6. **F5 执行节点**：F5 是 IDE 运行惯例，且不与现有快捷键冲突。需 `preventDefault` 阻止浏览器刷新。
7. **粘贴到右键位置**：addPastedNodes 增加可选参数而非改 clipboardStore，保持 clipboardStore 纯净（只管剪贴板数据，不管画布坐标）。

---

## 不在本次范围

- 节点分组（Group）/子工作流 — 属下一迭代
- 边右键菜单 — 频率低，暂不实现
- 自定义快捷键配置 — YAGNI
- 右键菜单图标自定义 — 沿用 lucide 默认
