import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import { lazy, Suspense } from "react";
import AuthGuard from "@/components/AuthGuard";
import Layout from "@/components/Layout";
import EditorLayout from "@/components/EditorLayout";
import Login from "@/pages/Login";

// 路由级懒加载 — 减少首屏 bundle 体积
const Home = lazy(() => import("@/pages/Home"));
const Editor = lazy(() => import("@/pages/Editor"));
const MediaLibrary = lazy(() => import("@/pages/MediaLibrary"));
const RenderCenter = lazy(() => import("@/pages/RenderCenter"));
const Templates = lazy(() => import("@/pages/Templates"));
const Settings = lazy(() => import("@/pages/Settings"));
const AcceptInvite = lazy(() => import("@/pages/AcceptInvite"));

function PageLoader() {
  return (
    <div className="h-screen flex items-center justify-center bg-canvas-bg">
      <div className="w-6 h-6 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#1E1E2E',
            border: '1px solid #2A2A3E',
            color: '#E2E8F0',
          },
        }}
      />
      <Router>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* 登录页：独立布局，无需守卫 */}
            <Route path="/login" element={<Login />} />

            {/* 邀请页：无需登录即可查看，接受时需登录 */}
            <Route path="/invite/:token" element={<AcceptInvite />} />

            {/* 受保护路由：AuthGuard 拦截未登录 + 跨 Tab 同步 */}
            <Route element={<AuthGuard />}>
              {/* 主布局：侧边导航 */}
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/media" element={<MediaLibrary />} />
                <Route path="/render" element={<RenderCenter />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/settings" element={<Settings />} />
              </Route>

              {/* 编辑器布局：独立全屏 + 工具栏 + 自动保存 + 撤销重做 */}
              <Route element={<EditorLayout />}>
                <Route path="/editor/:projectId" element={<Editor />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </>
  );
}
