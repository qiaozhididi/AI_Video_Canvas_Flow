import { useRef, useCallback, useState } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCollabStore } from '@/stores/collabStore';
import {
  Play, Pause, SkipBack, SkipForward,
  Plus, Volume2, VolumeX, Lock, Unlock, Eye, EyeOff,
  Trash2, ZoomIn, ZoomOut, Download,
} from 'lucide-react';
import ExportModal from '@/components/ExportModal';
import type { TrackType, Clip } from '@/types/timeline';

const TRACK_COLORS: Record<TrackType, string> = {
  video: '#7C3AED',
  audio: '#3B82F6',
  subtitle: '#EAB308',
};

// 拖拽类型：移动 / 左边缘 resize / 右边缘 resize
type DragType = 'move' | 'resize-left' | 'resize-right';

// 拖拽状态（统一管理 move + resize）
interface DragState {
  type: DragType;
  trackId: string;
  clipId: string;
  startX: number;     // 鼠标起始 clientX
  origStart: number;  // clip 原始 start
  origEnd: number;    // clip 原始 end
}

// 吸附阈值（像素）
const SNAP_THRESHOLD_PX = 8;
// 片段最小时长（秒）
const MIN_CLIP_DURATION = 0.5;

interface TimelineProps {
  onClipClick?: (clip: Clip) => void;
}

