"""视频导出服务：FFmpeg 多轨混流合成

注意：compose_video 被 Celery 任务 run_export_task 调用，运行在 Celery 独立事件循环中。
调用方必须通过 session_factory 参数传入 Celery 专用的 session factory，
不能复用 FastAPI 的 async_session_factory（事件循环不匹配会导致
`Future attached to a different loop` 错误）。
"""
import asyncio
import os
import tempfile
import uuid
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.media_asset import MediaAsset
from app.models.render_task import RenderTask
from app.services.media_service import get_minio_client, get_presigned_url
from app.config import settings


async def _download_to_temp(
    url: str,
    tmp_dir: str,
    filename: str,
    session_factory: async_sessionmaker,
) -> str:
    """下载 URL 到临时目录

    Args:
        session_factory: 数据库 session factory（Celery 场景需传入 Celery 专用实例）
    """
    local_path = os.path.join(tmp_dir, filename)
    # 处理内部 MinIO 路径
    if url.startswith('/api/v1/media/'):
        # 通过 presigned URL 下载
        parts = url.strip('/').split('/')
        media_id = parts[3] if len(parts) > 3 else parts[-1].split('?')[0]
        async with session_factory() as db:
            result = await db.execute(select(MediaAsset).where(MediaAsset.id == uuid.UUID(media_id)))
            asset = result.scalar_one_or_none()
            if asset:
                url = await get_presigned_url(settings.MINIO_BUCKET, asset.storage_key)

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(url)
        with open(local_path, 'wb') as f:
            f.write(resp.content)
    return local_path


async def compose_video(
    clips: list[dict],
    output_format: str,
    resolution: str,
    duration: float,
    task_id: str,
    session_factory: async_sessionmaker,
    subtitles: list[dict] | None = None,
) -> Path:
    """将时间轴素材合成为最终视频

    Args:
        clips: [{url, start, end, track_type, media_type}]
        output_format: mp4/mov/webm
        resolution: 720p/1080p/4k
        duration: 总时长（秒）
        task_id: 渲染任务 ID，用于更新进度
        session_factory: 数据库 session factory（Celery 场景必须传入 Celery 专用实例，
            避免复用 FastAPI 的 async_session_factory 触发事件循环不匹配）
        subtitles: [{start, end, text}] 字幕数据，可选
    """
    tmp_dir = tempfile.mkdtemp()

    # 1. 下载所有素材
    local_paths = []
    for i, clip in enumerate(clips):
        ext = '.mp4' if clip.get('media_type') == 'video' else '.png' if clip.get('media_type') == 'image' else '.mp3'
        path = await _download_to_temp(clip['url'], tmp_dir, f"clip_{i}{ext}", session_factory)
        local_paths.append(path)
        # 更新进度
        async with session_factory() as db:
            task = await db.get(RenderTask, uuid.UUID(task_id))
            if task:
                task.progress = int((i + 1) / len(clips) * 30)
                await db.commit()

    # 2. 分辨率映射
    resolution_map = {"720p": "1280:720", "1080p": "1920:1080", "4k": "3840:2160"}
    scale = resolution_map.get(resolution, "1920:1080")

    # 2.5 生成字幕 SRT 文件
    subtitle_vf = ""
    if subtitles:
        srt_path = os.path.join(tmp_dir, "subtitles.srt")
        with open(srt_path, 'w', encoding='utf-8') as f:
            for i, sub in enumerate(subtitles, 1):
                start_s = sub['start']
                end_s = sub['end']
                sh, rem = divmod(start_s, 3600)
                sm, ss = divmod(rem, 60)
                sms = int((start_s % 1) * 1000)
                eh, rem2 = divmod(end_s, 3600)
                em, es = divmod(rem2, 60)
                ems = int((end_s % 1) * 1000)
                f.write(f"{i}\n")
                f.write(f"{int(sh):02d}:{int(sm):02d}:{int(ss):02d},{sms:03d} --> {int(eh):02d}:{int(em):02d}:{int(es):02d},{ems:03d}\n")
                f.write(f"{sub['text']}\n\n")
        subtitle_vf = f"subtitles={srt_path}:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2'"

    # 3. 构建 FFmpeg 命令
    output_ext = output_format if output_format in ('mp4', 'mov', 'webm') else 'mp4'
    output_path = os.path.join(tmp_dir, f"output.{output_ext}")

    # 简单方案：按 start 时间顺序拼接视频片段
    video_clips = [(c, p) for c, p in zip(clips, local_paths) if c.get('track_type') == 'video']

    if not video_clips:
        # 没有视频片段，创建黑屏
        vf = f"scale={scale}"
        if subtitle_vf:
            vf += f",{subtitle_vf}"
        cmd = [
            'ffmpeg', '-y',
            '-f', 'lavfi', '-i', f'color=c=black:s={scale.replace(":", "x")}:d={duration}',
            '-vf', vf,
            '-c:v', 'libx264', '-t', str(duration),
            str(output_path)
        ]
    elif len(video_clips) == 1:
        # 单个视频片段，直接转码
        vf = f"scale={scale}"
        if subtitle_vf:
            vf += f",{subtitle_vf}"
        cmd = [
            'ffmpeg', '-y',
            '-i', str(video_clips[0][1]),
            '-vf', vf,
            '-c:v', 'libx264', '-c:a', 'aac',
            '-t', str(duration),
            str(output_path)
        ]
    else:
        # 多个视频片段，使用 concat
        concat_file = os.path.join(tmp_dir, "concat.txt")
        with open(concat_file, 'w') as f:
            for clip, path in sorted(video_clips, key=lambda x: x[0].get('start', 0)):
                f.write(f"file '{path}'\n")
        vf = f"scale={scale}"
        if subtitle_vf:
            vf += f",{subtitle_vf}"
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', concat_file,
            '-vf', vf,
            '-c:v', 'libx264', '-c:a', 'aac',
            '-t', str(duration),
            str(output_path)
        ]

    # 4. 执行 FFmpeg
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        error_msg = stderr.decode()[-500:] if stderr else 'Unknown FFmpeg error'
        raise RuntimeError(f"FFmpeg failed: {error_msg}")

    # 更新进度 90%
    async with session_factory() as db:
        task = await db.get(RenderTask, uuid.UUID(task_id))
        if task:
            task.progress = 90
            await db.commit()

    return Path(output_path)
