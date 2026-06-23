import { create } from 'zustand';
import type {
  HistoryAction,
  HistoryTree,
  BranchNode,
  ActionType,
  AddNodePayload,
  RemoveNodePayload,
  MoveNodePayload,
  UpdateNodeDataPayload,
  AddEdgePayload,
  RemoveEdgePayload,
  BatchSetNodesPayload,
  BatchSetEdgesPayload,
  AddTrackPayload,
  RemoveTrackPayload,
  AddClipPayload,
  RemoveClipPayload,
  MoveClipPayload,
  ResizeClipPayload,
  ToggleTrackPayload,
} from '@/types/history';
import { useCanvasStore } from './canvasStore';
import { useTimelineStore } from './timelineStore';

const MAX_DEPTH = 100;
const MERGE_WINDOW = 500; // 500ms 内同类操作合并
const ROOT_BRANCH_ID = 'root';

function createAction(type: ActionType, label: string, payload: unknown, userId = 'local'): HistoryAction {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    label,
    payload,
    userId,
    timestamp: Date.now(),
    branchId: ROOT_BRANCH_ID, // 会被 pushAction 覆盖
  };
}

interface HistoryStoreState {
  tree: HistoryTree;
  canUndo: boolean;
  canRedo: boolean;
  isRecording: boolean;
  maxDepth: number;
  mergeWindow: number;
  /** 暂存待合并的操作 */
  pendingMerge: HistoryAction | null;
  /** 合并定时器 */
  mergeTimer: ReturnType<typeof setTimeout> | null;
}

interface HistoryStoreActions {
  // 核心操作
  pushAction: (action: HistoryAction) => void;
  undo: () => void;
  redo: () => void;

  // 便捷方法：各操作类型的 push 封装
  pushAddNode: (payload: AddNodePayload) => void;
  pushRemoveNode: (payload: RemoveNodePayload) => void;
  pushMoveNode: (payload: MoveNodePayload) => void;
  pushUpdateNodeData: (payload: UpdateNodeDataPayload) => void;
  pushAddEdge: (payload: AddEdgePayload) => void;
  pushRemoveEdge: (payload: RemoveEdgePayload) => void;
  pushBatchSetNodes: (payload: BatchSetNodesPayload) => void;
  pushBatchSetEdges: (payload: BatchSetEdgesPayload) => void;
  pushAddTrack: (payload: AddTrackPayload) => void;
  pushRemoveTrack: (payload: RemoveTrackPayload) => void;
  pushAddClip: (payload: AddClipPayload) => void;
  pushRemoveClip: (payload: RemoveClipPayload) => void;
  pushMoveClip: (payload: MoveClipPayload) => void;
  pushResizeClip: (payload: ResizeClipPayload) => void;
  pushToggleTrack: (payload: ToggleTrackPayload) => void;

  // 录制控制
  pauseRecording: () => void;
  resumeRecording: () => void;

  // 分支操作
  jumpToAction: (actionId: string) => void;

  // 清空
  clearHistory: () => void;
}

type HistoryStore = HistoryStoreState & HistoryStoreActions;

function createInitialTree(): HistoryTree {
  const rootBranch: BranchNode = {
    id: ROOT_BRANCH_ID,
    parentId: null,
    actions: [],
    forkAfterActionId: null,
    createdAt: Date.now(),
  };
  return {
    branches: [rootBranch],
    activeBranchId: ROOT_BRANCH_ID,
    pointer: -1,
  };
}

