import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { executeNode, isExecutable } from '@/utils/workflowExecutor';
import { aiApi } from '@/utils/apiClient';
import type { AiModelResponse } from '@/utils/apiClient';
import { getErrorMessage } from '@/utils/errorMessages';
import { buildMediaUrl } from '@/utils/buildMediaUrl';
import { generateId } from '@/utils/id';
import type { CanvasNodeData, Artifact } from '@/types/canvas';
import type { Clip, TrackType } from '@/types/timeline';

interface PropertyPanelWithHistoryProps {
  onUpdateData: (id: string, updates: Partial<CanvasNodeData>) => void;
  onRemoveNode: (id: string) => void;
  onSelectClipPreview?: (media: { url: string; type: 'image' | 'video' } | null) => void;
  // 协作锁：输入获焦时加锁、失焦时延迟释放（nodeId 为当前选中节点）
  onPropertyFocus?: (nodeId: string) => Promise<boolean>;
  onPropertyBlur?: (nodeId: string) => void;
}

/** 带历史记录的属性面板 */
export function PropertyPanelWithHistory({
  onUpdateData,
  onRemoveNode,
  onSelectClipPreview,
  onPropertyFocus,
  onPropertyBlur,
}: PropertyPanelWithHistoryProps) {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Hooks 必须在 early return 之前调用（React 规则）
  const [executing, setExecuting] = useState(false);
  const [aiModels, setAiModels] = useState<AiModelResponse[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const paramSnapshotRef = useRef<Record<string, unknown> | null>(null);

  // AI 推理节点：切换选中节点时预加载模型列表，确保 model_id 能正确回显
  useEffect(() => {
    if (selectedNode?.data.type === 'ai_inference' && aiModels.length === 0) {
      loadAiModels();
    }
  }, [selectedNode?.id, selectedNode?.data.type]);

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
      id: generateId('clip'),
      trackId: targetTrack.id,
      start: timelineCurrentTime,
      end: timelineCurrentTime + duration,
      mediaType: artifact.type as 'image' | 'video' | 'audio',
      mediaUrl: buildMediaUrl(artifact.url),
      label: data.label,
      color: undefined,
      nodeId: selectedNode.id,
    };
    addClip(targetTrack.id, clip);

    // TTS 产出：同时往字幕轨添加字幕片段
    if (artifact.type === 'audio') {
      const subtitleTrack = timelineTracks.find((t) => t.type === 'subtitle');
      if (subtitleTrack) {
        const subtitleText = (data.params?.text as string) || (data.params?.prompt as string) || '';
        const subtitleClip: Clip = {
          id: generateId('clip'),
          trackId: subtitleTrack.id,
          start: clip.start,
          end: clip.end,
          mediaType: 'subtitle',
          mediaUrl: '',
          subtitleText,
          label: subtitleText.length > 20 ? subtitleText.slice(0, 20) + '…' : subtitleText || clip.label,
          color: undefined,
          nodeId: selectedNode.id,
        };
        addClip(subtitleTrack.id, subtitleClip);
      }
    }

    // 加入时间轴后自动在预览中显示
    const isVideo = artifact.type === 'video';
    onSelectClipPreview?.({ url: clip.mediaUrl, type: isVideo ? 'video' : 'image' });
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
    // 协作锁：获焦时加锁（fire-and-forget，结果仅用于 toast 提示）
    void onPropertyFocus?.(selectedNode.id);
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
    // 协作锁：失焦时延迟释放（与拖动共用定时器）
    onPropertyBlur?.(selectedNode.id);
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
    } catch (err) {
      toast.error(getErrorMessage(err, 'ai_model_load'));
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
            onFocus={() => { if (!paramSnapshotRef.current) paramSnapshotRef.current = {}; if (!('label' in paramSnapshotRef.current)) paramSnapshotRef.current['label'] = data.label; void onPropertyFocus?.(selectedNode.id); }}
            onBlur={() => { if (paramSnapshotRef.current && 'label' in paramSnapshotRef.current) { const old = paramSnapshotRef.current['label']; delete paramSnapshotRef.current['label']; if (Object.keys(paramSnapshotRef.current).length === 0) paramSnapshotRef.current = null; if (old !== data.label) { useHistoryStore.getState().pushUpdateNodeData({ nodeId: selectedNode.id, from: { label: old as string }, to: { label: data.label } }); } } onPropertyBlur?.(selectedNode.id); }}
            className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-500 uppercase tracking-wider">参数</label>
          {Object.entries(data.params).map(([key, value]) => {
            // 隐藏 model_id（已有独立 AI 模型选择器）
            if (key === 'model_id') return null;
            // size 参数使用下拉框选择
            if (key === 'size') {
              const SIZE_OPTIONS = [
                { value: '1k', label: '1K (1024×1024)' },
                { value: '2k', label: '2K (2048×2048)' },
                { value: '4k', label: '4K (3072×3072)' },
                { value: '512x512', label: '512×512' },
                { value: '768x768', label: '768×768' },
                { value: '1024x1024', label: '1024×1024' },
                { value: '1536x1536', label: '1536×1536' },
                { value: '2048x2048', label: '2048×2048' },
                { value: '1280x720', label: '1280×720 (横屏)' },
                { value: '720x1280', label: '720×1280 (竖屏)' },
                { value: '1024x1536', label: '1024×1536 (竖版)' },
                { value: '1536x1024', label: '1536×1024 (横版)' },
              ];
              return (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-slate-400">尺寸</label>
                  <select
                    value={String(value)}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    onFocus={() => handleParamFocus(key)}
                    onBlur={() => handleParamBlur(key)}
                    className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
                  >
                    {SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              );
            }
            return (
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
            );
          })}
        </div>

        {/* AI 模型选择器 — 仅 AI 推理节点显示，按模型类型分组 */}
        {data.type === 'ai_inference' && (
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">AI 模型</label>
            <select
              value={(data.params.model_id as string) || ''}
              onFocus={() => { loadAiModels(); void onPropertyFocus?.(selectedNode.id); }}
              onBlur={() => onPropertyBlur?.(selectedNode.id)}
              onChange={(e) => handleParamChange('model_id', e.target.value || undefined)}
              className="w-full px-2 py-1.5 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-300 focus:outline-none focus:border-neon-purple"
            >
              <option value="">自动选择（默认模型）</option>
              {loadingModels && <option disabled>加载中...</option>}
              {(() => {
                // subtype → model_type 映射
                const subtypeToModelType: Record<string, string> = {
                  text_to_image: 'image_gen',
                  image_to_image: 'image_gen',
                  image_to_video: 'video_gen',
                  text_to_video: 'video_gen',
                  text_to_speech: 'tts',
                };
                const recommendedType = subtypeToModelType[data.subtype] ?? '';

                // 推荐类型模型
                const recommended = aiModels.filter((m) => m.model_type === recommendedType);
                // 其他类型模型
                const otherTypes = [...new Set(aiModels.filter((m) => m.model_type !== recommendedType).map((m) => m.model_type))];
                const modelTypeLabels: Record<string, string> = {
                  llm: '文本生成',
                  image_gen: '文生图',
                  video_gen: '图生视频',
                  tts: '语音合成',
                };

                return (
                  <>
                    {recommended.length > 0 && (
                      <optgroup label={`推荐 · ${modelTypeLabels[recommendedType] ?? recommendedType}`}>
                        {recommended.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.display_name}{m.is_default ? ' ★' : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {otherTypes.map((type) => {
                      const models = aiModels.filter((m) => m.model_type === type);
                      return (
                        <optgroup key={type} label={modelTypeLabels[type] ?? type}>
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.display_name}{m.is_default ? ' ★' : ''}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </>
                );
              })()}
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
        {/* 处理节点：演示模式提示 */}
        {['upscale', 'style_transfer', 'remove_bg', 'extend_image'].includes(data.subtype) && (
          <div className="px-2 py-1.5 text-xs text-amber-400 bg-amber-400/10 rounded-md border border-amber-400/20">
            演示模式：后端暂无真实 AI API，将以模拟方式执行
          </div>
        )}
        {/* 控制节点：不可执行提示 */}
        {['if_else', 'loop', 'merge'].includes(data.subtype) && (
          <div className="px-2 py-1.5 text-xs text-slate-400 bg-slate-400/10 rounded-md border border-slate-400/20">
            控制节点暂不支持执行，仅用于工作流可视化编排
          </div>
        )}
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
