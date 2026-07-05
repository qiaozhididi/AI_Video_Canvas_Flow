import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import Layout from "@/components/Layout";
import EditorLayout from "@/components/EditorLayout";
import Home from "@/pages/Home";
import Editor from "@/pages/Editor";
import Login from "@/pages/Login";
import MediaLibrary from "@/pages/MediaLibrary";
import RenderCenter from "@/pages/RenderCenter";
import Templates from "@/pages/Templates";
import Settings from "@/pages/Settings";

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
        <Routes>
          {/* 登录页：独立布局，无需守卫 */}
          <Route path="/login" element={<Login />} />

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
      </Router>
    </>
  );
}
