import type { NodeStatus } from './canvas';

// 用户（对齐后端 UserResponse）
export interface User {
  id: string;
  username: string;
  email: string;
}

// 登录请求（对齐后端 UserLogin）
export interface LoginRequest {
  email: string;
  password: string;
}

// 登录响应（对齐后端 TokenResponse）
export interface LoginResponse {
  access_token: string;
  token_type: string;
}

// 注册请求（对齐后端 UserRegister）
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

// WebSocket 消息
export interface WSMessage {
  type: 'node_status' | 'node_progress' | 'render_progress' | 'error';
  payload: {
    nodeId?: string;
    status?: NodeStatus;
    progress?: number;
    message?: string;
    outputArtifacts?: Array<{
      id: string;
      type: 'image' | 'video' | 'audio';
      url: string;
      filename: string;
      size: number;
    }>;
  };
}
