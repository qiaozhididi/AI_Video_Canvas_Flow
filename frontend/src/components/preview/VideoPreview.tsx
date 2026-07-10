import { useRef, useEffect, useCallback, useState } from 'react';
import videojs from 'video.js';
import type Player from 'video.js/dist/types/player';
import 'video.js/dist/video-js.css';
import { Maximize, Minimize } from 'lucide-react';

interface VideoPreviewProps {
  src?: string;
  poster?: string;
  mediaType?: 'image' | 'video';
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  subtitleText?: string;
}

export default function VideoPreview({ src, poster, mediaType, currentTime, onTimeUpdate, subtitleText }: VideoPreviewProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 用 ref 存储 onTimeUpdate 回调，避免闭包陈旧 + 从依赖数组移除
  const onTimeUpdateRef = useRef(onTimeUpdate);

  // 同步 ref 到最新的 onTimeUpdate
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // 监听全屏变化
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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
        aspectRatio: '16:9',
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
      } else {
        playerRef.current.reset();
      }
      if (poster) {
        playerRef.current.poster(poster);
      }
    }

    return () => {
      // src/poster 变化时不销毁 player，仅更新源
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
    <div ref={containerRef} className="w-full h-full bg-black rounded-lg overflow-hidden flex flex-col relative">
      {src && mediaType === 'image' ? (
        <img src={src} alt="预览图片" className="w-full h-full object-contain" />
      ) : src ? (
        <div ref={videoRef} className="w-full h-full flex-1" />
      ) : subtitleText ? null : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center space-y-2 px-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-canvas-hover flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <p className="text-sm text-slate-500">暂无预览</p>
            <p className="text-xs text-slate-600">执行 AI 节点后，将产出加入时间轴</p>
            <p className="text-xs text-slate-600">播放时间轴即可在此预览</p>
          </div>
        </div>
      )}
      {/* 字幕覆盖层 */}
      {subtitleText && (
        <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-1.5 rounded text-sm max-w-[80%] text-center transition-opacity duration-200 pointer-events-none">
          {subtitleText}
        </div>
      )}
      {/* 全屏按钮 */}
      {src && (
        <button
          onClick={toggleFullscreen}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
          title={isFullscreen ? '退出全屏' : '全屏预览'}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}
