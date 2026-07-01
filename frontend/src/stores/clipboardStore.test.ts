import { describe, it, expect, beforeEach } from 'vitest';
import { useClipboardStore } from './clipboardStore';
import type { CanvasNode, CanvasEdge } from '@/types/canvas';

// 构造测试节点的辅助函数
const makeNode = (
  id: string,
  x = 0,
  y = 0,
  overrides: Partial<CanvasNode['data']> = {},
): CanvasNode => ({
  id,
  type: 'input',
  position: { x, y },
  data: {
    type: 'input',
    subtype: 'text_input',
    label: `节点-${id}`,
    params: { text: 'hello' },
    status: 'completed',
    progress: 100,
    outputArtifacts: [
      {
        id: 'art-1',
        type: 'image',
        url: 'http://example.com/a.png',
        filename: 'a.png',
        size: 1024,
      },
    ],
    ...overrides,
  },
  measured: { width: 200, height: 100 },
});

const makeEdge = (
  id: string,
  source: string,
  target: string,
): CanvasEdge => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  type: 'default',
  animated: true,
});

// 每个测试前重置 store 状态，避免相互影响
beforeEach(() => {
  useClipboardStore.getState().clear();
});

describe('copy - 复制到剪贴板', () => {
  it('空节点数组：不设置剪贴板', () => {
    useClipboardStore.getState().copy([], []);
    expect(useClipboardStore.getState().clipboard).toBeNull();
  });

  it('正常复制：保存 nodes 和 edges，pasteCount 重置为 0', () => {
    const nodes = [makeNode('a', 10, 20), makeNode('b', 30, 40)];
    const edges = [makeEdge('e1', 'a', 'b')];
    useClipboardStore.getState().copy(nodes, edges);

    const state = useClipboardStore.getState();
    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.nodes).toHaveLength(2);
    expect(state.clipboard!.edges).toHaveLength(1);
    expect(state.pasteCount).toBe(0);
    expect(typeof state.clipboard!.copiedAt).toBe('number');
  });

  it('深拷贝：修改原节点不影响剪贴板数据', () => {
    const nodes = [makeNode('a', 10, 20)];
    useClipboardStore.getState().copy(nodes, []);
    nodes[0].data.label = '已修改';
    nodes[0].position.x = 999;

    const clip = useClipboardStore.getState().clipboard!;
    expect(clip.nodes[0].data.label).toBe('节点-a');
    expect(clip.nodes[0].position.x).toBe(10);
  });

  it('深拷贝：data 对象独立', () => {
    const nodes = [makeNode('a', 0, 0, { params: { text: '原始' } })];
    useClipboardStore.getState().copy(nodes, []);
    nodes[0].data.params.text = '被改';
    expect(useClipboardStore.getState().clipboard!.nodes[0].data.params.text).toBe(
      '原始',
    );
  });

  it('深拷贝：edges 对象独立（需带节点，copy 空节点数组会跳过）', () => {
    const nodes = [makeNode('a', 0, 0)];
    const edges = [makeEdge('e1', 'a', 'b')];
    useClipboardStore.getState().copy(nodes, edges);
    edges[0].source = 'changed';
    expect(useClipboardStore.getState().clipboard!.edges[0].source).toBe('a');
  });
});

