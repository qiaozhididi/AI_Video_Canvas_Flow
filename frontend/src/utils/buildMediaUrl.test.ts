import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildMediaUrl } from './buildMediaUrl';

describe('buildMediaUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'access_token' ? 'test-token' : null),
    });
  });

  it('内部 /api/ URL 拼接 token', () => {
    expect(buildMediaUrl('/api/v1/media/abc')).toBe('/api/v1/media/abc?token=test-token');
  });

  it('内部 /api/ URL 已有 query 时用 & 拼接', () => {
    expect(buildMediaUrl('/api/v1/media/abc?size=1')).toBe('/api/v1/media/abc?size=1&token=test-token');
  });

  it('外部 http URL 不拼接 token', () => {
    expect(buildMediaUrl('http://example.com/x.mp4')).toBe('http://example.com/x.mp4');
  });

  it('外部 https URL 不拼接 token', () => {
    expect(buildMediaUrl('https://example.com/x.mp4')).toBe('https://example.com/x.mp4');
  });

  it('相对路径补全为 /api/v1/media/', () => {
    expect(buildMediaUrl('abc/def.mp4')).toBe('/api/v1/media/abc/def.mp4?token=test-token');
  });

  it('以 / 开头的相对路径也补全', () => {
    expect(buildMediaUrl('/abc/def.mp4')).toBe('/api/v1/media/abc/def.mp4?token=test-token');
  });
});