export default function Timeline({ onClipClick }: TimelineProps) {
  const {
    data, isPlaying, play, pause, seekTo,
    addTrack, removeTrack, toggleTrackMute, toggleTrackLock, toggleTrackVisibility,
    removeClip, moveClip, resizeClip, setZoom, updateClipText, addClip,
  } = useTimelineStore();
  const { nodes } = useCanvasStore();
  const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds);
  const currentProjectId = useCollabStore((s) => s.currentProjectId);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const PIXELS_PER_SECOND = 80 * data.zoom;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(x / PIXELS_PER_SECOND, data.duration));
      seekTo(time);
    },
    [PIXELS_PER_SECOND, data.duration, seekTo]
  );

  // 吸附计算：在阈值内吸附到整数秒/播放头/其他片段边缘，否则返回原值
  const findSnap = useCallback(
    (time: number, excludeClipId: string): number => {
      const candidates = new Set<number>();
      // 整数秒刻度
      for (let i = 0; i <= Math.ceil(data.duration); i++) candidates.add(i);
      // 播放头
      candidates.add(data.currentTime);
      // 其他片段的起止边缘
      data.tracks.forEach((t) =>
        t.clips.forEach((c) => {
          if (c.id !== excludeClipId) {
            candidates.add(c.start);
            candidates.add(c.end);
          }
        })
      );

      const thresholdSec = SNAP_THRESHOLD_PX / PIXELS_PER_SECOND;
      let best = time;
      let bestDist = thresholdSec;
      candidates.forEach((t) => {
        const d = Math.abs(t - time);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      });
      return best;
    },
    [data.duration, data.currentTime, data.tracks, PIXELS_PER_SECOND]
  );

  // 统一拖拽启动：处理 move / resize-left / resize-right
  const handleDragStart = useCallback(
    (e: React.PointerEvent, trackId: string, clip: Clip, type: DragType) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture 在某些环境可能失败（如自动化测试），不影响拖拽
      }

      const state: DragState = {
        type,
        trackId,
        clipId: clip.id,
        startX: e.clientX,
        origStart: clip.start,
        origEnd: clip.end,
      };
      setDragState(state);

      // 锁定全局 cursor，防止拖拽中光标闪烁
      document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize';
      document.body.style.userSelect = 'none';

      const handleMove = (ev: PointerEvent) => {
        const dt = (ev.clientX - state.startX) / PIXELS_PER_SECOND;
        const { origStart, origEnd } = state;
        const duration = origEnd - origStart;

        if (type === 'move') {
          // 移动：整体平移，吸附 newStart，不能超出 [0, duration - clipDuration]
          let newStart = Math.max(0, Math.min(origStart + dt, data.duration - duration));
          newStart = findSnap(newStart, clip.id);
          newStart = Math.max(0, Math.min(newStart, data.duration - duration));
          moveClip(trackId, clip.id, newStart);
          setTooltip({
            x: ev.clientX,
            y: ev.clientY,
            text: `${formatTime(newStart)} → ${formatTime(newStart + duration)} (${duration.toFixed(1)}s)`,
          });
        } else if (type === 'resize-left') {
          // 左 resize：调整 start，吸附后仍需满足 minDuration
          let newStart = Math.max(0, Math.min(origStart + dt, origEnd - MIN_CLIP_DURATION));
          newStart = findSnap(newStart, clip.id);
          newStart = Math.min(newStart, origEnd - MIN_CLIP_DURATION);
          newStart = Math.max(0, newStart);
          resizeClip(trackId, clip.id, newStart, origEnd);
          setTooltip({
            x: ev.clientX,
            y: ev.clientY,
            text: `${formatTime(newStart)} → ${formatTime(origEnd)} (${(origEnd - newStart).toFixed(1)}s)`,
          });
        } else {
          // 右 resize：调整 end，吸附后仍需满足 minDuration
          let newEnd = Math.max(origStart + MIN_CLIP_DURATION, Math.min(origEnd + dt, data.duration));
          newEnd = findSnap(newEnd, clip.id);
          newEnd = Math.max(newEnd, origStart + MIN_CLIP_DURATION);
          newEnd = Math.min(newEnd, data.duration);
          resizeClip(trackId, clip.id, origStart, newEnd);
          setTooltip({
            x: ev.clientX,
            y: ev.clientY,
            text: `${formatTime(origStart)} → ${formatTime(newEnd)} (${(newEnd - origStart).toFixed(1)}s)`,
          });
        }
      };

      const handleUp = () => {
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // releasePointerCapture 失败不影响清理
        }
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        setDragState(null);
        setTooltip(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [data.duration, findSnap, moveClip, resizeClip]
  );

  // 时间刻度
  const ticks = Array.from({ length: Math.ceil(data.duration) + 1 }, (_, i) => i);

  return (
    <div className="h-56 bg-canvas-panel border-t border-canvas-border flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-canvas-border">
        {/* 播放控制 */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => seekTo(0)}
            className="p-1 rounded hover:bg-canvas-hover transition-colors"
          >
            <SkipBack className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button
            onClick={isPlaying ? pause : play}
            className="p-1.5 rounded-md bg-gradient-to-r from-neon-purple to-neon-blue hover:opacity-90 transition-opacity"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-white" />
            ) : (
              <Play className="w-4 h-4 text-white" />
            )}
          </button>
          <button
            onClick={() => seekTo(data.duration)}
            className="p-1 rounded hover:bg-canvas-hover transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>

        {/* 时间显示 */}
        <span className="text-xs text-slate-400 font-mono ml-2">
          {formatTime(data.currentTime)} / {formatTime(data.duration)}
        </span>

        <div className="flex-1" />

        {/* 添加轨道 */}
        <div className="flex items-center gap-1">
          {(Object.keys(TRACK_COLORS) as TrackType[]).map((type) => (
            <button
              key={type}
              onClick={() => addTrack(type)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded transition-colors"
              title={`添加${type === 'video' ? '视频' : type === 'audio' ? '音频' : '字幕'}轨`}
            >
              <Plus className="w-3 h-3" />
            </button>
          ))}
        </div>

        {/* 导出 */}
        <button
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-canvas-hover rounded transition-colors ml-1"
          title="导出视频"
        >
          <Download className="w-3 h-3" />
        </button>

        {/* 缩放 */}
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setZoom(data.zoom - 0.2)}
            className="p-1 rounded hover:bg-canvas-hover transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center">
            {Math.round(data.zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(data.zoom + 0.2)}
            className="p-1 rounded hover:bg-canvas-hover transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* 时间轴主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 轨道标签 */}
        <div className="w-40 border-r border-canvas-border flex-shrink-0">
          {/* 时间刻度占位 */}
          <div className="h-6 border-b border-canvas-border" />

          {/* 轨道标签列表 */}
          {data.tracks.map((track) => (
            <div
              key={track.id}
              className="h-10 flex items-center gap-1 px-2 border-b border-canvas-border/50"
            >
              <span
                className="w-1.5 h-5 rounded-full flex-shrink-0"
                style={{ backgroundColor: TRACK_COLORS[track.type] }}
              />
              <span className="text-xs text-slate-300 truncate flex-1">{track.label}</span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => toggleTrackMute(track.id)}
                  className="p-0.5 rounded hover:bg-canvas-hover"
                >
                  {track.muted ? (
                    <VolumeX className="w-3 h-3 text-slate-500" />
                  ) : (
                    <Volume2 className="w-3 h-3 text-slate-400" />
                  )}
                </button>
                <button
                  onClick={() => toggleTrackVisibility(track.id)}
                  className="p-0.5 rounded hover:bg-canvas-hover"
                >
                  {track.visible ? (
                    <Eye className="w-3 h-3 text-slate-400" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-slate-500" />
                  )}
                </button>
                <button
                  onClick={() => toggleTrackLock(track.id)}
                  className="p-0.5 rounded hover:bg-canvas-hover"
                >
                  {track.locked ? (
                    <Lock className="w-3 h-3 text-slate-500" />
                  ) : (
                    <Unlock className="w-3 h-3 text-slate-400" />
                  )}
                </button>
                <button
                  onClick={() => removeTrack(track.id)}
                  className="p-0.5 rounded hover:bg-canvas-hover"
                >
                  <Trash2 className="w-3 h-3 text-slate-500 hover:text-status-error" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 时间轴内容 */}
        <div ref={timelineRef} className="flex-1 overflow-x-auto overflow-y-hidden relative" onClick={handleTimelineClick}>
          {/* 时间刻度 */}
          <div className="h-6 border-b border-canvas-border sticky top-0 bg-canvas-panel z-10">
            <div
              className="relative h-full"
              style={{ width: data.duration * PIXELS_PER_SECOND }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full flex items-end"
                  style={{ left: t * PIXELS_PER_SECOND }}
                >
                  <span className="text-[10px] text-slate-500 -translate-x-1/2 pb-0.5">
                    {formatTime(t)}
                  </span>
                  <div className="absolute bottom-0 w-px h-2 bg-canvas-border" />
                </div>
              ))}
            </div>
          </div>

          {/* 轨道内容 */}
          <div
            className="relative"
            style={{ width: data.duration * PIXELS_PER_SECOND }}
          >
            {/* 空轨道引导提示 */}
            {data.tracks.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center space-y-2 px-6 py-4 rounded-lg bg-canvas-hover/30">
                  <p className="text-sm text-slate-400">时间轴用于编排音视频片段</p>
                  <p className="text-xs text-slate-500">点击上方「+」按钮添加轨道，执行 AI 节点后可在属性面板将产出加入时间轴</p>
                </div>
              </div>
            )}
            {data.tracks.map((track) => (
              <div
                key={track.id}
                className="h-10 relative border-b border-canvas-border/30"
              >
                {track.clips.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {track.type === 'subtitle' ? (
                      <>
                        <span className="text-[10px] text-slate-600">双击编辑字幕</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const { currentTime } = useTimelineStore.getState().data;
                            const newClip: Clip = {
                              id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                              trackId: track.id,
                              start: currentTime,
                              end: currentTime + 3,
                              mediaType: 'subtitle',
                              mediaUrl: '',
                              label: '新字幕',
                              subtitleText: '',
                            };
                            addClip(track.id, newClip);
                            setEditingClipId(newClip.id);
                            setEditingText('');
                          }}
                          className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded hover:bg-canvas-hover transition-colors"
                        >
                          + 添加字幕
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-slate-600">执行节点后，在属性面板点击「加入时间轴」</span>
                    )}
                  </div>
                )}
                {track.clips.map((clip) => {
                  const isDragging = dragState?.clipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      className={`absolute top-1 h-8 rounded-md flex items-center px-2 cursor-grab group overflow-hidden transition-shadow ${
                        isDragging
                          ? 'ring-2 ring-white/70 shadow-lg z-10'
                          : 'hover:ring-1 hover:ring-white/30'
                      }`}
                      style={{
                        left: clip.start * PIXELS_PER_SECOND,
                        width: (clip.end - clip.start) * PIXELS_PER_SECOND,
                        backgroundColor: TRACK_COLORS[track.type] + '40',
                        borderLeft: `3px solid ${TRACK_COLORS[track.type]}`,
                      }}
                      onPointerDown={(e) => handleDragStart(e, track.id, clip, 'move')}
                      onClick={() => {
                        if (onClipClick && (clip.mediaUrl || clip.subtitleText)) onClipClick(clip);
                      }}
                      onDoubleClick={() => {
                        if (track.type === 'subtitle') {
                          setEditingClipId(clip.id);
                          setEditingText(clip.subtitleText ?? '');
                          return;
                        }
                        if (clip.nodeId) setSelectedNodeIds([clip.nodeId]);
                        if (clip.mediaUrl && onClipClick) onClipClick(clip);
                      }}
                      title={clip.nodeId ? `双击: 定位节点 + 预览` : clip.label}
                    >
                      {editingClipId === clip.id && track.type === 'subtitle' ? (
                        <input
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onBlur={() => {
                            updateClipText(track.id, clip.id, editingText);
                            setEditingClipId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              updateClipText(track.id, clip.id, editingText);
                              setEditingClipId(null);
                            } else if (e.key === 'Escape') {
                              setEditingClipId(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          autoFocus
                          className="bg-black/40 text-slate-200 text-[10px] px-1 py-0.5 rounded outline-none border border-white/30 focus:border-white/60 w-full"
                        />
                      ) : (
                        <span className={`truncate pointer-events-none ${track.type === 'subtitle' ? 'text-[10px]' : 'text-xs'} text-slate-300`}>
                          {track.type === 'subtitle' && clip.subtitleText
                            ? clip.subtitleText.length > 20
                              ? clip.subtitleText.slice(0, 20) + '…'
                              : clip.subtitleText
                            : clip.label}
                        </span>
                      )}
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeClip(track.id, clip.id);
                        }}
                        className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/20 transition-opacity"
                      >
                        <X className="w-3 h-3 text-slate-400" />
                      </button>
                      {/* 左 resize 手柄 */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize transition-colors ${
                          isDragging && dragState?.type === 'resize-left' ? 'bg-white/60' : 'hover:bg-white/40'
                        }`}
                        onPointerDown={(e) => handleDragStart(e, track.id, clip, 'resize-left')}
                      />
                      {/* 右 resize 手柄 */}
                      <div
                        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize transition-colors ${
                          isDragging && dragState?.type === 'resize-right' ? 'bg-white/60' : 'hover:bg-white/40'
                        }`}
                        onPointerDown={(e) => handleDragStart(e, track.id, clip, 'resize-right')}
                      />
                    </div>
                  );
                })}
              </div>
            ))}

            {/* 播放头 */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-status-error z-20 pointer-events-none"
              style={{ left: data.currentTime * PIXELS_PER_SECOND }}
            >
              <div className="w-3 h-3 bg-status-error rounded-full -translate-x-[5px] -translate-y-0.5" />
            </div>
          </div>
        </div>
      </div>
      {/* 拖拽时长 tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded bg-slate-900/90 border border-canvas-border text-xs text-slate-100 font-mono shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* 导出弹窗 */}
      {showExportModal && currentProjectId && (
        <ExportModal
          projectId={currentProjectId}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}
