import { useCallback, useRef, useState, useMemo } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTimelineStore } from '@/stores/timelineStore';
import Canvas from '@/components/canvas/Canvas';
import NodePanel from '@/components/panels/NodePanel';
import Timeline from '@/components/timeline/Timeline';
import VideoPreview from '@/components/preview/VideoPreview';
import { loadMockData } from '@/mock';
import { ChevronDown, ChevronUp, Database, Plus, RotateCcw, RotateCw } from 'lucide-react';
import type { CanvasNodeData, Artifact } from '@/types/canvas';
import type { Clip, TrackType } from '@/types/timeline';
import { executeNode, isExecutable } from '@/utils/workflowExecutor';
import { aiApi } from '@/utils/apiClient';
import type { AiModelResponse } from '@/utils/apiClient';

export default function Editor() {
  // ===== Store hooks =====
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const setEdges = useCanvasStore((s) => s.setEdges);

  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const pushUpdateNodeData = useHistoryStore((s) => s.pushUpdateNodeData);
  const pushRemoveNode = useHistoryStore((s) => s.pushRemoveNode);
  const pushMoveNode = useHistoryStore((s) => s.pushMoveNode);
  const tree = useHistoryStore((s) => s.tree);

  const markDirty = useAutoSaveStore((s) => s.markDirty);
  const lastSavedAt = useAutoSaveStore((s) => s.lastSavedAt);
  const isDirty = useAutoSaveStore((s) => s.isDirty);

  const currentProject = useProjectStore((s) => s.currentProject);

  // 计算预览 URL 和类型：订阅选中节点的 outputArtifacts
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const preview = useMemo(() => {
    if (!selectedNodeId) return { url: undefined, type: undefined as 'image' | 'video' | undefined };
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node || !node.data.outputArtifacts.length) return { url: undefined, type: undefined as 'image' | 'video' | undefined };
    // 优先 video，其次 image
    const videoArt = node.data.outputArtifacts.find((a) => a.type === 'video');
    const imageArt = node.data.outputArtifacts.find((a) => a.type === 'image');
    const artifact = videoArt || imageArt;
    if (!artifact) return { url: undefined, type: undefined as 'image' | 'video' | undefined };
    // URL 规范化：完整路径直接用；外部 URL 直接用；相对路径加 /api/v1/media/ 前缀
    // 内部 /api/ 路径需要附带 token（<video>/<img> 无法设置自定义 Header）
    const isInternal = artifact.url.startsWith('/api/');
    const isExternal = artifact.url.startsWith('http://') || artifact.url.startsWith('https://');
    const accessToken = localStorage.getItem('access_token') || '';
    let url: string;
    if (isInternal) {
      url = `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}token=${accessToken}`;
    } else if (isExternal) {
      url = artifact.url;
    } else {
      url = `/api/v1/media/${artifact.url.replace(/^\//, '')}?token=${accessToken}`;
    }
    return { url, type: artifact.type as 'image' | 'video' };
  }, [selectedNodeId, nodes]);

  // 时间轴 ↔ 预览联动
  const timelineCurrentTime = useTimelineStore((s) => s.data.currentTime);
  const setTimelineCurrentTime = useTimelineStore((s) => s.setCurrentTime);
  const handleTimeUpdate = useCallback((time: number) => {
    setTimelineCurrentTime(time);
  }, [setTimelineCurrentTime]);

  // ===== 本地状态 =====
  const [showTimeline, setShowTimeline] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // ===== Mock 数据加载（仅用于开发调试，已移至调试面板手动触发） =====

  // ===== 自动保存：不在 useEffect 中监听 nodes/edges =====
  // markDirty 由各操作方法内部调用，避免无限循环

  // ===== 拖拽放置节点（已移至 Canvas.tsx 的 ReactFlow 组件上处理） =====

  // ===== 节点操作（带历史记录） =====
  const handleNodeDataUpdate = useCallback(
    (id: string, updates: Partial<CanvasNodeData>) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      const from: Partial<CanvasNodeData> = {};
      for (const key of Object.keys(updates)) {
        (from as Record<string, unknown>)[key] = node.data[key as keyof CanvasNodeData];
      }

      pushUpdateNodeData({ nodeId: id, from, to: updates });
      updateNodeData(id, updates);
      markDirty();
    },
    [nodes, pushUpdateNodeData, updateNodeData]
  );

  const handleNodeRemove = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      const affectedEdges = edges.filter((e) => e.source === id || e.target === id);
      pushRemoveNode({ node, affectedEdges });
      removeNode(id);
      markDirty();
    },
    [nodes, edges, pushRemoveNode, removeNode]
  );

  // ===== 调试面板：撤销/重做操作历史 =====
  const activeBranch = tree.branches.find((b) => b.id === tree.activeBranchId);
  const actionList = activeBranch?.actions || [];

  // ===== 自动保存状态格式化 =====
  const formatLastSaved = () => {
    if (!lastSavedAt) return '未保存';
    const diff = Date.now() - lastSavedAt;
    if (diff < 5000) return '刚刚保存';
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    return `${Math.floor(diff / 60000)}分钟前`;
  };

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* 左侧节点面板 */}
      <NodePanel />

      {/* 中间画布 + 预览 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          {/* 画布 */}
          <div
            ref={reactFlowWrapper}
            className="flex-1"
          >
            <Canvas />
          </div>

          {/* 视频预览 */}
          {showPreview && (
            <div className="w-80 border-l border-canvas-border p-2">
              <VideoPreview
                src={preview.url}
                mediaType={preview.type}
                currentTime={timelineCurrentTime}
                onTimeUpdate={handleTimeUpdate}
              />
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
      <PropertyPanelWithHistory
        onUpdateData={handleNodeDataUpdate}
        onRemoveNode={handleNodeRemove}
      />

      {/* 底部状态栏 */}
      <div className="absolute bottom-0 left-60 right-72 h-7 bg-canvas-panel border-t border-canvas-border flex items-center px-3 gap-4 text-[10px] text-slate-500 z-10">
        <span>节点: {nodes.length}</span>
        <span>连线: {edges.length}</span>
        <span className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-status-warning' : 'bg-status-success'}`} />
          {isDirty ? '未保存' : '已保存'}
        </span>
        <span>{formatLastSaved()}</span>
        <span>操作历史: {actionList.length} 步</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowDebugPanel(!showDebugPanel)}
          className="flex items-center gap-1 hover:text-slate-300 transition-colors"
        >
          <Database className="w-3 h-3" />
          调试面板
        </button>
      </div>

      {/* 调试面板 - 撤销/重做操作历史 */}
      {showDebugPanel && (
        <div className="absolute top-0 right-72 w-80 h-full bg-canvas-panel border-l border-canvas-border z-20 flex flex-col shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-canvas-border">
            <h3 className="text-sm font-medium text-slate-200 font-display">操作历史调试</h3>
            <button
              onClick={() => setShowDebugPanel(false)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              关闭
            </button>
          </div>

          {/* 撤销/重做状态 */}
          <div className="px-3 py-2 border-b border-canvas-border flex items-center gap-2">
            <button
              onClick={undo}
              disabled={!canUndo}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${canUndo ? 'bg-canvas-hover text-slate-300' : 'text-slate-700 cursor-not-allowed'}`}
            >
              <RotateCcw className="w-3 h-3" />
              撤销
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${canRedo ? 'bg-canvas-hover text-slate-300' : 'text-slate-700 cursor-not-allowed'}`}
            >
              <RotateCw className="w-3 h-3" />
              重做
            </button>
            <span className="text-[10px] text-slate-500 ml-auto">
              pointer: {tree.pointer} / {actionList.length - 1}
            </span>
          </div>

          {/* 操作列表 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {actionList.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4">暂无操作记录</p>
            ) : (
              actionList.map((action, index) => (
                <div
                  key={action.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                    index === tree.pointer
                      ? 'bg-neon-purple/20 border border-neon-purple/30'
                      : index < tree.pointer
                      ? 'bg-canvas-hover/50'
                      : 'bg-canvas-bg opacity-50'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    index === tree.pointer ? 'bg-neon-purple' :
                    index < tree.pointer ? 'bg-status-success' : 'bg-slate-600'
                  }`} />
                  <span className={`truncate flex-1 ${index === tree.pointer ? 'text-slate-200' : 'text-slate-400'}`}>
                    {action.label}
                  </span>
                  <span className="text-[10px] text-slate-600 flex-shrink-0">
                    {new Date(action.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* 快捷操作 */}
          <div className="p-2 border-t border-canvas-border space-y-1">
            <button
              onClick={() => {
                loadMockData();
              }}
              className="w-full px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10 rounded transition-colors"
            >
              重新加载 Mock 数据
            </button>
            <button
              onClick={() => {
                useCanvasStore.getState().clearCanvas();
                useHistoryStore.getState().clearHistory();
              }}
              className="w-full px-2 py-1 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
            >
              清空画布和历史
            </button>
          </div>
        </div>
      )}

      {/* 预览切换按钮 */}
      <button
        onClick={() => setShowPreview(!showPreview)}
        className="absolute bottom-10 right-72 z-20 flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 bg-canvas-panel border border-canvas-border rounded-lg hover:text-slate-200 hover:border-canvas-hover transition-colors shadow-lg"
      >
        {showPreview ? '隐藏预览' : '显示预览'}
      </button>
    </div>
  );
}

