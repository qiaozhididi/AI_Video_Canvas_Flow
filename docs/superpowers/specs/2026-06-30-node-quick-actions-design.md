# 节点快捷操作 设计文档

> 日期: 2026-06-30
> 模块: 路线图 #13 节点快捷操作
> 状态: 设计已确认，待实施

## 1. 背景与目标

当前编辑器缺少节点快捷操作能力（复制/粘贴、全选/框选、对齐工具），用户编排工作流时效率受限。本设计实现完整的快捷操作能力，提升编辑体验。

### 范围

三个子功能：
1. **复制/粘贴**：复制选中节点 + 它们之间的内部边，粘贴生成新 ID + 偏移 20px，保留连线关系
2. **全选/框选**：开启 React Flow 内置多选和框选，Ctrl/Cmd+A 全选
3. **对齐工具**：浮动工具条，选中 ≥2 节点时浮现，提供 8 种对齐方式

### 非目标（YAGNI）

- 不做系统剪贴板（仅内部剪贴板，但跨项目共享）
- 不做节点宽高计算（对齐基于 position 坐标，不基于实际渲染尺寸）
- 不做跨标签页剪贴板同步
- 不做右键菜单（已有浮动工具条）

## 2. 架构

### 新增文件

| 文件 | 类型 | 职责 |
|------|------|------|
| `frontend/src/stores/clipboardStore.ts` | 新建 | Zustand store，存储剪贴板数据（节点+内部边），跨项目共享 |
| `frontend/src/components/canvas/AlignmentToolbar.tsx` | 新建 | 浮动对齐工具条组件，选中 ≥2 节点时浮现 |
| `frontend/src/utils/alignment.ts` | 新建 | 8 种对齐计算纯函数 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `frontend/src/components/canvas/Canvas.tsx` | 开启 `selectionMode: SelectionMode.Partial` + `multiSelectionKeyCode: ['Meta','Control']`；渲染 AlignmentToolbar |
| `frontend/src/components/EditorLayout.tsx` | 绑定 Ctrl/Cmd+C/V/A 快捷键 |
| `frontend/src/stores/canvasStore.ts` | 新增 `selectAll()`/`addPastedNodes()`/`alignNodes()` 方法 |
| `frontend/src/stores/historyStore.ts` | 新增 `pushPasteNodes`/`pushAlignNodes` 动作类型 |

### 数据流

```
复制: Ctrl/Cmd+C → clipboardStore.copy(selectedNodes, internalEdges)
粘贴: Ctrl/Cmd+V → clipboardStore.paste() → canvasStore.addPastedNodes(newNodes, newEdges)
                        → historyStore.pushPasteNodes() + collabStore.emit + autoSaveStore.markDirty
全选: Ctrl/Cmd+A → canvasStore.selectAll()
对齐: AlignmentToolbar 点击 → alignment.ts 计算新位置
              → canvasStore.alignNodes(updates) → historyStore.pushAlignNodes() + collabStore.emit
```

## 3. 详细设计

### 3.1 clipboardStore.ts

```typescript
interface ClipboardData {
  nodes: CanvasNode[];  // 复制的节点（含完整 data）
  edges: CanvasEdge[];  // 选中节点之间的内部边
  copiedAt: number;     // 复制时间戳
}

interface ClipboardState {
  clipboard: ClipboardData | null;
  copy: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;
  paste: () => { nodes: CanvasNode[]; edges: CanvasEdge[] } | null;  // 生成新ID+偏移
  hasClipboard: () => boolean;
  clear: () => void;
}
```

**粘贴逻辑**：
- 节点生成新 ID：`paste-{原id}-{timestamp}`
- 边重映射 source/target 到新节点 ID，生成新边 ID：`paste-edge-{原id}-{timestamp}`
- 位置偏移 +20px（每次粘贴累计偏移，pasteCount 计数）

### 3.2 alignment.ts

8 个纯函数，每个接收 `nodes: {id, position:{x,y}}[]`，返回 `Map<string, {x,y}>`（节点ID → 新位置）：

| 函数 | 逻辑 | 最少节点数 |
|------|------|-----------|
| `alignLeft` | 所有节点 x = min(x) | 2 |
| `alignRight` | 所有节点 x = max(x) | 2 |
| `alignTop` | 所有节点 y = min(y) | 2 |
| `alignBottom` | 所有节点 y = max(y) | 2 |
| `alignHorizontalCenter` | 所有节点 y = avg(y) | 2 |
| `alignVerticalCenter` | 所有节点 x = avg(x) | 2 |
| `distributeHorizontal` | 按 x 排序，均匀分布 x 间距 | 3 |
| `distributeVertical` | 按 y 排序，均匀分布 y 间距 | 3 |

> 简化处理：不计算节点宽高（React Flow 自定义节点宽度不固定），用 position 坐标对齐。等距分布需 ≥3 节点，否则降级为 alignLeft/alignTop。

### 3.3 AlignmentToolbar.tsx

浮动工具条，定位逻辑：
- 监听 React Flow 的选中节点
- 计算选中节点的 bounding box（min/max x/y）
- 工具条定位在 bounding box 底部居中，偏移 +40px
- 8 个图标按钮（lucide-react：AlignStartVertical/AlignEndVertical 等）
- 选中 <2 时隐藏；等距分布在 <3 时 disabled