/** 逆向执行一个操作 */
function applyReverse(action: HistoryAction) {
  const canvasStore = useCanvasStore.getState();
  const timelineStore = useTimelineStore.getState();

  switch (action.type) {
    case 'add_node': {
      const p = action.payload as AddNodePayload;
      canvasStore.setNodes(canvasStore.nodes.filter((n) => n.id !== p.node.id));
      break;
    }
    case 'remove_node': {
      const p = action.payload as RemoveNodePayload;
      canvasStore.setNodes([...canvasStore.nodes, p.node]);
      canvasStore.setEdges([...canvasStore.edges, ...p.affectedEdges]);
      break;
    }
    case 'move_node': {
      const p = action.payload as MoveNodePayload;
      canvasStore.setNodes(
        canvasStore.nodes.map((n) =>
          n.id === p.nodeId ? { ...n, position: p.from } : n
        )
      );
      break;
    }
    case 'update_node_data': {
      const p = action.payload as UpdateNodeDataPayload;
      canvasStore.setNodes(
        canvasStore.nodes.map((n) =>
          n.id === p.nodeId ? { ...n, data: { ...n.data, ...p.from } } : n
        )
      );
      break;
    }
    case 'add_edge': {
      const p = action.payload as AddEdgePayload;
      canvasStore.setEdges(canvasStore.edges.filter((e) => e.id !== p.edge.id));
      break;
    }
    case 'remove_edge': {
      const p = action.payload as RemoveEdgePayload;
      canvasStore.setEdges([...canvasStore.edges, p.edge]);
      break;
    }
    case 'batch_set_nodes': {
      const p = action.payload as BatchSetNodesPayload;
      canvasStore.setNodes(p.from);
      break;
    }
    case 'batch_set_edges': {
      const p = action.payload as BatchSetEdgesPayload;
      canvasStore.setEdges(p.from);
      break;
    }
    case 'add_track': {
      const p = action.payload as AddTrackPayload;
      timelineStore.removeTrack(p.track.id);
      break;
    }
    case 'remove_track': {
      const p = action.payload as RemoveTrackPayload;
      // 重新插入到原位置
      const tracks = [...timelineStore.data.tracks];
      tracks.splice(p.trackIndex, 0, p.track);
      timelineStore.loadTimeline({ ...timelineStore.data, tracks });
      break;
    }
    case 'add_clip': {
      const p = action.payload as AddClipPayload;
      timelineStore.removeClip(p.trackId, p.clip.id);
      break;
    }
    case 'remove_clip': {
      const p = action.payload as RemoveClipPayload;
      timelineStore.addClip(p.trackId, p.clip);
      break;
    }
    case 'move_clip': {
      const p = action.payload as MoveClipPayload;
      timelineStore.moveClip(p.trackId, p.clipId, p.from);
      break;
    }
    case 'resize_clip': {
      const p = action.payload as ResizeClipPayload;
      timelineStore.resizeClip(p.trackId, p.clipId, p.fromStart, p.fromEnd);
      break;
    }
    case 'toggle_track_mute':
    case 'toggle_track_lock':
    case 'toggle_track_visibility': {
      const p = action.payload as ToggleTrackPayload;
      if (p.property === 'muted') timelineStore.toggleTrackMute(p.trackId);
      else if (p.property === 'locked') timelineStore.toggleTrackLock(p.trackId);
      else timelineStore.toggleTrackVisibility(p.trackId);
      break;
    }
  }
}

