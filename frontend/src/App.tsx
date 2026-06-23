import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import EditorLayout from "@/components/EditorLayout";
import Home from "@/pages/Home";
import Editor from "@/pages/Editor";
import MediaLibrary from "@/pages/MediaLibrary";
import RenderCenter from "@/pages/RenderCenter";
import Templates from "@/pages/Templates";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <Router>
      <Routes>
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
      </Routes>
    </Router>
  );
}
