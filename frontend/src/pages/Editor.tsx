import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAutoSaveStore } from '@/stores/autoSaveStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useCollabStore } from '@/stores/collabStore';
import { usePreviewContent } from '@/hooks/usePreviewContent';
import Canvas from '@/components/canvas/Canvas';
import NodePanel from '@/components/panels/NodePanel';
import { PropertyPanelWithHistory } from '@/components/panels/PropertyPanelWithHistory';
import Timeline from '@/components/timeline/Timeline';
import VideoPreview from '@/components/preview/VideoPreview';
import { loadMockData } from '@/mock';
import { ChevronDown, ChevronUp, Database, RotateCcw, RotateCw, LayoutDashboard, PlayCircle } from 'lucide-react';
import type { CanvasNodeData } from '@/types/canvas';
import type { Node, OnNodeDrag } from '@xyflow/react';

export default function Editor() {
  // ===== Store hooks =====
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const setNodes = useCanvasStore((s) => s.setNodes);

  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const pushUpdateNodeData = useHistoryStore((s) => s.pushUpdateNodeData);
  const pushRemoveNode = useHistoryStore((s) => s.pushRemoveNode);
  const tree = useHistoryStore((s) => s.tree);

  const markDirty = useAutoSaveStore((s) => s.markDirty);
  const lastSavedAt = useAutoSaveStore((s) => s.lastSavedAt);
  const isDirty = useAutoSaveStore((s) => s.isDirty);

  // ===== 本地状态 =====
  const [showTimeline, setShowTimeline] = useState(true);
  const [activeTab, setActiveTab] = useState<'canvas' | 'preview'>('canvas');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [selectedClipMedia, setSelectedClipMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [selectedSubtitleText, setSelectedSubtitleText] = useState<string | undefined>(undefined);

  const isTimelinePlaying = useTimelineStore((s) => s.isPlaying);

  // 时间轴播放时自动切换到预览选项卡，并清除手动选中
  useEffect(() => {
    if (isTimelinePlaying) {
      setActiveTab('preview');
      setSelectedClipMedia(null);
      setSelectedSubtitleText(undefined);
    }
  }, [isTimelinePlaying]);

  // 点击片段/加入时间轴时切换到预览选项卡
  useEffect(() => {
    if (selectedClipMedia || selectedSubtitleText) setActiveTab('preview');
  }, [selectedClipMedia, selectedSubtitleText]);

  // 右键菜单「预览」请求时切换到预览选项卡
  const previewRequest = useCanvasStore((s) => s.previewRequest);
  const clearPreviewRequest = useCanvasStore((s) => s.clearPreviewRequest);
  useEffect(() => {
    if (previewRequest) {
      setSelectedClipMedia(previewRequest);
      setActiveTab('preview');
      clearPreviewRequest();
    }
  }, [previewRequest, clearPreviewRequest]);

  const preview = usePreviewContent(selectedClipMedia, selectedSubtitleText);

  // 时间轴 ↔ 预览联动
  const timelineCurrentTime = useTimelineStore((s) => s.data.currentTime);
  const setTimelineCurrentTime = useTimelineStore((s) => s.setCurrentTime);
  const handleTimeUpdate = useCallback((time: number) => {
    setTimelineCurrentTime(time);
  }, [setTimelineCurrentTime]);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // ===== 协作锁集成（拖动 + 属性面板） =====
  const { acquireLock, releaseLock, isNodeLocked, isNodeLockedByMe, getNodeLockHolder, onLockChanged } = useCollabStore();

  // 每个节点的延迟释放定时器（node_id → timer），避免连续拖动/编辑时误释放
  const releaseTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 订阅 lock_changed 事件，触发节点重渲染（更新 _locked/_lockHolder）
  // 注意：canvasStore.setNodes 接收直接数组（非 updater 函数），故从 getState 读取最新节点
  useEffect(() => {
    const unsub = onLockChanged(() => {
      const currentNodes = useCanvasStore.getState().nodes;
      setNodes(
        currentNodes.map((n) => {
          const locked = isNodeLocked(n.id) && !isNodeLockedByMe(n.id);
          const holder = getNodeLockHolder(n.id);
          return {
            ...n,
            data: { ...n.data, _locked: locked, _lockHolder: holder?.username || null },
          };
        }),
      );
    });
    return unsub;
  }, [onLockChanged, isNodeLocked, isNodeLockedByMe, getNodeLockHolder, setNodes]);

  // 拖动开始：清除该节点待执行的延迟释放定时器，并尝试加锁
  const onNodeDragStart = useCallback<OnNodeDrag<Node>>(async (_evt, node) => {
    const oldTimer = releaseTimersRef.current[node.id];
    if (oldTimer) {
      clearTimeout(oldTimer);
      delete releaseTimersRef.current[node.id];
    }
    // 检查是否被他人锁定
    if (isNodeLocked(node.id) && !isNodeLockedByMe(node.id)) {
      const holder = getNodeLockHolder(node.id);
      toast.warning(`节点正被 ${holder?.username} 编辑`);
      return;
    }
    const result = await acquireLock(node.id);
    // 非 strict 模式下需用 === false 显式收窄判别联合（与 collabStore 一致）
    if (result.ok === false && result.reason === 'locked_by_other') {
      toast.info(`节点正被 ${result.holder.username} 编辑，请稍后`);
    }
  }, [acquireLock, isNodeLocked, isNodeLockedByMe, getNodeLockHolder]);

  // 拖动结束：3s 后延迟释放（给连续微调留时间）
  const onNodeDragStop = useCallback<OnNodeDrag<Node>>((_evt, node) => {
    // 清除旧的待执行定时器
    const oldTimer = releaseTimersRef.current[node.id];
    if (oldTimer) clearTimeout(oldTimer);
    releaseTimersRef.current[node.id] = setTimeout(async () => {
      if (isNodeLockedByMe(node.id)) {
        await releaseLock(node.id);
      }
      delete releaseTimersRef.current[node.id];
    }, 3000);
  }, [releaseLock, isNodeLockedByMe]);

  // 属性面板获焦加锁（设计文档 §7.2 onPropertyFocus）
  const onPropertyFocus = useCallback(async (nodeId: string): Promise<boolean> => {
    // 清除该节点待执行的延迟释放定时器（与拖动共用）
    const oldTimer = releaseTimersRef.current[nodeId];
    if (oldTimer) {
      clearTimeout(oldTimer);
      delete releaseTimersRef.current[nodeId];
    }
    if (isNodeLocked(nodeId) && !isNodeLockedByMe(nodeId)) {
      const holder = getNodeLockHolder(nodeId);
      toast.warning(`节点正被 ${holder?.username} 编辑`);
      return false;
    }
    const result = await acquireLock(nodeId);
    // 非 strict 模式下需用 === false 显式收窄判别联合（与 collabStore 一致）
    if (result.ok === false && result.reason === 'locked_by_other') {
      toast.info(`节点正被 ${result.holder.username} 编辑，请稍后`);
      return false;
    }
    return result.ok;
  }, [acquireLock, isNodeLocked, isNodeLockedByMe, getNodeLockHolder]);

  // 属性面板失焦延迟释放（与拖动共用延迟释放逻辑）
  const onPropertyBlur = useCallback((nodeId: string) => {
    const oldTimer = releaseTimersRef.current[nodeId];
    if (oldTimer) clearTimeout(oldTimer);
    releaseTimersRef.current[nodeId] = setTimeout(async () => {
      if (isNodeLockedByMe(nodeId)) {
        await releaseLock(nodeId);
      }
      delete releaseTimersRef.current[nodeId];
    }, 3000);
  }, [releaseLock, isNodeLockedByMe]);

  // 组件卸载时清理所有延迟释放定时器
  useEffect(() => {
    return () => {
      Object.values(releaseTimersRef.current).forEach(clearTimeout);
      releaseTimersRef.current = {};
    };
  }, []);

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

      {/* 中间画布 / 预览选项卡 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 选项卡头部 */}
        <div className="flex items-center justify-center h-8 bg-canvas-panel border-b border-canvas-border px-1 gap-0.5 flex-shrink-0">
          <button
            onClick={() => setActiveTab('canvas')}
            className={`flex items-center gap-1.5 px-3 h-6 rounded text-xs transition-colors ${
              activeTab === 'canvas'
                ? 'bg-canvas-hover text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            画布
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-1.5 px-3 h-6 rounded text-xs transition-colors ${
              activeTab === 'preview'
                ? 'bg-canvas-hover text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <PlayCircle className="w-3.5 h-3.5" />
            预览
          </button>
        </div>

        {/* 选项卡内容 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'canvas' ? (
            <div ref={reactFlowWrapper} className="h-full">
              <Canvas onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop} />
            </div>
          ) : (
            <div className="h-full">
              <VideoPreview
                src={preview.url}
                mediaType={preview.type}
                currentTime={timelineCurrentTime}
                onTimeUpdate={handleTimeUpdate}
                subtitleText={preview.subtitleText}
              />
            </div>
          )}
        </div>

        {/* 时间轴 - 切换按钮始终可见 */}
        <div className="flex flex-col flex-shrink-0">
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="flex items-center justify-center gap-1 h-7 text-xs text-slate-500 bg-canvas-panel border-t border-canvas-border hover:text-slate-300 transition-colors flex-shrink-0"
          >
            {showTimeline ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            时间轴
          </button>
          {showTimeline && (
            <Timeline
              onClipClick={(clip) => {
                if (clip.subtitleText && !clip.mediaUrl) {
                  // 纯字幕片段：设置字幕文本，不设媒体
                  setSelectedClipMedia(null);
                  setSelectedSubtitleText(clip.subtitleText);
                } else {
                  setSelectedClipMedia({ url: clip.mediaUrl, type: (clip.mediaType || 'video') as 'image' | 'video' });
                  setSelectedSubtitleText(clip.subtitleText);
                }
                setActiveTab('preview');
              }}
            />
          )}
        </div>

        {/* 底部状态栏 */}
        <div className="h-7 bg-canvas-panel border-t border-canvas-border flex items-center px-3 gap-4 text-[10px] text-slate-500 flex-shrink-0">
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
      </div>

      {/* 右侧属性面板 */}
      <PropertyPanelWithHistory
        onUpdateData={handleNodeDataUpdate}
        onRemoveNode={handleNodeRemove}
        onSelectClipPreview={setSelectedClipMedia}
        onPropertyFocus={onPropertyFocus}
        onPropertyBlur={onPropertyBlur}
      />

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

    </div>
  );
}
