import { request } from './client';
import type {
  ProjectResponse,
  ProjectCreateRequest,
  ProjectUpdateRequest,
} from '@/types/api';

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
