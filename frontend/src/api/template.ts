import { request } from './client';
import type { TemplateResponse, TemplatePublishRequest, ProjectResponse } from '@/types/api';

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
