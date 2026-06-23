import type { NodeStatus } from './canvas';

// API 基础响应
export interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
}

// 分页响应
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 用户
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'premium' | 'admin';
  createdAt: string;
}

// 登录请求
export interface LoginRequest {
  email: string;
  password: string;
}

// 登录响应
export interface LoginResponse {
  token: string;
  user: User;
}

// 注册请求
export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

// 渲染任务
export interface RenderTask {
  id: string;
  projectId: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  progress: number;
  outputUrl?: string;
  format: 'mp4' | 'mov' | 'webm';
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// 媒体资产（API）
export interface MediaAsset {
  id: string;
  userId: string;
  projectId?: string;
  assetType: 'image' | 'video' | 'audio';
  filename: string;
  storageKey: string;
  fileSize: number;
  mimeType: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// 模板
export interface Template {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  tags: string[];
  author: string;
  createdAt: string;
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
