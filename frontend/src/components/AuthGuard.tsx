import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/**
 * 路由守卫：未登录重定向到 /login
 *
 * 监听 storage 事件实现跨 Tab 登录状态同步：
 * - 其他 Tab 登录 → 当前 Tab 收到 storage 事件，更新状态渲染页面
 * - 其他 Tab 登出 → 当前 Tab 收到 storage 事件，重定向到 /login
 */
export default function AuthGuard() {
  const [authenticated, setAuthenticated] = useState(() => !!localStorage.getItem('access_token'));
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const location = useLocation();

  useEffect(() => {
    // 页面加载时，用 token 获取用户信息
    if (localStorage.getItem('access_token')) {
      checkAuth();
    }
  }, [checkAuth]);

  useEffect(() => {
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token') {
        setAuthenticated(!!e.newValue);
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, []);

  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
