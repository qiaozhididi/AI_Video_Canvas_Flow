import { create } from 'zustand';
import type { Track, Clip, TimelineData } from '@/types/timeline';
import { createDefaultTimeline } from '@/types/timeline';

interface TimelineState {
  data: TimelineData;
  isPlaying: boolean;

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

  // 缩放
  setZoom: (zoom: number) => void;

  // 重置
  reset: () => void;
  loadTimeline: (data: TimelineData) => void;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  data: createDefaultTimeline(),
  isPlaying: false,

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),

  seekTo: (time) =>
    set((state) => ({
      data: { ...state.data, currentTime: Math.max(0, Math.min(time, state.data.duration)) },
    })),

  setCurrentTime: (time) =>
    set((state) => ({
      data: { ...state.data, currentTime: time },
    })),

  addTrack: (type) =>
    set((state) => {
      const count = state.data.tracks.filter((t) => t.type === type).length + 1;
      const labels: Record<string, string> = { video: '视频轨', audio: '音频轨', subtitle: '字幕轨', effect: '特效轨' };
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

  setZoom: (zoom) =>
    set((state) => ({
      data: { ...state.data, zoom: Math.max(0.1, Math.min(10, zoom)) },
    })),

  reset: () => set({ data: createDefaultTimeline(), isPlaying: false }),
  loadTimeline: (data) => set({ data, isPlaying: false }),
}));
