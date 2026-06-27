import { create } from 'zustand';
import type { CanvasNode, CanvasEdge, CanvasNodeData, NodeStatus } from '@/types/canvas';
import { NODE_TEMPLATES } from '@/types/canvas';

interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;

  // 节点操作
  addNode: (subtype: string, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  setSelectedNode: (id: string | null) => void;

  // 边操作
  addEdge: (edge: CanvasEdge) => void;
  removeEdge: (id: string) => void;

  // 批量操作
  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;

  // 节点状态
  setNodeStatus: (id: string, status: NodeStatus, progress?: number) => void;
  setNodeError: (id: string, error: string) => void;
  setNodeOutput: (id: string, artifacts: import('@/types/canvas').Artifact[]) => void;

  // 清空
  clearCanvas: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,

  addNode: (subtype, position) => {
    const template = NODE_TEMPLATES.find((t) => t.subtype === subtype);
    if (!template) return;

    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newNode: CanvasNode = {
      id,
      type: template.type,
      position,
      data: {
        type: template.type,
        subtype: template.subtype,
        label: template.label,
        params: { ...template.defaultParams },
        status: 'idle',
        progress: 0,
        outputArtifacts: [],
      },
    };

    set((state) => ({ nodes: [...state.nodes, newNode] }));
  },

  removeNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    }));
  },

  updateNodeData: (id, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }));
  },

  updateNodePosition: (id, position) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position } : n
      ),
    }));
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
  },

  addEdge: (edge) => {
    set((state) => ({ edges: [...state.edges, edge] }));
  },

  removeEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    }));
  },

  setNodes: (nodes) => {
    set({ nodes });
  },

  setEdges: (edges) => {
    set({ edges });
  },

  setNodeStatus: (id, status, progress) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                status,
                progress: progress !== undefined ? progress : n.data.progress,
              },
            }
          : n
      ),
    }));
  },

  setNodeError: (id, error) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, status: 'failed' as NodeStatus, error } }
          : n
      ),
    }));
  },

  setNodeOutput: (id, artifacts) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, outputArtifacts: artifacts } }
          : n
      ),
    }));
  },

  clearCanvas: () => {
    set({ nodes: [], edges: [], selectedNodeId: null });
  },
}));
