import { useCallback, useRef, useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import Canvas from '@/components/canvas/Canvas';
import NodePanel from '@/components/panels/NodePanel';
import PropertyPanel from '@/components/panels/PropertyPanel';
import Timeline from '@/components/timeline/Timeline';
import VideoPreview from '@/components/preview/VideoPreview';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { NodeSubtype, CanvasNodeData } from '@/types/canvas';

export default function Editor() {
  const addNode = useCanvasStore((s) => s.addNode);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { pushAddNode, pushUpdateNodeData, pushRemoveNode } = useHistoryStore();
  const markDirty = useAutoSaveStore((s) => s.markDirty);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // 监听画布状态变化，标记脏状态
  useEffect(() => {
    markDirty();
  }, [nodes, edges, markDirty]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const subtype = e.dataTransfer.getData('application/reactflow-subtype') as NodeSubtype;
      if (!subtype) return;

      const x = 100 + Math.random() * 400;
      const y = 100 + Math.random() * 300;

      // 先通过 canvasStore 添加节点
      addNode(subtype, { x, y });

      // 再记录到 historyStore
      const newNode = useCanvasStore.getState().nodes[useCanvasStore.getState().nodes.length - 1];
      if (newNode) {
        pushAddNode({ node: newNode });
      }
    },
    [addNode, pushAddNode]
  );

  // 包装属性面板的更新操作，同时记录历史
  const handleNodeDataUpdate = useCallback(
    (id: string, updates: Partial<CanvasNodeData>) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      // 记录旧值
      const from: Partial<CanvasNodeData> = {};
      for (const key of Object.keys(updates)) {
        (from as Record<string, unknown>)[key] = node.data[key as keyof CanvasNodeData];
      }

      pushUpdateNodeData({ nodeId: id, from, to: updates });
      updateNodeData(id, updates);
    },
    [nodes, pushUpdateNodeData, updateNodeData]
  );

  // 包装删除操作
  const handleNodeRemove = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      const affectedEdges = edges.filter((e) => e.source === id || e.target === id);
      pushRemoveNode({ node, affectedEdges });
      removeNode(id);
    },
    [nodes, edges, pushRemoveNode, removeNode]
  );

  return (
    <div className="h-full flex overflow-hidden">
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

      {/* 右侧属性面板 - 传入带历史记录的更新方法 */}
      <PropertyPanelWithHistory
        onUpdateData={handleNodeDataUpdate}
        onRemoveNode={handleNodeRemove}
      />

      {/* 预览切换按钮（底部右侧浮动） */}
      <button
        onClick={() => setShowPreview(!showPreview)}
        className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 bg-canvas-panel border border-canvas-border rounded-lg hover:text-slate-200 hover:border-canvas-hover transition-colors shadow-lg"
      >
        {showPreview ? '隐藏预览' : '显示预览'}
      </button>
    </div>
  );
}

/** 带历史记录的属性面板包装组件 */
function PropertyPanelWithHistory({
  onUpdateData,
  onRemoveNode,
}: {
  onUpdateData: (id: string, updates: Partial<CanvasNodeData>) => void;
  onRemoveNode: (id: string) => void;
}) {
  const { nodes, selectedNodeId, updateNodeData, removeNode, setNodeStatus } = useCanvasStore();
  const { pushUpdateNodeData, pushRemoveNode } = useHistoryStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) {
    return (
      <div className="w-72 h-full bg-canvas-panel border-l border-canvas-border flex items-center justify-center">
        <p className="text-sm text-slate-500">选择节点查看属性</p>
      </div>
    );
  }

  const data = selectedNode.data;

  const handleParamChange = (key: string, value: unknown) => {
    const from = { params: data.params };
    const to = { params: { ...data.params, [key]: value } };
    pushUpdateNodeData({ nodeId: selectedNode.id, from: { params: { [key]: data.params[key] } }, to: { params: { [key]: value } } });
    onUpdateData(selectedNode.id, { params: { ...data.params, [key]: value } });
  };

  return (
    <div className="w-72 h-full bg-canvas-panel border-l border-canvas-border flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-canvas-border">
        <h3 className="text-sm font-medium text-slate-200 font-display">
          {data.label}
        </h3>
      </div>

      {/* 属性内容 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs text-slate-500 uppercase tracking-wider">标签</label>
          <input
            type="text"
            value={data.label}
            onChange={(e) => onUpdateData(selectedNode.id, { label: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-500 uppercase tracking-wider">参数</label>
          {Object.entries(data.params).map(([key, value]) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-slate-400 capitalize">{key}</label>
              {typeof value === 'string' ? (
                key.includes('text') || key.includes('prompt') || key.includes('condition') ? (
                  <textarea
                    value={value}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple resize-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                  />
                )
              ) : typeof value === 'number' ? (
                <input
                  type="number"
                  value={value}
                  onChange={(e) => handleParamChange(key, Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                />
              ) : (
                <input
                  type="text"
                  value={String(value)}
                  onChange={(e) => handleParamChange(key, e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 底部操作 */}
      <div className="p-3 border-t border-canvas-border">
        <button
          onClick={() => onRemoveNode(selectedNode.id)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10 rounded-md transition-colors"
        >
          删除节点
        </button>
      </div>
    </div>
  );
}
