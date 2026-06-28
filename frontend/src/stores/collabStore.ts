import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';

// ── 类型定义 ──

// 在线用户（对齐后端 join_project ack / user_joined / user_left 负载）
export interface OnlineUser {
  sid: string;
  user_id: string;
  username: string;
}

// 远端光标（按 sid 去重）
export interface RemoteCursor {
  sid: string;
  user_id: string;
  username: string;
  x: number;
  y: number;
}

// 节点更新事件负载（本地 emit + 远端广播）
export interface NodeUpdatePayload {
  project_id: string;
  node_id: string;
  action: string;
  [key: string]: unknown;
}

// 边更新事件负载
export interface EdgeUpdatePayload {
  project_id: string;
  edge_id: string;
  action: string;
  [key: string]: unknown;
}

// 用户加入/离开事件负载
export interface UserPresencePayload {
  user_id: string;
  username: string;
  sid: string;
}

// 远端光标移动事件负载（服务端广播时附加完整 sid + user_id + username，cursor 自包含）
export interface CursorMovePayload {
  project_id: string;
  x: number;
  y: number;
  sid: string;
  user_id: string;
  username: string;
}

// join_project ack 返回结构
interface JoinProjectAck {
  users: OnlineUser[];
}

interface CollabState {
  socket: Socket | null;
  isConnected: boolean;
  connectionError: string | null;
  currentProjectId: string | null;
  onlineUsers: OnlineUser[];
  remoteCursors: RemoteCursor[];

  connect: (projectId: string) => void;
  disconnect: () => void;
  joinProject: () => void;
  leaveProject: () => void;
  emitNodeUpdate: (data: NodeUpdatePayload) => void;
  emitEdgeUpdate: (data: EdgeUpdatePayload) => void;
  emitCursorMove: (x: number, y: number) => void;
  onNodeUpdate: (callback: (payload: NodeUpdatePayload) => void) => () => void;
  onEdgeUpdate: (callback: (payload: EdgeUpdatePayload) => void) => () => void;
  onUserJoined: (callback: (payload: UserPresencePayload) => void) => () => void;
  onUserLeft: (callback: (payload: UserPresencePayload) => void) => () => void;
}

// 光标节流：上次发送时间戳（50ms 节流）
let lastCursorEmitAt = 0;
const CURSOR_THROTTLE_MS = 50;

export const useCollabStore = create<CollabState>((set, get) => ({
  socket: null,
  isConnected: false,
  connectionError: null,
  currentProjectId: null,
  onlineUsers: [],
  remoteCursors: [],

  connect: (projectId) => {
    // 已存在连接则先清理
    const existing = get().socket;
    if (existing) {
      existing.removeAllListeners();
      existing.disconnect();
    }

    const token = localStorage.getItem('access_token');
    const socket = io('/', {
      path: '/socket.io',
      query: { token },
      transports: ['websocket'],
    });

    // 连接成功 → 更新状态 + 自动加入项目房间
    socket.on('connect', () => {
      set({ isConnected: true, connectionError: null });
      get().joinProject();
    });

    // 断开 → 清空在线用户与远端光标
    socket.on('disconnect', () => {
      set({ isConnected: false, onlineUsers: [], remoteCursors: [] });
    });

    // 连接错误（如 token 失效、网络故障）→ 记录错误信息供 UI 提示，不记录 token
    socket.on('connect_error', (err: Error) => {
      set({ isConnected: false, connectionError: err.message });
      console.warn('[Collab] socket connect_error:', err.message);
    });

    // 内部监听：用户加入 → 添加到 onlineUsers（按 sid 去重）
    socket.on('user_joined', (payload: UserPresencePayload) => {
      set((state) => {
        if (state.onlineUsers.some((u) => u.sid === payload.sid)) {
          return state;
        }
        return {
          onlineUsers: [
            ...state.onlineUsers,
            {
              sid: payload.sid,
              user_id: payload.user_id,
              username: payload.username,
            },
          ],
        };
      });
    });

    // 内部监听：用户离开 → 从 onlineUsers + remoteCursors 移除
    socket.on('user_left', (payload: UserPresencePayload) => {
      set((state) => ({
        onlineUsers: state.onlineUsers.filter((u) => u.sid !== payload.sid),
        remoteCursors: state.remoteCursors.filter((c) => c.sid !== payload.sid),
      }));
    });

    // 内部监听：远端光标移动 → 更新 remoteCursors（按 sid 去重）
    // payload 自包含 user_id/username（后端 cursor_move 已附加），不再依赖 onlineUsers 关联
    socket.on('cursor_move', (payload: CursorMovePayload) => {
      set((state) => {
        const others = state.remoteCursors.filter((c) => c.sid !== payload.sid);
        return {
          remoteCursors: [
            ...others,
            {
              sid: payload.sid,
              user_id: payload.user_id,
              username: payload.username,
              x: payload.x,
              y: payload.y,
            },
          ],
        };
      });
    });

    set({ socket, currentProjectId: projectId, connectionError: null });
  },

  disconnect: () => {
    const socket = get().socket;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    lastCursorEmitAt = 0;
    set({ socket: null, isConnected: false, connectionError: null, currentProjectId: null, onlineUsers: [], remoteCursors: [] });
  },

  joinProject: () => {
    const socket = get().socket;
    const projectId = get().currentProjectId;
    if (!socket || !projectId) return;
    socket.emit('join_project', { project_id: projectId }, (ack: JoinProjectAck) => {
      if (ack?.users) {
        set({ onlineUsers: ack.users });
      }
    });
  },

  leaveProject: () => {
    const socket = get().socket;
    const projectId = get().currentProjectId;
    if (!socket || !projectId) return;
    socket.emit('leave_project', { project_id: projectId });
  },

  emitNodeUpdate: (data) => {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('node_update', data);
  },

  emitEdgeUpdate: (data) => {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('edge_update', data);
  },

  emitCursorMove: (x, y) => {
    const socket = get().socket;
    const projectId = get().currentProjectId;
    if (!socket || !projectId) return;
    // 50ms 节流：距离上次发送不足 50ms 则跳过
    const now = Date.now();
    if (now - lastCursorEmitAt < CURSOR_THROTTLE_MS) return;
    lastCursorEmitAt = now;
    socket.emit('cursor_move', { project_id: projectId, x, y });
  },

  onNodeUpdate: (callback) => {
    const socket = get().socket;
    if (!socket) return () => {};
    socket.on('node_update', callback);
    return () => {
      socket.off('node_update', callback);
    };
  },

  onEdgeUpdate: (callback) => {
    const socket = get().socket;
    if (!socket) return () => {};
    socket.on('edge_update', callback);
    return () => {
      socket.off('edge_update', callback);
    };
  },

  onUserJoined: (callback) => {
    const socket = get().socket;
    if (!socket) return () => {};
    socket.on('user_joined', callback);
    return () => {
      socket.off('user_joined', callback);
    };
  },

  onUserLeft: (callback) => {
    const socket = get().socket;
    if (!socket) return () => {};
    socket.on('user_left', callback);
    return () => {
      socket.off('user_left', callback);
    };
  },
}));
