import { useMemo } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useTimelineStore } from '@/stores/timelineStore';

interface PreviewContent {
  url: string | undefined;
  type: 'image' | 'video' | undefined;
  subtitleText?: string;
}

export function usePreviewContent(
  selectedClipMedia: { url: string; type: 'image' | 'video' } | null,
): PreviewContent {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const timelineData = useTimelineStore((s) => s.data);
  const isTimelinePlaying = useTimelineStore((s) => s.isPlaying);
  const nodes = useCanvasStore((s) => s.nodes);

  return useMemo(() => {
    if (isTimelinePlaying) {
      const ct = timelineData.currentTime;
      const trackPriority: Record<string, number> = { video: 0, audio: 1, subtitle: 2 };
      const allActiveClips = timelineData.tracks
        .filter((t) => t.visible && !t.muted)
        .flatMap((t) => t.clips.map((c) => ({ ...c, trackType: t.type })))
        .filter((c) => ct >= c.start && ct < c.end && (c.mediaUrl || c.subtitleText));

      // 媒体片段（有 mediaUrl）排序取第一个 → 控制 url/type
      const mediaClip = allActiveClips
        .filter((c) => c.mediaUrl)
        .sort((a, b) => {
          const pa = trackPriority[a.trackType] ?? 9;
          const pb = trackPriority[b.trackType] ?? 9;
          if (pa !== pb) return pa - pb;
          return a.start - b.start;
        })[0];

      // 字幕片段（trackType === 'subtitle' 且有 subtitleText）
      const subtitleClip = allActiveClips.find(
        (c) => c.trackType === 'subtitle' && c.subtitleText,
      );

      if (mediaClip) {
        const clipType = mediaClip.mediaType || 'video';
        return { url: mediaClip.mediaUrl, type: clipType as 'image' | 'video' | undefined, subtitleText: subtitleClip?.subtitleText };
      }
      if (subtitleClip) {
        return { url: undefined, type: undefined, subtitleText: subtitleClip.subtitleText };
      }
      return { url: undefined, type: undefined };
    }

    if (selectedClipMedia) {
      return { url: selectedClipMedia.url, type: selectedClipMedia.type };
    }

    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId);
      if (node && node.data.outputArtifacts.length) {
        const videoArt = node.data.outputArtifacts.find((a) => a.type === 'video');
        const imageArt = node.data.outputArtifacts.find((a) => a.type === 'image');
        const artifact = videoArt || imageArt;
        if (artifact) {
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
        }
      }
    }

    return { url: undefined, type: undefined };
  }, [isTimelinePlaying, selectedClipMedia, selectedNodeId, timelineData.currentTime, timelineData.tracks, nodes]);
}
