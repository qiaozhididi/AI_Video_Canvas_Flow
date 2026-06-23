// 时间轴轨道类型
export type TrackType = 'video' | 'audio' | 'subtitle' | 'effect';

// 时间轴片段
export interface Clip {
  id: string;
  trackId: string;
  start: number;
  end: number;
  mediaUrl: string;
  label: string;
  color?: string;
}

// 时间轴轨道
export interface Track {
  id: string;
  type: TrackType;
  label: string;
  clips: Clip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

// 时间轴数据
export interface TimelineData {
  duration: number;
  tracks: Track[];
  currentTime: number;
  zoom: number;
}

// 创建默认时间轴
export function createDefaultTimeline(): TimelineData {
  return {
    duration: 30,
    tracks: [
      {
        id: 'track-video-1',
        type: 'video',
        label: '视频轨 1',
        clips: [],
        muted: false,
        locked: false,
        visible: true,
      },
      {
        id: 'track-audio-1',
        type: 'audio',
        label: '音频轨 1',
        clips: [],
        muted: false,
        locked: false,
        visible: true,
      },
      {
        id: 'track-subtitle-1',
        type: 'subtitle',
        label: '字幕轨 1',
        clips: [],
        muted: false,
        locked: false,
        visible: true,
      },
    ],
    currentTime: 0,
    zoom: 1,
  };
}
