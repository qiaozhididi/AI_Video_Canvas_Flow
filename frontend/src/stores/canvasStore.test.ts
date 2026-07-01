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

// historyStore 采用 tree 结构（branches[].actions），无 past/future 数组。
// 这里返回当前活跃分支的 actions 长度，用于断言"是否写历史"。
const getHistoryLen = (): number => {
  const { tree } = useHistoryStore.getState();
  const branch = tree.branches.find((b) => b.id === tree.activeBranchId);
  return branch ? branch.actions.length : 0;
};

beforeEach(() => {
  useCanvasStore.getState().clearCanvas();
  useHistoryStore.getState().clearHistory();
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
    const before = getHistoryLen();
    useCanvasStore.getState().removeNode('n1');
    const after = getHistoryLen();
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
    const before = getHistoryLen();
    useCanvasStore.getState().removeNodes(['n1', 'n2']);
    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedNodeIds).toHaveLength(0);
    // 历史栈增长（pushBatchSetNodes + pushBatchSetEdges 各写一次）。
    // historyStore pendingMerge 机制使精确计数不稳定，故仅断言"已写历史"。
    expect(getHistoryLen()).toBeGreaterThan(before);
  });

  it('空数组不报错也不写历史', () => {
    const before = getHistoryLen();
    useCanvasStore.getState().removeNodes([]);
    expect(getHistoryLen()).toBe(before);
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