### 3.4 Canvas.tsx 修改

```typescript
// ReactFlow props
<ReactFlow
  selectionMode={SelectionMode.Partial}  // 框选部分接触即选中
  multiSelectionKeyCode={['Meta', 'Control']}  // Cmd/Ctrl 多选
  selectionOnDrag={false}  // 拖拽时默认移动节点，按 Space 才框选
>
  <AlignmentToolbar />  {/* 浮动对齐工具条 */}
</ReactFlow>
```

### 3.5 EditorLayout.tsx 快捷键

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;

    if (e.key === 'c') {
      // 复制选中节点
      const selected = useCanvasStore.getState().nodes.filter(n => n.selected);
      if (selected.length > 0) {
        const internalEdges = useCanvasStore.getState().edges.filter(
          e => selected.some(n => n.id === e.source) && selected.some(n => n.id === e.target)
        );
        useClipboardStore.getState().copy(selected, internalEdges);
        e.preventDefault();
      }
    } else if (e.key === 'v') {
      // 粘贴
      useClipboardStore.getState().paste();  // 触发 canvasStore.addPastedNodes
      e.preventDefault();
    } else if (e.key === 'a') {
      // 全选
      useCanvasStore.getState().selectAll();
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

> 注：实际实现需避免在 textarea/input 聚焦时触发（检查 e.target tagName）

### 3.6 canvasStore 新增方法

```typescript
// 全选
selectAll: () => {
  set(state => ({ nodes: state.nodes.map(n => ({ ...n, selected: true })) }));
},

// 粘贴节点（由 clipboardStore.paste 调用）
addPastedNodes: (nodes: CanvasNode[], edges: CanvasEdge[]) => {
  set(state => ({
    nodes: [...state.nodes, ...nodes],
    edges: [...state.edges, ...edges],
  }));
  // 触发协作广播 + 历史记录 + markDirty
  useHistoryStore.getState().pushPasteNodes(nodes, edges);
  nodes.forEach(n => emitNodeChange(n, 'add'));
  edges.forEach(e => emitEdgeChange(e, 'add'));
  useAutoSaveStore.getState().markDirty();
},

// 对齐节点
alignNodes: (updates: Map<string, {x: number, y: number}>) => {
  const oldPositions = new Map();
  set(state => ({
    nodes: state.nodes.map(n => {
      if (updates.has(n.id)) {
        oldPositions.set(n.id, { ...n.position });
        return { ...n, position: updates.get(n.id)! };
      }
      return n;
    }),
  }));
  useHistoryStore.getState().pushAlignNodes(oldPositions, updates);
  // 广播变更
  updates.forEach((pos, id) => emitNodeUpdate(id, pos));
  useAutoSaveStore.getState().markDirty();
},
```

### 3.7 historyStore 新增动作

```typescript
// 粘贴：undo 移除节点/边，redo 恢复
pushPasteNodes: (addedNodes: CanvasNode[], addedEdges: CanvasEdge[]) => {
  pushAction({
    type: 'paste_nodes',
    data: { addedNodes, addedEdges },
    applyForward: () => { /* 重新 addNodes/addEdges */ },
    applyReverse: () => { /* removeNodes/removeEdges */ },
  });
},

// 对齐：undo/redo 切换位置
pushAlignNodes: (oldPositions: Map, newPositions: Map) => {
  pushAction({
    type: 'align_nodes',
    data: { oldPositions, newPositions },
    applyForward: () => { /* 设置新位置 */ },
    applyReverse: () => { /* 恢复旧位置 */ },
  });
},
```

## 4. 撤销重做

- **粘贴**：undo 移除粘贴的节点/边，redo 恢复
- **对齐**：undo 恢复旧位置，redo 应用新位置
- **复制**：不记录（纯剪贴板操作，不改变画布）
- **全选**：不记录（仅改变 selected 状态，不影响画布数据）

## 5. 协作广播

- 粘贴：通过 `canvasStore.addPastedNodes` 内部触发 `emitNodeChange`/`emitEdgeChange`
- 对齐：通过 `canvasStore.alignNodes` 内部触发 `emitNodeUpdate`
- 复制/全选：不广播（仅本地操作）

## 6. 错误处理

- 粘贴时剪贴板为空：静默忽略（不报错）
- 对齐时选中 <2：按钮 disabled
- 等距分布 <3 节点：降级为左对齐/顶对齐
- 快捷键在输入框聚焦时：不触发（检查 e.target）

## 7. 测试

### 单元测试（utils/alignment.ts）

- 8 个对齐函数各 1 个测试
- 边界：空数组、单节点、等距分布 <3 节点降级

### 手动验证清单

- 复制/粘贴：单节点、多节点+内部边、跨项目粘贴
- 全选/框选：Ctrl+A、拖拽框选、Cmd+点击多选
- 对齐工具：浮动工具条显示/隐藏、8 种对齐效果
- 撤销重做：粘贴和对齐的 undo/redo
- 协作：粘贴后其他用户同步看到