/** 正向执行一个操作 */
function applyForward(action: HistoryAction) {
  const canvasStore = useCanvasStore.getState();
  const timelineStore = useTimelineStore.getState();

  switch (action.type) {
    case 'add_node': {
      const p = action.payload as AddNodePayload;
      canvasStore.setNodes([...canvasStore.nodes, p.node]);
      break;
    }
    case 'remove_node': {
      const p = action.payload as RemoveNodePayload;
      canvasStore.setNodes(canvasStore.nodes.filter((n) => n.id !== p.node.id));
      canvasStore.setEdges(canvasStore.edges.filter((e) => e.source !== p.node.id && e.target !== p.node.id));
      break;
    }
    case 'move_node': {
      const p = action.payload as MoveNodePayload;
      canvasStore.setNodes(
        canvasStore.nodes.map((n) =>
          n.id === p.nodeId ? { ...n, position: p.to } : n
        )
      );
      break;
    }
    case 'update_node_data': {
      const p = action.payload as UpdateNodeDataPayload;
      canvasStore.setNodes(
        canvasStore.nodes.map((n) =>
          n.id === p.nodeId ? { ...n, data: { ...n.data, ...p.to } } : n
        )
      );
      break;
    }
    case 'add_edge': {
      const p = action.payload as AddEdgePayload;
      canvasStore.setEdges([...canvasStore.edges, p.edge]);
      break;
    }
    case 'remove_edge': {
      const p = action.payload as RemoveEdgePayload;
      canvasStore.setEdges(canvasStore.edges.filter((e) => e.id !== p.edge.id));
      break;
    }
    case 'batch_set_nodes': {
      const p = action.payload as BatchSetNodesPayload;
      canvasStore.setNodes(p.to);
      break;
    }
    case 'batch_set_edges': {
      const p = action.payload as BatchSetEdgesPayload;
      canvasStore.setEdges(p.to);
      break;
    }
    case 'add_track': {
      const p = action.payload as AddTrackPayload;
      timelineStore.addTrack(p.track.type);
      break;
    }
    case 'add_clip': {
      const p = action.payload as AddClipPayload;
      timelineStore.addClip(p.trackId, p.clip);
      break;
    }
    case 'remove_clip': {
      const p = action.payload as RemoveClipPayload;
      timelineStore.removeClip(p.trackId, p.clip.id);
      break;
    }
    case 'move_clip': {
      const p = action.payload as MoveClipPayload;
      timelineStore.moveClip(p.trackId, p.clipId, p.to);
      break;
    }
    case 'resize_clip': {
      const p = action.payload as ResizeClipPayload;
      timelineStore.resizeClip(p.trackId, p.clipId, p.toStart, p.toEnd);
      break;
    }
    case 'toggle_track_mute':
    case 'toggle_track_lock':
    case 'toggle_track_visibility': {
      const p = action.payload as ToggleTrackPayload;
      if (p.property === 'muted') timelineStore.toggleTrackMute(p.trackId);
      else if (p.property === 'locked') timelineStore.toggleTrackLock(p.trackId);
      else timelineStore.toggleTrackVisibility(p.trackId);
      break;
    }
  }
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  tree: createInitialTree(),
  canUndo: false,
  canRedo: false,
  isRecording: true,
  maxDepth: MAX_DEPTH,
  mergeWindow: MERGE_WINDOW,
  pendingMerge: null,
  mergeTimer: null,

  pushAction: (action) => {
    const state = get();
    if (!state.isRecording) return;

    const { tree } = state;
    const activeBranch = tree.branches.find((b) => b.id === tree.activeBranchId);
    if (!activeBranch) return;

    // 检查是否可与 pendingMerge 合并（同类操作 + 在合并窗口内）
    if (state.pendingMerge && state.pendingMerge.type === action.type) {
      const elapsed = action.timestamp - state.pendingMerge.timestamp;
      if (elapsed < state.mergeWindow) {
        // 合并：更新 pendingMerge 的 payload（保留最新值），不创建新操作
        const mergedAction: HistoryAction = {
          ...action,
          id: state.pendingMerge.id,
          // 对于 move_node，保留 from 为最早的位置
          payload: action.type === 'move_node'
            ? { ...(action.payload as MoveNodePayload), from: (state.pendingMerge.payload as MoveNodePayload).from }
            : action.payload,
        };

        // 重置合并定时器
        if (state.mergeTimer) clearTimeout(state.mergeTimer);
        const timer = setTimeout(() => {
          // 合并窗口结束，将 pendingMerge 正式入栈
          const current = get();
          const pending = current.pendingMerge;
          if (pending) {
            get().pushAction({ ...pending }); // 递归但此时 pendingMerge 已清空
          }
        }, state.mergeWindow);

        set({ pendingMerge: mergedAction, mergeTimer: timer });
        return;
      }
    }

    // 如果有 pendingMerge，先将其入栈
    if (state.pendingMerge) {
      if (state.mergeTimer) clearTimeout(state.mergeTimer);
      // 直接将 pendingMerge 追加到分支
      const pendingAction = { ...state.pendingMerge, branchId: tree.activeBranchId };
      const updatedActions = [...activeBranch.actions.slice(0, tree.pointer + 1), pendingAction];

      // 超出最大深度，移除最旧的操作
      const trimmed = updatedActions.length > state.maxDepth
        ? updatedActions.slice(updatedActions.length - state.maxDepth)
        : updatedActions;

      const updatedBranch: BranchNode = { ...activeBranch, actions: trimmed };
      const updatedTree: HistoryTree = {
        ...tree,
        branches: tree.branches.map((b) => (b.id === updatedBranch.id ? updatedBranch : b)),
        pointer: trimmed.length - 1,
      };

      set({
        tree: updatedTree,
        canUndo: true,
        canRedo: false,
        pendingMerge: null,
        mergeTimer: null,
      });

      // 然后将当前 action 设为新的 pendingMerge
      const newTimer = setTimeout(() => {
        const current = get();
        const pending = current.pendingMerge;
        if (pending) {
          get().pushAction({ ...pending });
        }
      }, state.mergeWindow);

      set({
        pendingMerge: { ...action, branchId: tree.activeBranchId },
        mergeTimer: newTimer,
      });
      return;
    }

    // 正常入栈逻辑
    const newAction: HistoryAction = { ...action, branchId: tree.activeBranchId };
    // 截断 pointer 之后的操作（创建新分支的起点）
    const updatedActions = [...activeBranch.actions.slice(0, tree.pointer + 1), newAction];

    const trimmed = updatedActions.length > state.maxDepth
      ? updatedActions.slice(updatedActions.length - state.maxDepth)
      : updatedActions;

    const updatedBranch: BranchNode = { ...activeBranch, actions: trimmed };
    const updatedTree: HistoryTree = {
      ...tree,
      branches: tree.branches.map((b) => (b.id === updatedBranch.id ? updatedBranch : b)),
      pointer: trimmed.length - 1,
    };

    set({
      tree: updatedTree,
      canUndo: true,
      canRedo: false,
    });

    // 将当前操作设为 pendingMerge（等待可能的合并）
    const timer = setTimeout(() => {
      const current = get();
      if (current.pendingMerge) {
        // 窗口结束，pendingMerge 已在 pushAction 中处理，此处仅清空
        set({ pendingMerge: null, mergeTimer: null });
      }
    }, state.mergeWindow);

    set({ pendingMerge: newAction, mergeTimer: timer });
  },

  undo: () => {
    const { tree, canUndo } = get();
    if (!canUndo) return;

    const activeBranch = tree.branches.find((b) => b.id === tree.activeBranchId);
    if (!activeBranch || tree.pointer < 0) return;

    const action = activeBranch.actions[tree.pointer];
    if (!action) return;

    // 暂停录制，避免逆向操作被记录
    get().pauseRecording();
    applyReverse(action);
    get().resumeRecording();

    const newPointer = tree.pointer - 1;
    set({
      tree: { ...tree, pointer: newPointer },
      canUndo: newPointer >= 0,
      canRedo: true,
    });
  },

  redo: () => {
    const { tree, canRedo } = get();
    if (!canRedo) return;

    const activeBranch = tree.branches.find((b) => b.id === tree.activeBranchId);
    if (!activeBranch) return;

    const nextPointer = tree.pointer + 1;
    const action = activeBranch.actions[nextPointer];
    if (!action) return;

    get().pauseRecording();
    applyForward(action);
    get().resumeRecording();

    set({
      tree: { ...tree, pointer: nextPointer },
      canUndo: true,
      canRedo: nextPointer < activeBranch.actions.length - 1,
    });
  },

  // ========== 便捷方法 ==========

  pushAddNode: (payload) => get().pushAction(createAction('add_node', `添加节点: ${payload.node.data.label}`, payload)),
  pushRemoveNode: (payload) => get().pushAction(createAction('remove_node', `删除节点: ${payload.node.data.label}`, payload)),
  pushMoveNode: (payload) => get().pushAction(createAction('move_node', `移动节点`, payload)),
  pushUpdateNodeData: (payload) => get().pushAction(createAction('update_node_data', `修改节点参数`, payload)),
  pushAddEdge: (payload) => get().pushAction(createAction('add_edge', '添加连线', payload)),
  pushRemoveEdge: (payload) => get().pushAction(createAction('remove_edge', '删除连线', payload)),
  pushBatchSetNodes: (payload) => get().pushAction(createAction('batch_set_nodes', '批量更新节点', payload)),
  pushBatchSetEdges: (payload) => get().pushAction(createAction('batch_set_edges', '批量更新连线', payload)),
  pushAddTrack: (payload) => get().pushAction(createAction('add_track', `添加轨道: ${payload.track.label}`, payload)),
  pushRemoveTrack: (payload) => get().pushAction(createAction('remove_track', `删除轨道: ${payload.track.label}`, payload)),
  pushAddClip: (payload) => get().pushAction(createAction('add_clip', `添加片段: ${payload.clip.label}`, payload)),
  pushRemoveClip: (payload) => get().pushAction(createAction('remove_clip', `删除片段: ${payload.clip.label}`, payload)),
  pushMoveClip: (payload) => get().pushAction(createAction('move_clip', `移动片段`, payload)),
  pushResizeClip: (payload) => get().pushAction(createAction('resize_clip', `调整片段时长`, payload)),
  pushToggleTrack: (payload) => get().pushAction(createAction('toggle_track_mute', `切换轨道状态`, payload)),

  pauseRecording: () => set({ isRecording: false }),
  resumeRecording: () => set({ isRecording: true }),

  jumpToAction: (actionId) => {
    const { tree } = get();
    const activeBranch = tree.branches.find((b) => b.id === tree.activeBranchId);
    if (!activeBranch) return;

    const targetIndex = activeBranch.actions.findIndex((a) => a.id === actionId);
    if (targetIndex === -1) return;

    get().pauseRecording();

    if (targetIndex < tree.pointer) {
      // 需要撤销
      for (let i = tree.pointer; i > targetIndex; i--) {
        applyReverse(activeBranch.actions[i]);
      }
    } else {
      // 需要重做
      for (let i = tree.pointer + 1; i <= targetIndex; i++) {
        applyForward(activeBranch.actions[i]);
      }
    }

    get().resumeRecording();

    set({
      tree: { ...tree, pointer: targetIndex },
      canUndo: targetIndex > 0,
      canRedo: targetIndex < activeBranch.actions.length - 1,
    });
  },

  clearHistory: () => {
    const state = get();
    if (state.mergeTimer) clearTimeout(state.mergeTimer);
    set({
      tree: createInitialTree(),
      canUndo: false,
      canRedo: false,
      pendingMerge: null,
      mergeTimer: null,
    });
  },
}));
