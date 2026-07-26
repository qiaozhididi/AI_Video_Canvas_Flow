import { request } from './client';
import type { MediaAssetResponse } from '@/types/api';

// ── 媒体资产 ──

export interface StorageUsageResponse {
  total_size: number;
  total_count: number;
  quota: number;
  categories: Record<string, { count: number; size: number }>;
}

export interface StorageStatsResponse {
  quota_bytes: number;
  used_bytes: number;
  file_count: number;
}

// 从 /stats/usage 响应转换为 StorageStatsResponse
function usageToStats(u: StorageUsageResponse): StorageStatsResponse {
  return {
    quota_bytes: u.quota,
    used_bytes: u.total_size,
    file_count: u.total_count,
  };
}

export const mediaApi = {
  list: () =>
    request<MediaAssetResponse[]>('/media/'),

  getStorageUsage: () =>
    request<StorageUsageResponse>('/media/stats/usage'),

  getStorageStats: () =>
    request<StorageUsageResponse>('/media/stats/usage').then(usageToStats),

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
