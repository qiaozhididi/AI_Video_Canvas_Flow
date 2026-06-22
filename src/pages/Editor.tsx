import { useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import Canvas from '@/components/canvas/Canvas';
import NodePanel from '@/components/panels/NodePanel';
import PropertyPanel from '@/components/panels/PropertyPanel';
import Timeline from '@/components/timeline/Timeline';
import VideoPreview from '@/components/preview/VideoPreview';
import { ChevronDown, ChevronUp, Save, Play, ArrowLeft, Undo2, Redo2 } from 'lucide-react';
import { useState } from 'react';
import type { NodeSubtype } from '@/types/canvas';

export default function Editor() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects, currentProject, setCurrentProject, saveCurrentProject } = useProjectStore();
  const addNode = useCanvasStore((s) => s.addNode);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // 加载项目
  if (!currentProject || currentProject.id !== projectId) {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setCurrentProject(project);
    } else {
      return (
        <div className="h-screen flex items-center justify-center bg-canvas-bg">
          <div className="text-center">
            <p className="text-slate-400 mb-4">项目不存在</p>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-sm text-white bg-neon-purple rounded-lg hover:opacity-90"
            >
              返回工作台
            </button>
          </div>
        </div>
      );
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const subtype = e.dataTransfer.getData('application/reactflow-subtype') as NodeSubtype;
      if (!subtype) return;

      // 简化：在画布中心附近随机放置
      const x = 100 + Math.random() * 400;
      const y = 100 + Math.random() * 300;
      addNode(subtype, { x, y });
    },
    [addNode]
  );

  const handleSave = () => {
    saveCurrentProject();
  };

  return (
    <div className="h-screen flex flex-col bg-canvas-bg">
      {/* 顶部工具栏 */}
      <div className="h-11 bg-canvas-panel border-b border-canvas-border flex items-center px-3 gap-2">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded hover:bg-canvas-hover transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>

        <div className="h-5 w-px bg-canvas-border" />

        <h1 className="text-sm font-medium text-slate-200 font-display">
          {currentProject?.name || '未命名项目'}
        </h1>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            保存
          </button>
          <button className="p-1 rounded hover:bg-canvas-hover transition-colors" title="撤销">
            <Undo2 className="w-4 h-4 text-slate-400" />
          </button>
          <button className="p-1 rounded hover:bg-canvas-hover transition-colors" title="重做">
            <Redo2 className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="h-5 w-px bg-canvas-border" />

        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded transition-colors"
        >
          {showPreview ? '隐藏预览' : '显示预览'}
        </button>

        <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity">
          <Play className="w-3.5 h-3.5" />
          执行工作流
        </button>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧节点面板 */}
        <NodePanel />

        {/* 中间画布 + 预览 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden">
            {/* 画布 */}
            <div
              ref={reactFlowWrapper}
              className="flex-1"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <Canvas />
            </div>

            {/* 视频预览 */}
            {showPreview && (
              <div className="w-80 border-l border-canvas-border p-2">
                <VideoPreview />
              </div>
            )}
          </div>

          {/* 时间轴 */}
          <div className="relative">
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className="absolute -top-7 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 bg-canvas-panel border border-canvas-border rounded-t-md hover:text-slate-300 transition-colors"
            >
              {showTimeline ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              时间轴
            </button>
            {showTimeline && <Timeline />}
          </div>
        </div>

        {/* 右侧属性面板 */}
        <PropertyPanel />
      </div>
    </div>
  );
}
