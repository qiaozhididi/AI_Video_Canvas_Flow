import { create } from 'zustand';
import { authApi, ApiError } from '@/utils/apiClient';
import type { User } from '@/types/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('access_token'),
  isAuthenticated: !!localStorage.getItem('access_token'),
  isLoading: false,
  error: null,

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const { access_token } = await authApi.login(username, password);
      localStorage.setItem('access_token', access_token);
      set({ token: access_token, isAuthenticated: true });

      // 登录成功后获取用户信息
      const user = await authApi.getMe();
      set({ user, isLoading: false });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '登录失败';
      set({ error: msg, isLoading: false });
      throw err;
    }
  },

  register: async (username, email, password) => {
    set({ isLoading: true, error: null });
    try {
      await authApi.register(username, email, password);
      // 注册成功后自动登录（后端用 username 登录）
      await useAuthStore.getState().login(username, password);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '注册失败';
      set({ error: msg, isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('access_token');
    set({ user: null, token: null, isAuthenticated: false, error: null });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const user = await authApi.getMe();
      set({ user, isAuthenticated: true });
    } catch {
      localStorage.removeItem('access_token');
      set({ user: null, token: null, isAuthenticated: false });
    }
  },

  clearError: () => set({ error: null }),
}));
