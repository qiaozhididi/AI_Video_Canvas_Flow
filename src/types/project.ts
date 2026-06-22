import type { CanvasNode, CanvasEdge } from './canvas';
import type { TimelineData } from './timeline';

// 工作流项目
export interface Project {
  id: string;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  canvasNodes: CanvasNode[];
  canvasEdges: CanvasEdge[];
  timelineData: TimelineData;
  createdAt: string;
  updatedAt: string;
}

// 创建空项目
export function createEmptyProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    canvasNodes: [],
    canvasEdges: [],
    timelineData: {
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
      ],
      currentTime: 0,
      zoom: 1,
    },
    createdAt: now,
    updatedAt: now,
  };
}
