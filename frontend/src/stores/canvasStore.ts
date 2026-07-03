import { create } from 'zustand';
import type { CanvasNode, CanvasEdge, CanvasNodeData, NodeStatus } from '@/types/canvas';
import { NODE_TEMPLATES } from '@/types/canvas';
import { useCollabStore, type NodeUpdatePayload, type EdgeUpdatePayload } from './collabStore';
import { useAutoSaveStore } from './autoSaveStore';
import { useHistoryStore } from './historyStore';
import { toCanvasNode, toCanvasEdge } from '@/utils/canvasTransform';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';

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
  selectedNodeIds: string[];  // 多选状态（React Flow onSelectionChange 同步）

  // 节点操作
  addNode: (subtype: string, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;  // 批量删除（单次写历史）
  updateNodeData: (id: string, data: Partial<CanvasNodeData>) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  setSelectedNode: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  selectAll: () => void;

  // inline 重命名编辑态
  editingNodeId: string | null;
  setEditingNodeId: (id: string | null) => void;
  renameNode: (id: string, newLabel: string) => void;

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

  // fitView 触发(Canvas.tsx 监听 token 变化触发 reactFlowInstance.fitView)
  fitViewToken: number;
  requestFitView: () => void;

  // AI 快速生成:加载后端返回的 nodes/edges 到画布
  loadGeneratedWorkflow: (
    nodes: NodeCreateRequest[],
    edges: EdgeCreateRequest[],
    mode: 'replace' | 'append',
  ) => void;

  // 远端变更应用（不触发 emit，避免回环）
  applyRemoteNodeUpdate: (data: NodeUpdatePayload) => void;
  applyRemoteEdgeUpdate: (data: EdgeUpdatePayload) => void;

  // 粘贴节点（由 clipboardStore.paste 调用）
  addPastedNodes: (
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    targetPosition?: { x: number; y: number },
  ) => void;

  // 对齐节点位置
  alignNodes: (updates: Map<string, { x: number; y: number }>) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  editingNodeId: null,

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

  addEdge: (edge) => {
    set((state) => ({ edges: [...state.edges, edge] }));
    emitEdgeChange('add', edge);
  },

  removeEdge: (id) => {
    const edge = get().edges.find((e) => e.id === id);
    if (!edge) return;
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    }));
    useHistoryStore.getState().pushRemoveEdge({ edge });
    useAutoSaveStore.getState().markDirty();
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
                // 非 failed 状态清除 error，避免重试后残留旧错误信息
                error: status !== 'failed' ? undefined : n.data.error,
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
    set({ nodes: [], edges: [], selectedNodeId: null, editingNodeId: null });
  },

  fitViewToken: 0,

  requestFitView: () => {
    set((state) => ({ fitViewToken: state.fitViewToken + 1 }));
  },

  loadGeneratedWorkflow: (nodes, edges, mode) => {
    const newNodes = nodes.map(toCanvasNode);

    if (mode === 'replace') {
      // 替换:清空后加载(不广播,避免高频 emit)
      set({ nodes: newNodes, edges: edges.map(toCanvasEdge), selectedNodeId: null });
    } else {
      // 追加:保留现有节点,新节点直接 push;edges 的 id 加前缀避免冲突
      const existingIds = new Set(get().nodes.map((n) => n.id));
      const existingEdgeIds = new Set(get().edges.map((e) => e.id));
      const dedupedNodes = newNodes.filter((n) => !existingIds.has(n.id));
      const newEdges = edges
        .map((e, idx) => {
          const converted = toCanvasEdge(e);
          // 加前缀避免与现有 edge id 冲突
          return { ...converted, id: `gen-${converted.id}-${idx}` };
        })
        .filter((e) => !existingEdgeIds.has(e.id));

      set((state) => ({
        nodes: [...state.nodes, ...dedupedNodes],
        edges: [...state.edges, ...newEdges],
      }));
    }

    // 选中首个节点(便于用户立即查看属性)
    if (newNodes.length > 0) {
      set({ selectedNodeId: newNodes[0].id });
    }

    // 触发 fitView(Canvas.tsx 监听 fitViewToken 变化)
    get().requestFitView();

    // 标记脏状态(触发 autoSaveStore 防抖保存)
    useAutoSaveStore.getState().markDirty();
  },

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
