import { request } from './client';
import type { CollaboratorResponse } from '@/types/api';

// ── 协作者 ──

export const collabApi = {
  list: (projectId: string) =>
    request<CollaboratorResponse[]>(`/projects/${projectId}/collaborators`),

  updateRole: (projectId: string, userId: string, role: string) =>
    request<{ message: string }>(`/projects/${projectId}/collaborators/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  remove: (projectId: string, userId: string) =>
    request<{ message: string }>(`/projects/${projectId}/collaborators/${userId}`, {
      method: 'DELETE',
    }),
};
