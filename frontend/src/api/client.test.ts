import { describe, it, expect, afterEach, vi } from 'vitest';
import { request, ApiError } from './client';

// mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// mock localStorage（jsdom 自带 localStorage，但通过 stubGlobal 覆盖以隔离测试状态）
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => {
    storage[k] = v;
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
});

// 说明：brief 中尝试用 `delete window.location` 方式 mock，但在 jsdom 下 location 不可配置，
// 且本测试集所有用例均不触发 401 刷新（不会执行 window.location.href = '/login'），
// 因此按 KISS 原则不再 mock window.location。

afterEach(() => {
  fetchMock.mockReset();
  Object.keys(storage).forEach((k) => delete storage[k]);
});

describe('request', () => {
  it('GET 请求成功返回 JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, name: 'test' }),
    });

    const result = await request<{ id: number; name: string }>('/projects/1');
    expect(result).toEqual({ id: 1, name: 'test' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/projects/1');
    expect(opts.method).toBeUndefined();
  });

  it('POST 请求带 JSON body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await request('/projects/', {
      method: 'POST',
      body: JSON.stringify({ name: '新项目' }),
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ name: '新项目' }));
  });

  it('204 返回 undefined', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await request<void>('/projects/123', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  it('带 token 时附加 Authorization 头', async () => {
    storage['access_token'] = 'my-token';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await request('/projects/');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer my-token');
  });

  it('无 token 时不附加 Authorization 头', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await request('/projects/');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('非 401 错误抛出 ApiError 含 status/code/message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: '资源不存在' }),
    });

    await expect(request('/projects/999')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: '资源不存在',
      message: '资源不存在',
    });
  });

  it('FormData 不设置 Content-Type', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['x']), 'test.png');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await request('/media/upload', { method: 'POST', body: formData });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('后端无 detail 时 fallback 到状态码描述', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(request('/projects/')).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('500'),
    });
  });
});

describe('ApiError', () => {
  it('保留 status/code/message 字段', () => {
    const err = new ApiError(403, 'FORBIDDEN', '没有权限');
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('没有权限');
    expect(err.name).toBe('ApiError');
    expect(err instanceof Error).toBe(true);
  });
});
