import { create } from 'zustand';
import type { Track, Clip, TimelineData } from '@/types/timeline';
import { createDefaultTimeline } from '@/types/timeline';

// 模块级 rAF 状态（不放入 Zustand state，避免每帧触发组件重渲染）
let rAFId: number | null = null;
let lastTimestamp: number | null = null;

interface TimelineState {
  data: TimelineData;
  isPlaying: boolean;
  hasPlayedToEnd: boolean;

  // 播放控制
  play: () => void;
  pause: () => void;
  seekTo: (time: number) => void;
  setCurrentTime: (time: number) => void;

  // 轨道操作
  addTrack: (type: Track['type']) => void;
  removeTrack: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackVisibility: (trackId: string) => void;

  // 片段操作
  addClip: (trackId: string, clip: Clip) => void;
  removeClip: (trackId: string, clipId: string) => void;
  moveClip: (trackId: string, clipId: string, newStart: number) => void;
  resizeClip: (trackId: string, clipId: string, newStart: number, newEnd: number) => void;
  updateClipText: (trackId: string, clipId: string, text: string) => void;

  // 缩放
  setZoom: (zoom: number) => void;

  // 重置
  reset: () => void;
  loadTimeline: (data: TimelineData) => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  data: createDefaultTimeline(),
  isPlaying: false,
  hasPlayedToEnd: false,

  play: () => {
    if (rAFId !== null) {
      cancelAnimationFrame(rAFId);
    }
    set({ hasPlayedToEnd: false });
    // 播放前：如果已在末尾，先回到开头，避免立即触发结束条件导致循环卡住
    const current = useTimelineStore.getState();
    if (current.data.currentTime >= current.data.duration - 0.1) {
      set((s) => ({ data: { ...s.data, currentTime: 0 } }));
    }
    set({ isPlaying: true });
    lastTimestamp = null;
    const tick = (timestamp: number) => {
      const state = useTimelineStore.getState();
      if (!state.isPlaying) return;

      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      const rawDelta = (timestamp - lastTimestamp) / 1000; // ms → s
      lastTimestamp = timestamp;

      // 限制单帧 delta 上限，防止页面后台/标签页切换/自动化环境
      // 导致 rAF 批量调度引起 timestamp 跳变，播放速度异常快
      // 正常 60fps ≈ 16ms，30fps ≈ 33ms，上限 50ms 不影响正常播放
      const delta = Math.max(0, Math.min(rawDelta, 0.05));

      const nextTime = state.data.currentTime + delta;
      if (nextTime >= state.data.duration) {
        // 播放到末尾自动停止
        set((s) => ({
          data: { ...s.data, currentTime: s.data.duration },
          isPlaying: false,
          hasPlayedToEnd: true,
        }));
        rAFId = null;
        lastTimestamp = null;
        return;
      }

      set((s) => ({
        data: { ...s.data, currentTime: nextTime },
      }));
      rAFId = requestAnimationFrame(tick);
    };
    rAFId = requestAnimationFrame(tick);
  },

  pause: () => {
    if (rAFId !== null) {
      cancelAnimationFrame(rAFId);
      rAFId = null;
    }
    lastTimestamp = null;
    set({ isPlaying: false, hasPlayedToEnd: false });
  },

  seekTo: (time) => {
    // 播放中 seek 重置时间戳，避免下一帧 delta 跳变
    lastTimestamp = null;
    set((state) => ({
      data: { ...state.data, currentTime: Math.max(0, Math.min(time, state.data.duration)) },
    }));
  },

  setCurrentTime: (time) =>
    set((state) => ({
      data: { ...state.data, currentTime: Math.max(0, Math.min(time, state.data.duration)) },
    })),

  addTrack: (type) =>
    set((state) => {
      const count = state.data.tracks.filter((t) => t.type === type).length + 1;
      const labels: Record<string, string> = { video: '视频轨', audio: '音频轨', subtitle: '字幕轨' };
      const newTrack: Track = {
        id: `track-${type}-${Date.now()}`,
        type,
        label: `${labels[type]} ${count}`,
        clips: [],
        muted: false,
        locked: false,
        visible: true,
      };
      return { data: { ...state.data, tracks: [...state.data.tracks, newTrack] } };
    }),

  removeTrack: (trackId) =>
    set((state) => ({
      data: { ...state.data, tracks: state.data.tracks.filter((t) => t.id !== trackId) },
    })),

  toggleTrackMute: (trackId) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId ? { ...t, muted: !t.muted } : t
        ),
      },
    })),

  toggleTrackLock: (trackId) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId ? { ...t, locked: !t.locked } : t
        ),
      },
    })),

  toggleTrackVisibility: (trackId) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId ? { ...t, visible: !t.visible } : t
        ),
      },
    })),

  addClip: (trackId, clip) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
        ),
      },
    })),

  removeClip: (trackId, clipId) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
        ),
      },
    })),

  moveClip: (trackId, clipId, newStart) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips.map((c) =>
                  c.id === clipId
                    ? { ...c, start: newStart, end: newStart + (c.end - c.start) }
                    : c
                ),
              }
            : t
        ),
      },
    })),

  resizeClip: (trackId, clipId, newStart, newEnd) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips.map((c) =>
                  c.id === clipId ? { ...c, start: newStart, end: newEnd } : c
                ),
              }
            : t
        ),
      },
    })),

  updateClipText: (trackId, clipId, text) =>
    set((state) => ({
      data: {
        ...state.data,
        tracks: state.data.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips.map((c) =>
                  c.id === clipId
                    ? {
                        ...c,
                        subtitleText: text,
                        label: text.length > 20 ? text.slice(0, 20) + '…' : text || c.label,
                      }
                    : c
                ),
              }
            : t
        ),
      },
    })),

  setZoom: (zoom) =>
    set((state) => ({
      data: { ...state.data, zoom: Math.max(0.1, Math.min(10, zoom)) },
    })),

  reset: () => set({ data: createDefaultTimeline(), isPlaying: false, hasPlayedToEnd: false }),
  loadTimeline: (data) => set({ data, isPlaying: false, hasPlayedToEnd: false }),
}));