/** 带历史记录的属性面板 */
function PropertyPanelWithHistory({
  onUpdateData,
  onRemoveNode,
}: {
  onUpdateData: (id: string, updates: Partial<CanvasNodeData>) => void;
  onRemoveNode: (id: string) => void;
}) {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Hooks 必须在 early return 之前调用（React 规则）
  const [executing, setExecuting] = useState(false);
  const [aiModels, setAiModels] = useState<AiModelResponse[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const paramSnapshotRef = useRef<Record<string, unknown> | null>(null);

  // 时间轴：加入片段所需
  const addClip = useTimelineStore((s) => s.addClip);
  const timelineTracks = useTimelineStore((s) => s.data.tracks);
  const timelineCurrentTime = useTimelineStore((s) => s.data.currentTime);

  if (!selectedNode) {
    return (
      <div className="w-72 h-full bg-canvas-panel border-l border-canvas-border flex items-center justify-center">
        <p className="text-sm text-slate-500">选择节点查看属性</p>
      </div>
    );
  }

  const data = selectedNode.data;

  const handleAddToTimeline = (artifact: Artifact) => {
    // 按 artifact 类型匹配轨道：video → video 轨，audio → audio 轨，image → video 轨（图片作为静态帧）
    const trackType: TrackType = artifact.type === 'audio' ? 'audio' : 'video';
    const targetTrack = timelineTracks.find((t) => t.type === trackType);
    if (!targetTrack) {
      console.warn(`[Timeline] 未找到 ${trackType} 类型轨道，请先添加`);
      return;
    }

    // 默认时长：video/audio 5s，image 3s
    const duration = artifact.type === 'image' ? 3 : 5;
    const clip: Clip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trackId: targetTrack.id,
      start: timelineCurrentTime,
      end: timelineCurrentTime + duration,
      mediaUrl: (() => {
        const isInt = artifact.url.startsWith('/api/');
        const isExt = artifact.url.startsWith('http://') || artifact.url.startsWith('https://');
        const tk = localStorage.getItem('access_token') || '';
        if (isInt) return `${artifact.url}${artifact.url.includes('?') ? '&' : '?'}token=${tk}`;
        if (isExt) return artifact.url;
        return `/api/v1/media/${artifact.url.replace(/^\//, '')}?token=${tk}`;
      })(),
      label: data.label,
      color: undefined,
    };
    addClip(targetTrack.id, clip);
  };

  const handleParamChange = (key: string, value: unknown) => {
    onUpdateData(selectedNode.id, { params: { ...data.params, [key]: value } });
  };

  const handleParamFocus = (key: string) => {
    if (!paramSnapshotRef.current) {
      paramSnapshotRef.current = {};
    }
    if (!(key in paramSnapshotRef.current)) {
      paramSnapshotRef.current[key] = data.params[key];
    }
  };

  const handleParamBlur = (key: string) => {
    if (!paramSnapshotRef.current || !(key in paramSnapshotRef.current)) return;
    const oldValue = paramSnapshotRef.current[key];
    const newValue = data.params[key];
    delete paramSnapshotRef.current[key];
    if (Object.keys(paramSnapshotRef.current).length === 0) {
      paramSnapshotRef.current = null;
    }
    // 只在值实际改变时记录历史
    if (oldValue !== newValue) {
      useHistoryStore.getState().pushUpdateNodeData({
        nodeId: selectedNode.id,
        from: { params: { [key]: oldValue } },
        to: { params: { [key]: newValue } },
      });
    }
  };

  const handleExecute = async () => {
    if (executing) return;
    setExecuting(true);
    try {
      await executeNode(selectedNode.id);
    } catch {
      // 错误已在 workflowExecutor 中处理
    } finally {
      setExecuting(false);
    }
  };

  const loadAiModels = async () => {
    if (aiModels.length > 0) return;
    setLoadingModels(true);
    try {
      const models = await aiApi.models.list();
      setAiModels(models);
    } catch {
      // 静默失败
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="w-72 h-full bg-canvas-panel border-l border-canvas-border flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-canvas-border">
        <h3 className="text-sm font-medium text-slate-200 font-display">{data.label}</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas-hover text-slate-500">{data.subtype}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs text-slate-500 uppercase tracking-wider">标签</label>
          <input
            type="text"
            value={data.label}
            onChange={(e) => onUpdateData(selectedNode.id, { label: e.target.value })}
            onFocus={() => { if (!paramSnapshotRef.current) paramSnapshotRef.current = {}; if (!('label' in paramSnapshotRef.current)) paramSnapshotRef.current['label'] = data.label; }}
            onBlur={() => { if (paramSnapshotRef.current && 'label' in paramSnapshotRef.current) { const old = paramSnapshotRef.current['label']; delete paramSnapshotRef.current['label']; if (Object.keys(paramSnapshotRef.current).length === 0) paramSnapshotRef.current = null; if (old !== data.label) { useHistoryStore.getState().pushUpdateNodeData({ nodeId: selectedNode.id, from: { label: old as string }, to: { label: data.label } }); } } }}
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
                    onFocus={() => handleParamFocus(key)}
                    onBlur={() => handleParamBlur(key)}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 placeholder-slate-500 focus:outline-none focus:border-neon-purple resize-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    onFocus={() => handleParamFocus(key)}
                    onBlur={() => handleParamBlur(key)}
                    className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                  />
                )
              ) : typeof value === 'number' ? (
                <input
                  type="number"
                  value={value}
                  onChange={(e) => handleParamChange(key, Number(e.target.value))}
                  onFocus={() => handleParamFocus(key)}
                  onBlur={() => handleParamBlur(key)}
                  className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                />
              ) : (
                <input
                  type="text"
                  value={String(value)}
                  onChange={(e) => handleParamChange(key, e.target.value)}
                  onFocus={() => handleParamFocus(key)}
                  onBlur={() => handleParamBlur(key)}
                  className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                />
              )}
            </div>
          ))}
        </div>

        {/* AI 模型选择器 — 仅 AI 推理节点显示 */}
        {data.type === 'ai_inference' && (
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">AI 模型</label>
            <select
              value={(data.params.model_id as string) || ''}
              onFocus={loadAiModels}
              onChange={(e) => handleParamChange('model_id', e.target.value || undefined)}
              className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
            >
              <option value="">自动选择（默认模型）</option>
              {loadingModels && <option disabled>加载中...</option>}
              {aiModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} ({m.model_id})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 节点状态显示 */}
        {data.status !== 'idle' && (
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">状态</label>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                data.status === 'running' ? 'bg-blue-400 animate-pulse' :
                data.status === 'completed' ? 'bg-green-400' :
                data.status === 'failed' ? 'bg-red-400' :
                'bg-yellow-400'
              }`} />
              <span className="text-sm text-slate-300 capitalize">{data.status}</span>
              {data.status === 'running' && (
                <span className="text-xs text-slate-400">{data.progress}%</span>
              )}
            </div>
            {data.status === 'running' && (
              <div className="w-full bg-canvas-bg rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-neon-purple to-neon-blue h-1.5 rounded-full transition-all"
                  style={{ width: `${data.progress}%` }}
                />
              </div>
            )}
            {data.outputArtifacts.length > 0 && (
              <div className="mt-2 space-y-1">
                <label className="text-xs text-slate-500 uppercase tracking-wider">输出资产</label>
                {data.outputArtifacts.map((artifact) => (
                  <div key={artifact.id} className="flex items-center gap-2 px-2 py-1 bg-canvas-bg rounded-md">
                    <span className="text-xs text-slate-400 uppercase">{artifact.type}</span>
                    <span className="text-xs text-slate-300 truncate flex-1">{artifact.filename}</span>
                    <button
                      onClick={() => handleAddToTimeline(artifact)}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-neon-blue hover:bg-neon-blue/10 rounded transition-colors"
                      title="加入时间轴"
                    >
                      <Plus className="w-3 h-3" />
                      加入时间轴
                    </button>
                  </div>
                ))}
              </div>
            )}
            {data.error && (
              <div className="text-xs text-red-400 mt-1">{data.error}</div>
            )}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-canvas-border space-y-2">
        {isExecutable(data.subtype) && (
          <button
            onClick={handleExecute}
            disabled={executing || data.status === 'running'}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing || data.status === 'running' ? '执行中...' : '执行节点'}
          </button>
        )}
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
