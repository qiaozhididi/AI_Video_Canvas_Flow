// src/queue/render.processor.ts
import { Processor, OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { RenderTask } from '../modules/render/entities/render-task.entity';
import { MediaAsset } from '../modules/media/entities/media-asset.entity';
import { AiService } from '../modules/ai/ai.service';
import { MinioService } from '../common/utils/minio.service';

@Processor('render-tasks', { concurrency: 5 })
export class RenderProcessor extends WorkerHost {
  private readonly logger = new Logger('RenderProcessor');

  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private aiService: AiService,
    private minioService: MinioService,
  ) {
    super();
  }

  async process(job: Job<{ taskId: string; params: any }>) {
    const { taskId } = job.data;
    const params = job.data.params || {};

    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`任务不存在: ${taskId}`);
      return;
    }

    try {
      task.status = 'running';
      task.progress = 0;
      await this.taskRepo.save(task);

      if (task.taskType.startsWith('ai_')) {
        await this.executeAiTask(task, job, params);
      } else if (task.taskType === 'export') {
        await this.executeExportTask(task, job, params);
      } else {
        await this.executeRenderTask(task, job);
      }

      task.status = 'completed';
      task.progress = 100;
      await this.taskRepo.save(task);

      this.logger.log(`任务完成: ${taskId} type=${task.taskType}`);
    } catch (err) {
      this.logger.error(`任务失败: ${taskId} err=${(err as Error).message}`);
      task.status = 'failed';
      task.errorMessage = (err as Error).message || '任务执行失败';
      await this.taskRepo.save(task);
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    this.logger.error(`队列任务失败: job=${job?.id} err=${err.message}`);
  }

  // ── AI 任务执行 ──
  private async executeAiTask(
    task: RenderTask,
    job: Job,
    params: { modelId?: string; prompt?: string; inputArtifacts?: any[]; nodeParams?: any },
  ) {
    const userId = task.ownerId;
    const nodeParams = params.nodeParams || {};
    const prompt = params.prompt || nodeParams.prompt || '';
    const modelId = params.modelId || nodeParams.model_id;
    const inputArtifacts = params.inputArtifacts || [];

    if (!modelId) {
      throw new Error('AI 任务缺少 model_id');
    }

    await job.updateProgress(10);

    let resultUrl: string;

    if (task.taskType === 'ai_text2img' || task.taskType === 'ai_img2img') {
      const size = this.normalizeSize(nodeParams.size || nodeParams.params?.size);
      const imageParams: any = { prompt, size };
      if (task.taskType === 'ai_img2img' && inputArtifacts.length > 0) {
        const upstreamImage = inputArtifacts.find(a => a.url || a.path);
        if (upstreamImage) {
          imageParams.image = upstreamImage.url || upstreamImage.path;
        }
      }
      resultUrl = await this.aiService.callImageGen(modelId, imageParams, userId);
      await job.updateProgress(60);
      resultUrl = await this.downloadAndUpload(resultUrl, userId, 'png');
    } else if (task.taskType === 'ai_text2video' || task.taskType === 'ai_img2video') {
      if (task.taskType === 'ai_img2video' && inputArtifacts.length === 0) {
        this.logger.warn(`图生视频任务 ${task.id} 无上游图片，使用模拟`);
        resultUrl = await this.generateSimulatedResult(userId, 'mp4');
      } else {
        const videoParams: any = { prompt };
        if (inputArtifacts.length > 0) {
          const upstreamImage = inputArtifacts.find(a => a.url || a.path);
          if (upstreamImage) {
            videoParams.image = upstreamImage.url || upstreamImage.path;
          }
        }
        resultUrl = await this.aiService.callVideoGen(modelId, videoParams, userId);
        await job.updateProgress(60);
        resultUrl = await this.downloadAndUpload(resultUrl, userId, 'mp4');
      }
    } else if (task.taskType === 'ai_tts') {
      const audioParams = { text: prompt || nodeParams.text, voice: nodeParams.voice };
      const base64Audio = await this.aiService.callAudioGen(modelId, audioParams, userId);
      await job.updateProgress(60);
      const buffer = Buffer.from(base64Audio.split(',')[1], 'base64');
      resultUrl = await this.uploadResultAndBuildUrl(buffer, userId, 'mp3', 'audio/mpeg');
    } else {
      const messages = [{ role: 'user', content: prompt }];
      const content = await this.aiService.callLlm(modelId, messages, userId);
      await job.updateProgress(60);
      const buffer = Buffer.from(content, 'utf-8');
      resultUrl = await this.uploadResultAndBuildUrl(buffer, userId, 'txt', 'text/plain');
    }

    await job.updateProgress(100);
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }

  // ── 模拟渲染任务 ──
  private async executeRenderTask(task: RenderTask, job: Job) {
    for (let i = 0; i <= 100; i += 10) {
      task.progress = i;
      await this.taskRepo.save(task);
      await job.updateProgress(i);
      await new Promise(r => setTimeout(r, 200));
    }
    const resultUrl = await this.generateSimulatedResult(task.ownerId, 'png');
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }

  // ── 导出任务 ──
  private async executeExportTask(
    task: RenderTask,
    job: Job,
    params: { nodeParams?: any },
  ) {
    const exportParams = params.nodeParams || task.nodeParams || {};
    this.logger.log(`导出任务: format=${exportParams.format} resolution=${exportParams.resolution}`);

    for (let i = 0; i <= 100; i += 20) {
      task.progress = i;
      await this.taskRepo.save(task);
      await job.updateProgress(i);
      await new Promise(r => setTimeout(r, 500));
    }
    const resultUrl = await this.generateSimulatedResult(task.ownerId, 'mp4');
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }

  // ── 工具方法 ──
  private async uploadResultAndBuildUrl(
    buffer: Buffer, userId: string, ext: string, contentType: string,
  ): Promise<string> {
    const objectName = `results/${userId}/${uuidv4()}.${ext}`;
    await this.minioService.uploadFile(objectName, buffer, contentType);
    const mediaAsset = this.mediaRepo.create({
      id: uuidv4(),
      ownerId: userId,
      fileName: `result.${ext}`,
      fileType: contentType,
      fileSize: buffer.length,
      storageKey: objectName,
    });
    await this.mediaRepo.save(mediaAsset);
    return `/api/v1/media/${mediaAsset.id}/download`;
  }

  private async downloadAndUpload(url: string, userId: string, ext: string): Promise<string> {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const buffer = Buffer.from(resp.data);
    const rawContentType = resp.headers['content-type'];
    const contentType = typeof rawContentType === 'string' ? rawContentType : `image/${ext}`;
    return this.uploadResultAndBuildUrl(buffer, userId, ext, contentType);
  }

  private async generateSimulatedResult(userId: string, ext: string): Promise<string> {
    const buffer = Buffer.from(
      ext === 'mp4' ? 'simulated-video' : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ext === 'mp4' ? 'utf-8' : 'base64',
    );
    const contentType = ext === 'mp4' ? 'video/mp4' : 'image/png';
    return this.uploadResultAndBuildUrl(buffer, userId, ext, contentType);
  }

  private normalizeSize(size: string | undefined): string {
    if (!size) return '1024x1024';
    const sizeMap: Record<string, string> = {
      '1k': '1024x1024',
      '2k': '2048x2048',
      '4k': '4096x4096',
    };
    return sizeMap[size.toLowerCase()] || size;
  }
}
