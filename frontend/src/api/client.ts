/**
 * API 客户端基础设施
 *
 * 包含：
 * - 统一请求封装（自动注入 Token、错误处理、401 跳转）
 * - ApiError 错误类型
 * - Token 刷新机制
 */

// re-export 类型供 api 模块使用（方便业务模块统一从 ./client 引入）
export type { CanvasNode, CanvasEdge } from '@/types/canvas';
export type { TimelineData } from '@/types/timeline';

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
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    // 认证接口（登录/注册/刷新）的 401 是业务错误，不应触发 token 刷新
    const isAuthEndpoint = path.startsWith('/auth/');
    if (res.status === 401 && !isAuthEndpoint) {
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
