import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from './historyStore';
import { useCanvasStore } from './canvasStore';
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

// 注意：historyStore 有 mergeWindow=500ms 合并机制，同类操作在 500ms 内会合并为一个 action。
// 同步测试中 Date.now() 几乎不变，elapsed≈0 < 500，所以连续的同类 pushAddNode 会合并。
// 因此需要"多个不同 action"的用例（jumpToAction / MAX_DEPTH）使用不同 action 类型避免合并。
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
    it('向后跳到指定 action（pointer 从 2 回到 0）', () => {
      // 使用不同 action 类型避免被 mergeWindow 合并
      // 连续同类操作（如 pushAddNode x3）在 500ms 内会合并为 1 个 action，无法测试跳转
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });
      useHistoryStore.getState().pushRemoveEdge({ edge: makeEdge('e1', 'n1', 'n2') });
      useHistoryStore.getState().pushBatchSetNodes({ from: [], to: [makeNode('n2')] });

      const actions = useHistoryStore.getState().tree.branches[0].actions;
      expect(actions.length).toBeGreaterThanOrEqual(3);
      expect(useHistoryStore.getState().tree.pointer).toBeGreaterThanOrEqual(2);

      // 跳到第一个 action
      useHistoryStore.getState().jumpToAction(actions[0].id);

      expect(useHistoryStore.getState().tree.pointer).toBe(0);
    });
  });

  describe('clearHistory', () => {
    it('清空所有历史', () => {
      useHistoryStore.getState().pushAddNode({ node: makeNode('n1') });
      useHistoryStore.getState().pushRemoveEdge({ edge: makeEdge('e1', 'n1', 'n2') });

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
      // 使用不同 action 类型循环，避免连续同类操作被 mergeWindow 合并
      // 若全部使用 pushAddNode，105 次调用会合并为 1 个 action，无法触发 MAX_DEPTH 裁剪
      const operations: Array<() => void> = [
        () => useHistoryStore.getState().pushAddNode({ node: makeNode('n') }),
        () => useHistoryStore.getState().pushRemoveEdge({ edge: makeEdge('e', 'n1', 'n2') }),
        () => useHistoryStore.getState().pushBatchSetNodes({ from: [], to: [] }),
        () => useHistoryStore.getState().pushAddEdge({ edge: makeEdge('e', 'n1', 'n2') }),
        () => useHistoryStore.getState().pushBatchSetEdges({ from: [], to: [] }),
      ];
      for (let i = 0; i < 105; i++) {
        operations[i % operations.length]();
      }
      const actions = useHistoryStore.getState().tree.branches[0].actions;
      expect(actions.length).toBeLessThanOrEqual(100);
    });
  });
});
