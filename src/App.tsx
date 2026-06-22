import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
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
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/media" element={<MediaLibrary />} />
          <Route path="/render" element={<RenderCenter />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/editor/:projectId" element={<Editor />} />
      </Routes>
    </Router>
  );
}
