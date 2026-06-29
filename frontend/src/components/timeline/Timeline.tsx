import { useRef, useCallback } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  Play, Pause, SkipBack, SkipForward,
  Plus, Volume2, VolumeX, Lock, Unlock, Eye, EyeOff,
  Trash2, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { TrackType, Clip } from '@/types/timeline';

const TRACK_COLORS: Record<TrackType, string> = {
  video: '#7C3AED',
  audio: '#3B82F6',
  subtitle: '#EAB308',
  effect: '#06B6D4',
};

export default function Timeline() {
  const {
    data, isPlaying, play, pause, seekTo,
    addTrack, removeTrack, toggleTrackMute, toggleTrackLock, toggleTrackVisibility,
    removeClip, moveClip, resizeClip, setZoom,
  } = useTimelineStore();
  const { nodes } = useCanvasStore();
  const timelineRef = useRef<HTMLDivElement>(null);

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

  // resize 手柄拖拽处理（Pointer Events + setPointerCapture）
  const handleResizeStart = useCallback(
    (e: React.PointerEvent, trackId: string, clip: Clip, edge: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startClipStart = clip.start;
      const startClipEnd = clip.end;
      const minDuration = 0.5;
      const maxEnd = data.duration;

      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const handleMove = (ev: PointerEvent) => {
        const dt = (ev.clientX - startX) / PIXELS_PER_SECOND;
        if (edge === 'left') {
          const newStart = Math.max(0, Math.min(startClipStart + dt, startClipEnd - minDuration));
          resizeClip(trackId, clip.id, newStart, startClipEnd);
        } else {
          const newEnd = Math.max(startClipStart + minDuration, Math.min(startClipEnd + dt, maxEnd));
          resizeClip(trackId, clip.id, startClipStart, newEnd);
        }
      };
      const handleUp = (ev: PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [PIXELS_PER_SECOND, data.duration, resizeClip]
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
              title={`添加${type === 'video' ? '视频' : type === 'audio' ? '音频' : type === 'subtitle' ? '字幕' : '特效'}轨`}
            >
              <Plus className="w-3 h-3" />
            </button>
          ))}
        </div>

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
            {data.tracks.map((track) => (
              <div
                key={track.id}
                className="h-10 relative border-b border-canvas-border/30"
              >
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className="absolute top-1 h-8 rounded-md flex items-center px-2 cursor-move group overflow-hidden"
                    style={{
                      left: clip.start * PIXELS_PER_SECOND,
                      width: (clip.end - clip.start) * PIXELS_PER_SECOND,
                      backgroundColor: TRACK_COLORS[track.type] + '40',
                      borderLeft: `3px solid ${TRACK_COLORS[track.type]}`,
                    }}
                    draggable
                    onDragEnd={(e) => {
                      // 简化拖拽处理
                      const rect = timelineRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const x = e.clientX - rect.left;
                      const newStart = Math.max(0, x / PIXELS_PER_SECOND);
                      moveClip(track.id, clip.id, newStart);
                    }}
                  >
                    <span className="text-xs text-slate-300 truncate">{clip.label}</span>
                    <button
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
                      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30 transition-colors"
                      onPointerDown={(e) => handleResizeStart(e, track.id, clip, 'left')}
                    />
                    {/* 右 resize 手柄 */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30 transition-colors"
                      onPointerDown={(e) => handleResizeStart(e, track.id, clip, 'right')}
                    />
                  </div>
                ))}
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
