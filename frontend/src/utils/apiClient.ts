/**
 * AI Canvas Flow — 统一 API 客户端
 *
 * 所有后端通信通过此模块，包含：
 * - 统一请求封装（自动注入 Token、错误处理、401 跳转）
 * - 后端 Schema 类型定义
 * - 各业务模块 API 方法
 */

import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { TimelineData } from '@/types/timeline';

// ═══════════════════════════════════════════════════
// 0. 基础设施
// ═══════════════════════════════════════════════════

const API_BASE = '/api/v1';

/** 统一 API 错误 */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ── Token 刷新 ──

let isRefreshing = false;
let pendingRequests: Array<() => void> = [];

async function refreshToken(): Promise<string> {
  if (isRefreshing) {
    return new Promise((resolve) => pendingRequests.push(() => resolve(localStorage.getItem('access_token')!)));
  }
  isRefreshing = true;
  try {
    const rt = localStorage.getItem('refresh_token');
    if (!rt) throw new Error('No refresh token');
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    pendingRequests.forEach(cb => cb());
    pendingRequests = [];
    return data.access_token;
  } catch {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
  } finally {
    isRefreshing = false;
  }
}

/** 统一请求封装 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('access_token');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // 非 FormData 时设置 Content-Type
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401) {
      try {
        const newToken = await refreshToken();
        // 用新 token 重试原请求
        headers['Authorization'] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers });
        if (!retryRes.ok) {
          if (retryRes.status === 401) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            window.location.href = '/login';
            throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
          }
          const retryBody = await retryRes.json().catch(() => ({}));
          throw new ApiError(retryRes.status, retryBody.detail || 'UNKNOWN', retryBody.detail || `请求失败: ${retryRes.status}`);
        }
        if (retryRes.status === 204) return undefined as T;
        return retryRes.json();
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
      }
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.detail || 'UNKNOWN',
      body.detail || `请求失败: ${res.status}`,
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ═══════════════════════════════════════════════════
// 1. 后端 Schema 类型（与后端 Pydantic Schema 对齐）
// ═══════════════════════════════════════════════════

// ── 认证 ──

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserUpdateRequest {
  username?: string;
  email?: string;
  avatar_url?: string;
}

// ── 项目 ──

export interface ProjectResponse {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreateRequest {
  name: string;
  description?: string;
}

export interface ProjectUpdateRequest {
  name?: string;
  description?: string;
  cover_url?: string;
}

// ── 模板 ──

export interface TemplateResponse extends ProjectResponse {
  is_template: boolean;
  template_category: string | null;
  template_tags: string[] | null;
}

export interface TemplatePublishRequest {
  category: string;
  tags: string[];
}

// ── 工作流（节点/边） ──

export interface NodeResponse {
  id: string;
  project_id: string;
  node_type: string;
  label: string | null;
  position_x: number;
  position_y: number;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface NodeCreateRequest {
  id: string;
  node_type: string;
  label?: string;
  position_x?: number;
  position_y?: number;
  config?: Record<string, unknown>;
}

export interface EdgeResponse {
  id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  source_port: string | null;
  target_port: string | null;
  created_at: string;
  updated_at: string;
}

export interface EdgeCreateRequest {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_port?: string;
  target_port?: string;
}

export interface WorkflowSaveRequest {
  nodes: NodeCreateRequest[];
  edges: EdgeCreateRequest[];
}

export interface WorkflowSaveResponse {
  nodes_count: number;
  edges_count: number;
}

// ── 媒体资产 ──

export interface MediaAssetResponse {
  id: string;
  owner_id: string;
  project_id: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_key: string;
  thumbnail_key: string | null;
  created_at: string;
  updated_at: string;
}

// ── 渲染任务 ──

export interface RenderTaskCreateRequest {
  project_id: string;
  task_type: string;
  node_id?: string;
  model_id?: string;
  prompt?: string;
  input_artifacts?: { type: string; url: string; filename?: string; text?: string }[];
  node_params?: Record<string, unknown>;
}

export interface RenderTaskResponse {
  id: string;
  project_id: string;
  owner_id: string;
  task_type: string;
  status: string;
  progress: number;
  celery_task_id: string | null;
  result_url: string | null;
  error_message: string | null;
  node_id: string | null;
  node_label: string | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
}

// ── AI Provider ──

export interface AiProviderResponse {
  id: string;
  name: string;
  platform: string;
  base_url: string;
  api_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiProviderCreateRequest {
  name: string;
  platform: string;
  base_url: string;
  api_key: string;
  is_active?: boolean;
}

export interface AiProviderUpdateRequest {
  name?: string;
  platform?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
}

// ── AI Model ──

export interface AiModelResponse {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  model_type: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiModelCreateRequest {
  provider_id: string;
  model_id: string;
  display_name: string;
  model_type: string;
  is_active?: boolean;
  is_default?: boolean;
}

export interface AiModelUpdateRequest {
  provider_id?: string;
  model_id?: string;
  display_name?: string;
  model_type?: string;
  is_active?: boolean;
  is_default?: boolean;
}

// ── 快照 ──

export interface SnapshotCreateRequest {
  source: 'auto' | 'manual';
  label?: string;
  snapshot_data: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    timelineData: TimelineData;
  };
}

export interface SnapshotResponse {
  id: string;
  project_id: string;
  owner_id: string;
  source: 'auto' | 'manual';
  label: string | null;
  snapshot_data: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    timelineData: TimelineData;
  };
  created_at: string;
}

export interface SnapshotRestoreResponse {
  restored: boolean;
  project_id: string;
  nodes_count: number;
  edges_count: number;
}

// ═══════════════════════════════════════════════════
// 2. 业务模块 API
// ═══════════════════════════════════════════════════

// ── 认证 ──

export const authApi = {
  register: (username: string, email: string, password: string) =>
    request<UserResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  login: (username: string, password: string) =>
    request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getMe: () =>
    request<UserResponse>('/auth/me'),

  update: (data: UserUpdateRequest) =>
    request<UserResponse>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

// ── 项目 ──

export const projectApi = {
  list: () =>
    request<ProjectResponse[]>('/projects/'),

  create: (name: string, description?: string) =>
    request<ProjectResponse>('/projects/', {
      method: 'POST',
      body: JSON.stringify({ name, description } satisfies ProjectCreateRequest),
    }),

  get: (id: string) =>
    request<ProjectResponse>(`/projects/${id}`),

  update: (id: string, data: ProjectUpdateRequest) =>
    request<ProjectResponse>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),
};

// ── 模板市场 ──

export const templateApi = {
  list: (params?: { q?: string; category?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.category) searchParams.set('category', params.category);
    const qs = searchParams.toString();
    return request<TemplateResponse[]>(`/templates/${qs ? '?' + qs : ''}`);
  },

  clone: (templateId: string) =>
    request<ProjectResponse>(`/templates/${templateId}/clone`, { method: 'POST' }),

  publish: (projectId: string, data: TemplatePublishRequest) =>
    request<TemplateResponse>(`/projects/${projectId}/publish`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  unpublish: (templateId: string) =>
    request<void>(`/templates/${templateId}`, { method: 'DELETE' }),
};

// ── 工作流（节点/边） ──

export const workflowApi = {
  /** 批量保存：替换项目的全部节点和边 */
  save: (projectId: string, data: WorkflowSaveRequest) =>
    request<WorkflowSaveResponse>(`/workflows/${projectId}/save`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** 加载项目的全部节点和边 */
  loadWorkflow: async (projectId: string) => {
    const [nodes, edges] = await Promise.all([
      request<NodeResponse[]>(`/workflows/${projectId}/nodes`),
      request<EdgeResponse[]>(`/workflows/${projectId}/edges`),
    ]);
    return { nodes, edges };
  },
};

