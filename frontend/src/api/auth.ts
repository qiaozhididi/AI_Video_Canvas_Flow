import { request } from './client';
import type { UserResponse, TokenResponse, UserUpdateRequest } from '@/types/api';

// ── 认证 ──

export const authApi = {
  register: (username: string, email: string, password: string) =>
    request<UserResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  login: (username: string, password: string) =>
    request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getMe: () =>
    request<UserResponse>('/auth/me'),

  update: (data: UserUpdateRequest) =>
    request<UserResponse>('/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
