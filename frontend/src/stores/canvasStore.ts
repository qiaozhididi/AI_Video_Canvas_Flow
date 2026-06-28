import { create } from 'zustand';
import type { CanvasNode, CanvasEdge, CanvasNodeData, NodeStatus } from '@/types/canvas';
import { NODE_TEMPLATES } from '@/types/canvas';
import { useCollabStore, type NodeUpdatePayload, type EdgeUpdatePayload } from './collabStore';

// ── 协作广播 helper ──
// 从 collabStore 读取当前 project_id（collabStore.connect 时设置）。
// 不从 projectStore 读取，避免 canvasStore ↔ projectStore 循环依赖。
function getProjectId(): string | null {
  return useCollabStore.getState().currentProjectId;
}

function emitNodeChange(action: string, node: CanvasNode): void {
  const projectId = getProjectId();
  if (!projectId) return;
  useCollabStore.getState().emitNodeUpdate({
    project_id: projectId,
    node_id: node.id,
    action,
    node,
  });
}

function emitNodeDelete(id: string): void {
  const projectId = getProjectId();
  if (!projectId) return;
  useCollabStore.getState().emitNodeUpdate({
    project_id: projectId,
    node_id: id,
    action: 'delete',
  });
}

function emitEdgeChange(action: string, edge: CanvasEdge): void {
  const projectId = getProjectId();
  if (!projectId) return;
  useCollabStore.getState().emitEdgeUpdate({
    project_id: projectId,
    edge_id: edge.id,
    action,
    edge,
  });
}

function emitEdgeDelete(id: string): void {
  const projectId = getProjectId();
  if (!projectId) return;
  useCollabStore.getState().emitEdgeUpdate({
    project_id: projectId,
    edge_id: id,
    action: 'delete',
  });
}

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

  // 远端变更应用（不触发 emit，避免回环）
  applyRemoteNodeUpdate: (data: NodeUpdatePayload) => void;
  applyRemoteEdgeUpdate: (data: EdgeUpdatePayload) => void;
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
    emitNodeChange('add', newNode);
  },

  removeNode: (id) => {
    // 先记录受影响的边，set 后广播删除（节点删除会连带删除关联边）
    const affectedEdges = get().edges.filter((e) => e.source === id || e.target === id);
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    }));
    emitNodeDelete(id);
    affectedEdges.forEach((e) => emitEdgeDelete(e.id));
  },

  updateNodeData: (id, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }));
    const updated = get().nodes.find((n) => n.id === id);
    if (updated) emitNodeChange('update', updated);
  },

  updateNodePosition: (id, position) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position } : n
      ),
    }));
    const updated = get().nodes.find((n) => n.id === id);
    if (updated) emitNodeChange('update', updated);
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
  },

  addEdge: (edge) => {
    set((state) => ({ edges: [...state.edges, edge] }));
    emitEdgeChange('add', edge);
  },

  removeEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    }));
    emitEdgeDelete(id);
  },

  setNodes: (nodes) => {
    // 批量加载（如 loadProjectToCanvas），不广播
    set({ nodes });
  },

  setEdges: (edges) => {
    // 批量加载（如 loadProjectToCanvas），不广播
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
    const updated = get().nodes.find((n) => n.id === id);
    if (updated) emitNodeChange('update', updated);
  },

  setNodeError: (id, error) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, status: 'failed' as NodeStatus, error } }
          : n
      ),
    }));
    const updated = get().nodes.find((n) => n.id === id);
    if (updated) emitNodeChange('update', updated);
  },

  setNodeOutput: (id, artifacts) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, outputArtifacts: artifacts } }
          : n
      ),
    }));
    const updated = get().nodes.find((n) => n.id === id);
    if (updated) emitNodeChange('update', updated);
  },

  clearCanvas: () => {
    // 整体重置（如切换项目），不广播
    set({ nodes: [], edges: [], selectedNodeId: null });
  },

  // ── 远端变更应用（绝不调 emit，避免回环） ──
  applyRemoteNodeUpdate: (data) => {
    const { node_id, action } = data;
    const node = data.node as CanvasNode | undefined;

    if (action === 'add') {
      if (!node) return;
      set((state) => {
        // 去重：避免回环或重复应用
        if (state.nodes.some((n) => n.id === node_id)) return state;
        return { nodes: [...state.nodes, node] };
      });
    } else if (action === 'update') {
      if (!node) return;
      set((state) => ({
        nodes: state.nodes.map((n) => (n.id === node_id ? node : n)),
      }));
    } else if (action === 'delete') {
      set((state) => ({
        nodes: state.nodes.filter((n) => n.id !== node_id),
        // 连带清理挂在该节点上的边
        edges: state.edges.filter((e) => e.source !== node_id && e.target !== node_id),
      }));
    }
  },

  applyRemoteEdgeUpdate: (data) => {
    const { edge_id, action } = data;
    const edge = data.edge as CanvasEdge | undefined;

    if (action === 'add') {
      if (!edge) return;
      set((state) => {
        if (state.edges.some((e) => e.id === edge_id)) return state;
        return { edges: [...state.edges, edge] };
      });
    } else if (action === 'update') {
      if (!edge) return;
      set((state) => ({
        edges: state.edges.map((e) => (e.id === edge_id ? edge : e)),
      }));
    } else if (action === 'delete') {
      set((state) => ({
        edges: state.edges.filter((e) => e.id !== edge_id),
      }));
    }
  },
}));
