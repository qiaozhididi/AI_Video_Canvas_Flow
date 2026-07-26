import { request } from './client';
import type {
  SnapshotCreateRequest,
  SnapshotResponse,
  SnapshotRestoreResponse,
} from '@/types/api';

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
