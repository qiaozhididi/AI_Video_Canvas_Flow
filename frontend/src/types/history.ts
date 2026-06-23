import type { CanvasNode, CanvasEdge, CanvasNodeData } from './canvas';
import type { Track, Clip } from './timeline';

// ========== 操作类型枚举 ==========

/** 画布操作类型 */
export type CanvasActionType =
  | 'add_node'
  | 'remove_node'
  | 'move_node'
  | 'update_node_data'
  | 'add_edge'
  | 'remove_edge'
  | 'batch_set_nodes'
  | 'batch_set_edges';

/** 时间轴操作类型 */
export type TimelineActionType =
  | 'add_track'
  | 'remove_track'
  | 'add_clip'
  | 'remove_clip'
  | 'move_clip'
  | 'resize_clip'
  | 'toggle_track_mute'
  | 'toggle_track_lock'
  | 'toggle_track_visibility';

/** 所有操作类型 */
export type ActionType = CanvasActionType | TimelineActionType;

// ========== 操作载荷 ==========

export interface AddNodePayload {
  node: CanvasNode;
}

export interface RemoveNodePayload {
  node: CanvasNode;
  affectedEdges: CanvasEdge[];
}

export interface MoveNodePayload {
  nodeId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface UpdateNodeDataPayload {
  nodeId: string;
  from: Partial<CanvasNodeData>;
  to: Partial<CanvasNodeData>;
}

export interface AddEdgePayload {
  edge: CanvasEdge;
}

export interface RemoveEdgePayload {
  edge: CanvasEdge;
}

export interface BatchSetNodesPayload {
  from: CanvasNode[];
  to: CanvasNode[];
}

export interface BatchSetEdgesPayload {
  from: CanvasEdge[];
  to: CanvasEdge[];
}

export interface AddTrackPayload {
  track: Track;
}

export interface RemoveTrackPayload {
  track: Track;
  trackIndex: number;
}

export interface AddClipPayload {
  trackId: string;
  clip: Clip;
}

export interface RemoveClipPayload {
  trackId: string;
  clip: Clip;
}

export interface MoveClipPayload {
  trackId: string;
  clipId: string;
  from: number;
  to: number;
}

export interface ResizeClipPayload {
  trackId: string;
  clipId: string;
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
}

export interface ToggleTrackPayload {
  trackId: string;
  property: 'muted' | 'locked' | 'visible';
  from: boolean;
  to: boolean;
}

// ========== 操作单元 ==========

/** 单个操作单元 */
export interface HistoryAction {
  id: string;
  type: ActionType;
  label: string;
  payload: unknown;
  userId: string;
  timestamp: number;
  /** 该操作所属分支 ID */
  branchId: string;
}

// ========== 分支式撤销树 ==========

/** 分支节点 */
export interface BranchNode {
  id: string;
  /** 父分支 ID，根节点为 null */
  parentId: string | null;
  /** 该分支上的操作序列 */
  actions: HistoryAction[];
  /** 从父分支分叉时的操作 ID（在父分支的 actions 中的 ID） */
  forkAfterActionId: string | null;
  /** 创建时间 */
  createdAt: number;
}

/** 撤销树 */
export interface HistoryTree {
  /** 所有分支 */
  branches: BranchNode[];
  /** 当前活跃分支 ID */
  activeBranchId: string;
  /** 当前活跃分支内的操作指针索引（-1 表示无操作） */
  pointer: number;
}

// ========== 快照 ==========

/** 完整状态快照，用于崩溃恢复和分支跳转 */
export interface StateSnapshot {
  id: string;
  projectId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  timelineData: import('./timeline').TimelineData;
  timestamp: number;
  /** 触发来源 */
  source: 'auto' | 'manual' | 'before_execute';
  /** 可选的命名标签 */
  label?: string;
}

// ========== historyStore 状态接口 ==========

export interface HistoryState {
  /** 撤销树 */
  tree: HistoryTree;
  /** 当前是否可撤销 */
  canUndo: boolean;
  /** 当前是否可重做 */
  canRedo: boolean;
  /** 是否正在录制操作（暂停录制时为 false） */
  isRecording: boolean;
  /** 最大栈深度 */
  maxDepth: number;
  /** 合并窗口（ms），同一类型的连续操作在此窗口内合并 */
  mergeWindow: number;
}