// ── 媒体资产 ──

export interface StorageUsageResponse {
  total_size: number;
  total_count: number;
  categories: Record<string, { count: number; size: number }>;
}

export const mediaApi = {
  list: () =>
    request<MediaAssetResponse[]>('/media/'),

  getStorageUsage: () =>
    request<StorageUsageResponse>('/media/stats/usage'),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<MediaAssetResponse>('/media/upload', {
      method: 'POST',
      body: formData,
    });
  },

  getPresignedUrl: (assetId: string) =>
    request<{ url: string }>(`/media/${assetId}/presign`),

  delete: (assetId: string) =>
    request<void>(`/media/${assetId}`, { method: 'DELETE' }),
};

// ── 渲染任务 ──

export const renderApi = {
  list: (params?: { status?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return request<RenderTaskResponse[]>(`/render/${qs ? '?' + qs : ''}`);
  },

  create: (data: RenderTaskCreateRequest) =>
    request<RenderTaskResponse>('/render/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (taskId: string) =>
    request<RenderTaskResponse>(`/render/${taskId}`),

  cancel: (taskId: string) =>
    request<RenderTaskResponse>(`/render/${taskId}/cancel`, { method: 'POST' }),

  retry: (taskId: string) =>
    request<RenderTaskResponse>(`/render/${taskId}/retry`, { method: 'POST' }),

  /**
   * 轮询渲染任务直到完成/失败
   */
  poll: async (
    taskId: string,
    intervalMs: number = 2000,
    onProgress?: (progress: number, status: string) => void,
    attempt: number = 0,
  ): Promise<RenderTaskResponse> => {
    const MAX_POLL_ATTEMPTS = 300; // 约 10 分钟 (300 * 2s)，覆盖视频生成等长时间任务
    const task = await renderApi.get(taskId);
    onProgress?.(task.progress, task.status);
    if (task.status === 'completed') return task;
    if (task.status === 'failed') {
      throw new ApiError(500, 'RENDER_FAILED', task.error_message || '渲染失败');
    }
    if (attempt >= MAX_POLL_ATTEMPTS) {
      throw new ApiError(408, 'POLL_TIMEOUT', '轮询超时：任务长时间未完成');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    return renderApi.poll(taskId, intervalMs, onProgress, attempt + 1);
  },
};

// ── AI Provider / Model ──

export const aiApi = {
  providers: {
    list: () => request<AiProviderResponse[]>('/ai/providers'),
    create: (data: AiProviderCreateRequest) =>
      request<AiProviderResponse>('/ai/providers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: AiProviderUpdateRequest) =>
      request<AiProviderResponse>(`/ai/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/ai/providers/${id}`, { method: 'DELETE' }),
  },
  models: {
    list: (params?: { provider_id?: string; model_type?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.provider_id) searchParams.set('provider_id', params.provider_id);
      if (params?.model_type) searchParams.set('model_type', params.model_type);
      const qs = searchParams.toString();
      return request<AiModelResponse[]>(`/ai/models${qs ? '?' + qs : ''}`);
    },
    create: (data: AiModelCreateRequest) =>
      request<AiModelResponse>('/ai/models', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: AiModelUpdateRequest) =>
      request<AiModelResponse>(`/ai/models/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/ai/models/${id}`, { method: 'DELETE' }),
    getDefault: (modelType?: string) =>
      request<AiModelResponse>(`/ai/models/default${modelType ? `?model_type=${modelType}` : ''}`),
  },

  /** AI 快速生成工作流 */
  generateWorkflow: (data: { description: string; mode: 'replace' | 'append'; model_id?: string }) =>
    request<WorkflowSaveRequest>('/ai/generate-workflow', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ── 快照 ──

export const snapshotApi = {
  /** 创建快照 */
  create: (projectId: string, data: SnapshotCreateRequest) =>
    request<SnapshotResponse>(`/projects/${projectId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 获取快照列表（可选 source 筛选） */
  list: (projectId: string, source?: 'auto' | 'manual') =>
    request<SnapshotResponse[]>(
      `/projects/${projectId}/snapshots${source ? `?source=${source}` : ''}`,
    ),

  /** 获取最新快照（崩溃恢复检测用） */
  getLatest: (projectId: string) =>
    request<SnapshotResponse>(`/projects/${projectId}/snapshots/latest`),

  /** 获取快照详情 */
  get: (snapshotId: string) =>
    request<SnapshotResponse>(`/snapshots/${snapshotId}`),

  /** 删除快照 */
  delete: (snapshotId: string) =>
    request<void>(`/snapshots/${snapshotId}`, { method: 'DELETE' }),

  /** 恢复快照到实际 nodes/edges */
  restore: (snapshotId: string) =>
    request<SnapshotRestoreResponse>(`/snapshots/${snapshotId}/restore`, {
      method: 'POST',
    }),
};
