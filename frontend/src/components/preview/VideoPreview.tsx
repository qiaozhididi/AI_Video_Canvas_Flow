import { useRef, useEffect } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';

interface VideoPreviewProps {
  src?: string;
  poster?: string;
  mediaType?: 'image' | 'video';
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
}

export default function VideoPreview({ src, poster, mediaType, currentTime, onTimeUpdate }: VideoPreviewProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  // 用 ref 存储 onTimeUpdate 回调，避免闭包陈旧 + 从依赖数组移除
  const onTimeUpdateRef = useRef(onTimeUpdate);

  // 同步 ref 到最新的 onTimeUpdate
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  // 创建/更新 player（src/poster 变化时）
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

      // 注册 timeupdate 回调（播放进度变化时回写）
      playerRef.current.on('timeupdate', () => {
        const time = playerRef.current?.currentTime();
        if (typeof time === 'number' && onTimeUpdateRef.current) {
          onTimeUpdateRef.current(time);
        }
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

  // currentTime 变化时跳转播放位置（避免回环：onTimeUpdate 触发的 currentTime 变化不再触发跳转）
  useEffect(() => {
    if (playerRef.current && typeof currentTime === 'number') {
      const playerTime = playerRef.current.currentTime();
      // 仅当差异 > 0.3s 时跳转，避免 timeupdate 回调造成的微小回环
      if (Math.abs(playerTime - currentTime) > 0.3) {
        playerRef.current.currentTime(currentTime);
      }
    }
  }, [currentTime]);

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
      {src && mediaType === 'image' ? (
        <img src={src} alt="预览图片" className="w-full h-full object-contain" />
      ) : src ? (
        <div ref={videoRef} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-hover flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">暂无预览</p>
            <p className="text-xs text-slate-600">执行工作流后在此预览</p>
          </div>
        </div>
      )}
    </div>
  );
}
