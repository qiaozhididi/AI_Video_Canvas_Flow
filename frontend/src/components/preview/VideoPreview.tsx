import { useRef, useEffect } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';

interface VideoPreviewProps {
  src?: string;
  poster?: string;
}

export default function VideoPreview({ src, poster }: VideoPreviewProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    if (!playerRef.current) {
      const videoElement = document.createElement('video');
      videoElement.classList.add('video-js', 'vjs-big-play-centered');
      videoRef.current.appendChild(videoElement);

      playerRef.current = videojs(videoElement, {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: false,
        responsive: true,
        poster: poster || '',
        sources: src ? [{ src, type: 'video/mp4' }] : [],
      });
    } else {
      if (src) {
        playerRef.current.src({ src, type: 'video/mp4' });
      }
      if (poster) {
        playerRef.current.poster(poster);
      }
    }

    return () => {
      // 组件卸载时不销毁 player，避免重复创建
    };
  }, [src, poster]);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden">
      {src ? (
        <div ref={videoRef} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-hover flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">暂无视频预览</p>
            <p className="text-xs text-slate-600">执行工作流后在此预览</p>
          </div>
        </div>
      )}
    </div>
  );
}
