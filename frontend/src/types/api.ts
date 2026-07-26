import type { NodeStatus, CanvasNode, CanvasEdge } from './canvas';
import type { TimelineData } from './timeline';

// 用户（对齐后端 UserResponse）
export interface User {
  id: string;
  username: string;
  email: string;
}

// 登录请求（对齐后端 LoginRequest: username + password）
export interface LoginRequest {
  username: string;
  password: string;
}

// 登录响应（对齐后端 TokenResponse）
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
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

// ═══════════════════════════════════════════════════
// 后端 Schema 类型（与后端 Pydantic Schema 对齐）
// 从原 src/utils/apiClient.ts 迁移
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

// ── 协作者 ──

export interface CollaboratorResponse {
  id: string;
  project_id: string;
  user_id: string;
  username: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: string;
}

// ── 邀请 ──

export interface CreateInvitationRequest {
  role: 'editor' | 'viewer';
  expires_in_hours: number | null;
}

export interface CreateInvitationResponse {
  id: string;
  token: string;
  role: string;
  expires_at: string | null;
}

export interface InvitationInfoResponse {
  id: string;
  project_id: string;
  project_name: string;
  role: string;
  created_by_username: string;
  expires_at: string | null;
  is_valid: boolean;
}

export interface AcceptInvitationResponse {
  project_id: string;
  project_name: string;
  role: string;
}

// ── 快照 ──

export interface SnapshotCreateRequest {
  source: 'auto' | 'manual';
  name?: string | null;
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
  name: string | null;
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
