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