describe('paste - 粘贴', () => {
  it('剪贴板为空：返回 null', () => {
    expect(useClipboardStore.getState().paste()).toBeNull();
  });

  it('生成新 ID，格式为 paste-{原id}-{ts}-{rand}', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    const result = useClipboardStore.getState().paste();
    expect(result).not.toBeNull();
    expect(result!.nodes[0].id).toMatch(/^paste-a-\d+-[a-z0-9]+$/);
    // 原 id 不应出现在新节点中
    expect(result!.nodes[0].id).not.toBe('a');
  });

  it('位置偏移 +20px（x 和 y 均偏移）', () => {
    useClipboardStore.getState().copy([makeNode('a', 100, 200)], []);
    const result = useClipboardStore.getState().paste();
    expect(result!.nodes[0].position).toEqual({ x: 120, y: 220 });
  });

  it('输出重置：outputArtifacts 清空', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    const result = useClipboardStore.getState().paste();
    expect(result!.nodes[0].data.outputArtifacts).toEqual([]);
  });

  it('状态重置：status=idle, progress=0', () => {
    useClipboardStore.getState().copy(
      [makeNode('a', 0, 0, { status: 'completed', progress: 100 })],
      [],
    );
    const result = useClipboardStore.getState().paste();
    expect(result!.nodes[0].data.status).toBe('idle');
    expect(result!.nodes[0].data.progress).toBe(0);
  });

  it('params 深拷贝：修改不影响剪贴板原 params', () => {
    useClipboardStore.getState().copy(
      [makeNode('a', 0, 0, { params: { text: '原' } })],
      [],
    );
    const result = useClipboardStore.getState().paste();
    result!.nodes[0].data.params.text = '改';
    expect(
      useClipboardStore.getState().clipboard!.nodes[0].data.params.text,
    ).toBe('原');
  });

  it('保留 type/measured 等结构字段', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    const result = useClipboardStore.getState().paste();
    expect(result!.nodes[0].type).toBe('input');
    expect(result!.nodes[0].measured).toEqual({ width: 200, height: 100 });
    expect(result!.nodes[0].data.subtype).toBe('text_input');
    expect(result!.nodes[0].data.label).toBe('节点-a');
  });

  it('内部边重映射 source/target 到新 ID', () => {
    useClipboardStore.getState().copy(
      [makeNode('a', 0, 0), makeNode('b', 50, 50)],
      [makeEdge('e1', 'a', 'b')],
    );
    const result = useClipboardStore.getState().paste();
    expect(result!.edges).toHaveLength(1);
    const edge = result!.edges[0];
    expect(edge.source).toMatch(/^paste-a-/);
    expect(edge.target).toMatch(/^paste-b-/);
    expect(edge.source).not.toBe('a');
    expect(edge.target).not.toBe('b');
  });

  it('边 ID 格式为 paste-edge-{原id}-{ts}-{rand}', () => {
    useClipboardStore.getState().copy(
      [makeNode('a', 0, 0), makeNode('b', 0, 0)],
      [makeEdge('e1', 'a', 'b')],
    );
    const result = useClipboardStore.getState().paste();
    expect(result!.edges[0].id).toMatch(/^paste-edge-e1-\d+-[a-z0-9]+$/);
  });

  it('保留边的 sourceHandle/targetHandle/type/animated', () => {
    useClipboardStore.getState().copy(
      [makeNode('a', 0, 0), makeNode('b', 0, 0)],
      [makeEdge('e1', 'a', 'b')],
    );
    const result = useClipboardStore.getState().paste();
    const edge = result!.edges[0];
    expect(edge.sourceHandle).toBe('out');
    expect(edge.targetHandle).toBe('in');
    expect(edge.type).toBe('default');
    expect(edge.animated).toBe(true);
  });

  it('过滤外部边：仅保留 source 和 target 都在选中节点内的边', () => {
    // a→b 是内部边，c→d 是外部边（c/d 未复制）
    useClipboardStore.getState().copy(
      [makeNode('a', 0, 0), makeNode('b', 0, 0)],
      [
        makeEdge('e1', 'a', 'b'), // 内部
        makeEdge('e2', 'a', 'c'), // 外部（c 未复制）
        makeEdge('e3', 'c', 'b'), // 外部（c 未复制）
      ],
    );
    const result = useClipboardStore.getState().paste();
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0].id).toMatch(/^paste-edge-e1-/);
  });

  it('多次粘贴：pasteCount 递增', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    useClipboardStore.getState().paste();
    useClipboardStore.getState().paste();
    useClipboardStore.getState().paste();
    expect(useClipboardStore.getState().pasteCount).toBe(3);
  });

  it('每次粘贴生成的 ID 不同（ts + rand）', async () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    const r1 = useClipboardStore.getState().paste()!;
    // 微小延时确保 ts 可能不同（即使 ts 相同，rand 也应不同）
    await new Promise((r) => setTimeout(r, 1));
    const r2 = useClipboardStore.getState().paste()!;
    expect(r1.nodes[0].id).not.toBe(r2.nodes[0].id);
  });

  it('粘贴不修改剪贴板内容（可重复粘贴）', () => {
    useClipboardStore.getState().copy([makeNode('a', 100, 100)], []);
    useClipboardStore.getState().paste();
    useClipboardStore.getState().paste();
    const clip = useClipboardStore.getState().clipboard!;
    // 剪贴板中的节点仍是原始数据
    expect(clip.nodes[0].id).toBe('a');
    expect(clip.nodes[0].position).toEqual({ x: 100, y: 100 });
  });
});

describe('hasClipboard - 剪贴板是否非空', () => {
  it('初始状态：返回 false', () => {
    expect(useClipboardStore.getState().hasClipboard()).toBe(false);
  });

  it('copy 后：返回 true', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    expect(useClipboardStore.getState().hasClipboard()).toBe(true);
  });

  it('clear 后：返回 false', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    useClipboardStore.getState().clear();
    expect(useClipboardStore.getState().hasClipboard()).toBe(false);
  });
});

describe('clear - 清空剪贴板', () => {
  it('清空 clipboard 和 pasteCount', () => {
    useClipboardStore.getState().copy([makeNode('a', 0, 0)], []);
    useClipboardStore.getState().paste();
    useClipboardStore.getState().paste();
    useClipboardStore.getState().clear();
    const state = useClipboardStore.getState();
    expect(state.clipboard).toBeNull();
    expect(state.pasteCount).toBe(0);
  });

  it('对空剪贴板调用 clear 不报错', () => {
    expect(() => useClipboardStore.getState().clear()).not.toThrow();
  });
});
