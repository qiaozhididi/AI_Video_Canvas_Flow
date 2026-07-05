# 跨 Tab 登录状态同步设计

> 日期: 2026-07-05
> 状态: 待审核

## 概述

当用户在一个浏览器标签页登录后，其他已打开的标签页应自动识别登录状态，无需手动刷新或重新登录。

## 当前问题

1. **无路由守卫**：未登录用户可直接访问首页等受保护页面
2. **无跨 Tab 同步**：Tab A 登录后，Tab B 不会感知到 token 变化
3. **无登出同步**：Tab A 登出后，Tab B 仍显示已登录状态

## 方案：`storage` 事件 + AuthGuard

### 核心机制

浏览器原生 `window.addEventListener('storage', callback)` 事件：
- 当**其他标签页**修改 localStorage 时，当前标签页收到通知
- 仅在其他标签页触发，本标签页不触发（正好是我们需要的）
- 零依赖、全浏览器支持

### 变更清单

#### 1. 新增 `AuthGuard` 组件

路径：`frontend/src/components/AuthGuard.tsx`

```tsx
// 核心逻辑：
// 1. 检查 localStorage 中是否有 access_token
// 2. 有 → 渲染子组件（Outlet）
// 3. 无 → 重定向到 /login
// 4. 监听 storage 事件，当其他 Tab 登录/登出时同步状态
```

- 使用 `useEffect` 监听 `storage` 事件
- 当收到 `access_token` 变更时，更新内部状态触发重渲染
- 当 `access_token` 被移除时，重定向到 `/login`

#### 2. 修改 `App.tsx` 路由结构

```tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route element={<AuthGuard />}>   {/* ← 新增守卫 */}
    <Route element={<Layout />}>
      <Route path="/" element={<Home />} />
      {/* ...其他受保护路由 */}
    </Route>
    <Route element={<EditorLayout />}>
      <Route path="/editor/:projectId" element={<Editor />} />
    </Route>
  </Route>
</Routes>
```

- `/login` 路由在 AuthGuard 之外，不受守卫保护
- 所有其他路由在 AuthGuard 内，必须已登录才能访问

#### 3. 修改 `Login.tsx`

- 登录页检测到已有 token 时，自动跳转首页（避免已登录用户停留在登录页）
- 同样通过 `storage` 事件监听——如果用户在另一个 Tab 登录了，当前登录页也自动跳转

#### 4. 添加全局登出功能

在 Layout 侧边栏底部添加登出按钮：
- 清除 localStorage 中的 `access_token` 和 `refresh_token`
- 使用 `localStorage.removeItem()` 触发其他 Tab 的 `storage` 事件
- 重定向到 `/login`

### AuthGuard 组件设计

```tsx
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

export default function AuthGuard() {
  const [authenticated, setAuthenticated] = useState(() => !!localStorage.getItem('access_token'));
  const location = useLocation();

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
```

### 登出流程

1. 用户点击登出按钮
2. `localStorage.removeItem('access_token')`
3. `localStorage.removeItem('refresh_token')`
4. 触发其他 Tab 的 `storage` 事件 → AuthGuard 检测到 token 丢失 → 重定向到 `/login`
5. 当前 Tab 也重定向到 `/login`

### 边界场景

| 场景 | 行为 |
|------|------|
| Tab A 登录，Tab B 已打开首页 | Tab B 收到 storage 事件，AuthGuard 更新状态，页面正常渲染 |
| Tab A 登录，Tab B 在登录页 | Tab B 的 Login 组件检测到 token，自动跳转首页 |
| Tab A 登出，Tab B 在编辑器 | Tab B 收到 storage 事件，AuthGuard 重定向到 /login |
| Token 过期，apiClient 刷新失败 | apiClient 已有的逻辑清除 token 并跳转 /login |
| 多个 Tab 同时 401 | apiClient 的 isRefreshing 防并发锁确保只刷新一次 |
