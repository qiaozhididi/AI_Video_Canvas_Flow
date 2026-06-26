import type { MediaAssetResponse } from '@/utils/apiClient';

/** 判断是否启用 Mock 模式 */
export const isMockMedia = import.meta.env.VITE_MOCK_MEDIA === 'true';

/** 判断 assetId 是否为 Mock 数据 */
export const isMockAsset = (assetId: string) => assetId.startsWith('mock-');

/** 生成 Mock 媒体数据：80 图片 + 10 视频 + 10 音频 */
export function generateMockAssets(count = 100): MediaAssetResponse[] {
  const types = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg'];
  const names = ['sunset', 'mountain', 'ocean', 'forest', 'city', 'portrait', 'abstract', 'nature', 'skyline', 'flower'];
  return Array.from({ length: count }, (_, i) => {
    const fileType = i < 80 ? types[i % 3] : i < 90 ? types[3] : types[4];
    const cat = i < 80 ? 'image' : i < 90 ? 'video' : 'audio';
    return {
      id: `mock-${i.toString().padStart(3, '0')}`,
      owner_id: '00000000-0000-0000-0000-000000000001',
      project_id: null,
      file_name: `${names[i % 10]}_${i + 1}.${cat === 'image' ? 'png' : cat === 'video' ? 'mp4' : 'mp3'}`,
      file_type: fileType,
      file_size: Math.floor(Math.random() * 5 * 1024 * 1024) + 100 * 1024,
      storage_key: `mock/media/${i}.png`,
      thumbnail_key: null,
      created_at: new Date(Date.now() - i * 3600_000).toISOString(),
      updated_at: new Date(Date.now() - i * 3600_000).toISOString(),
    };
  });
}

/** 获取 Mock 缩略图 URL（picsum 随机图片） */
export function getMockThumbnailUrl(assetId: string, width = 400, height = 400): string {
  const seed = assetId.replace('mock-', '');
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

/** 模拟网络延迟 */
export function mockDelay(ms = 300): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
