import { request } from './client';
import type {
  NodeResponse,
  EdgeResponse,
  WorkflowSaveRequest,
  WorkflowSaveResponse,
} from '@/types/api';

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
