/**
 * 统一构建媒体资源 URL
 *
 * - 内部 /api/ 路径：拼接 access_token
 * - 外部 http(s) 路径：原样返回
 * - 相对路径：补全为 /api/v1/media/<path>?token=...
 */
export function buildMediaUrl(url: string): string {
  const isInternal = url.startsWith('/api/');
  const isExternal = url.startsWith('http://') || url.startsWith('https://');

  if (isExternal) {
    return url;
  }

  const token = localStorage.getItem('access_token') || '';

  if (isInternal) {
    return `${url}${url.includes('?') ? '&' : '?'}token=${token}`;
  }

  // 相对路径补全
  const normalized = url.replace(/^\//, '');
  return `/api/v1/media/${normalized}?token=${token}`;
}
