import { request } from './client';
import type {
  AiProviderResponse,
  AiProviderCreateRequest,
  AiProviderUpdateRequest,
  AiModelResponse,
  AiModelCreateRequest,
  AiModelUpdateRequest,
  WorkflowSaveRequest,
} from '@/types/api';

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

  /** AI 字幕生成 */
  generateSubtitles: (prompt: string, duration: number = 30, modelId?: string) =>
    request<{ segments: Array<{ start: number; end: number; text: string }> }>('/ai/generate-subtitles', {
      method: 'POST',
      body: JSON.stringify({ prompt, duration, model_id: modelId }),
    }),
};
