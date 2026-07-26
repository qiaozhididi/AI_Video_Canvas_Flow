import { request, ApiError } from './client';
import type { RenderTaskCreateRequest, RenderTaskResponse } from '@/types/api';

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

  exportVideo: async (projectId: string, format: string, resolution: string, subtitles: Array<{ start: number; end: number; text: string }> = []): Promise<{ task_id: string; status: string }> => {
    const res = await request<{ task_id: string; status: string }>('/render/export', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, format, resolution, subtitles }),
    });
    return res;
  },

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
