// src/queue/export.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { RenderTask } from '../modules/render/entities/render-task.entity';
import { MediaAsset } from '../modules/media/entities/media-asset.entity';
import { MinioService } from '../common/utils/minio.service';

export interface Clip {
  url: string;
  start: number;
  end: number;
  track_type: string;
  media_type: string;
}

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger('ExportService');

  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private minioService: MinioService,
  ) {}

  /**
   * 合成视频（对齐 Python export_service.py:54-183）
   * 返回输出文件的本地路径，调用方负责上传 MinIO 后清理
   */
  async composeVideo(
    clips: Clip[],
    outputFormat: string,
    resolution: string,
    duration: number,
    taskId: string,
    subtitles?: Subtitle[],
  ): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), `export_${taskId}_${uuidv4()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // M10: try/catch 包裹整体逻辑，任何失败（下载或 FFmpeg）都清理 tmpDir，避免磁盘泄漏
    try {
    // 1. 下载所有素材
    const localPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const ext = clip.media_type === 'video' ? '.mp4' : clip.media_type === 'image' ? '.png' : '.mp3';
      const localPath = await this.downloadToTemp(clip.url, tmpDir, `clip_${i}${ext}`);
      localPaths.push(localPath);

      // 更新进度（0-30%）
      await this.updateProgress(taskId, Math.floor((i + 1) / clips.length * 30));
    }

    // 2. 分辨率映射
    const resolutionMap: Record<string, string> = {
      '720p': '1280:720',
      '1080p': '1920:1080',
      '4k': '3840:2160',
    };
    const scale = resolutionMap[resolution] || '1920:1080';

    // 2.5 生成字幕 SRT 文件
    let subtitleFilter = '';
    if (subtitles && subtitles.length > 0) {
      const srtPath = path.join(tmpDir, 'subtitles.srt');
      this.writeSrtFile(srtPath, subtitles);
      subtitleFilter = `subtitles=${srtPath.replace(/:/g, '\\:')}:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2'`;
    }

    // 3. 构建 FFmpeg 命令
    const outputExt = ['mp4', 'mov', 'webm'].includes(outputFormat) ? outputFormat : 'mp4';
    const outputPath = path.join(tmpDir, `output.${outputExt}`);

    const videoClips = clips
      .map((c, i) => ({ clip: c, path: localPaths[i] }))
      .filter(({ clip }) => clip.track_type === 'video');

    return await new Promise<string>((resolve, reject) => {
      const cmd = ffmpeg();

      if (videoClips.length === 0) {
        // 无视频片段，创建黑屏
        cmd.input(`color=c=black:s=${scale.replace(':', 'x')}:d=${duration}`).inputFormat('lavfi');
        let vf = `scale=${scale}`;
        if (subtitleFilter) vf += `,${subtitleFilter}`;
        cmd.videoFilters(vf).outputOptions(['-c:v libx264', `-t ${duration}`]);
      } else if (videoClips.length === 1) {
        // 单个视频片段，直接转码
        cmd.input(videoClips[0].path);
        let vf = `scale=${scale}`;
        if (subtitleFilter) vf += `,${subtitleFilter}`;
        cmd.videoFilters(vf).outputOptions(['-c:v libx264', '-c:a aac', `-t ${duration}`]);
      } else {
        // 多个视频片段，使用 concat
        const concatFile = path.join(tmpDir, 'concat.txt');
        const sortedClips = [...videoClips].sort((a, b) => (a.clip.start || 0) - (b.clip.start || 0));
        fs.writeFileSync(
          concatFile,
          sortedClips.map(({ path: p }) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
        );
        cmd.input(concatFile).inputFormat('concat').inputOptions(['-safe 0']);
        let vf = `scale=${scale}`;
        if (subtitleFilter) vf += `,${subtitleFilter}`;
        cmd.videoFilters(vf).outputOptions(['-c:v libx264', '-c:a aac', `-t ${duration}`]);
      }

      cmd
        .output(outputPath)
        .on('end', async () => {
          this.logger.log(`FFmpeg 合成完成: ${outputPath}`);
          await this.updateProgress(taskId, 90);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`FFmpeg 失败: ${err.message}`);
          reject(new Error(`FFmpeg failed: ${err.message}`));
        })
        .run();
    });
    } catch (err) {
      // M10: 任何失败（下载或 FFmpeg）都清理 tmpDir，避免磁盘泄漏（对齐 Python finally: shutil.rmtree）
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        this.logger.warn(`清理临时目录失败: ${(e as Error).message}`);
      }
      throw err;
    }
  }

  /** 上传导出结果到 MinIO 并创建 MediaAsset，返回 /api/v1/media/{id}/download */
  async uploadExportAndCreateAsset(
    localPath: string,
    taskId: string,
    ownerId: string,
    projectId: string,
  ): Promise<string> {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath);
    const objectName = `exports/${projectId}/${taskId}${ext}`;

    await this.minioService.uploadFile(objectName, buffer, 'video/mp4');

    const mediaAsset = this.mediaRepo.create({
      id: uuidv4(),
      ownerId,
      projectId,
      fileName: `export_${taskId}${ext}`,
      fileType: 'video/mp4',
      fileSize: buffer.length,
      storageKey: objectName,
    });
    await this.mediaRepo.save(mediaAsset);

    // 清理临时文件（递归删除整个临时目录，对齐 Python shutil.rmtree）
    try {
      fs.rmSync(path.dirname(localPath), { recursive: true, force: true });
    } catch (e) {
      this.logger.warn(`清理临时文件失败: ${(e as Error).message}`);
    }

    return `/api/v1/media/${mediaAsset.id}/download`;
  }

  private async downloadToTemp(url: string, tmpDir: string, filename: string): Promise<string> {
    const localPath = path.join(tmpDir, filename);

    // 处理内部 MinIO 路径 /api/v1/media/{id}/download
    if (url.startsWith('/api/v1/media/')) {
      const parts = url.replace(/^\//, '').split('/');
      const mediaId = parts[3] || parts[parts.length - 1].split('?')[0];
      const asset = await this.mediaRepo.findOne({ where: { id: mediaId } });
      if (asset) {
        const presignedUrl = await this.minioService.getPresignedUrl(asset.storageKey, 1);
        const resp = await axios.get(presignedUrl, { responseType: 'arraybuffer', timeout: 120000 });
        fs.writeFileSync(localPath, Buffer.from(resp.data));
        return localPath;
      }
    }

    // 外部 URL
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(localPath, Buffer.from(resp.data));
    return localPath;
  }

  private writeSrtFile(srtPath: string, subtitles: Subtitle[]): void {
    const lines: string[] = [];
    subtitles.forEach((sub, i) => {
      lines.push(String(i + 1));
      lines.push(`${this.formatSrtTime(sub.start)} --> ${this.formatSrtTime(sub.end)}`);
      lines.push(sub.text);
      lines.push('');
    });
    fs.writeFileSync(srtPath, lines.join('\n'), 'utf-8');
  }

  private formatSrtTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  private async updateProgress(taskId: string, progress: number): Promise<void> {
    try {
      await this.taskRepo.update(taskId, { progress });
    } catch (e) {
      this.logger.warn(`更新进度失败: ${(e as Error).message}`);
    }
  }
}
