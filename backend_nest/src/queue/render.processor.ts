// src/queue/render.processor.ts
import { Processor, OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RenderTask } from '../modules/render/entities/render-task.entity';
import { MediaAsset } from '../modules/media/entities/media-asset.entity';
import { WorkflowNode } from '../modules/workflows/entities/workflow-node.entity';
import { AiService } from '../modules/ai/ai.service';
import { MinioService } from '../common/utils/minio.service';
import { ExportService, Clip } from './export.service';

@Processor('render-tasks', { concurrency: 5 })
export class RenderProcessor extends WorkerHost {
  private readonly logger = new Logger('RenderProcessor');

  constructor(
    @InjectRepository(RenderTask) private taskRepo: Repository<RenderTask>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    @InjectRepository(WorkflowNode) private nodeRepo: Repository<WorkflowNode>,
    private aiService: AiService,
    private minioService: MinioService,
    private exportService: ExportService,
  ) {
    super();
  }

  async process(job: Job<{ taskId: string; params: any }>) {
    const { taskId } = job.data;
    let params = job.data.params || {};

    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`任务不存在: ${taskId}`);
      return;
    }

    try {
      task.status = 'running';
      task.progress = 0;
      await this.taskRepo.save(task);

      // C16: params 为空但 task.nodeId 存在时，从 WorkflowNode.config.params 读取
      // （对齐 Python render_tasks.py:100-124）
      if ((!params.nodeParams || Object.keys(params.nodeParams || {}).length === 0) && task.nodeId) {
        const node = await this.nodeRepo.findOne({ where: { id: task.nodeId } });
        if (node?.config?.params) {
          params = { ...params, nodeParams: node.config.params };
          this.logger.log(`从节点 ${task.nodeId} 读取 params: ${JSON.stringify(Object.keys(params.nodeParams))}`);
        }
      }

      if (task.taskType.startsWith('ai_')) {
        await this.executeAiTask(task, job, params);
      } else if (task.taskType === 'export') {
        await this.executeExportTask(task, job, params);
      } else {
        await this.executeRenderTask(task, job, params);
      }

      // C18: 检查任务是否被取消（cancelTask 调用 discard()+remove() 后任务从 Redis 移除）
      // 注意：BullMQ 5.x 的 discard() 仅在本地 Job 实例设置标志（跨实例不可见），
      // 因此通过 job.getState() 检测任务是否已从 Redis 移除（对齐 Python revoke(terminate=True) 的"终止运行中任务"语义）
      const state = await job.getState();
      if (state === 'unknown') {
        task.status = 'cancelled';
        await this.taskRepo.save(task);
        this.logger.log(`任务已取消: ${taskId}`);
        return;
      }

      task.status = 'completed';
      task.progress = 100;
      await this.taskRepo.save(task);

      this.logger.log(`任务完成: ${taskId} type=${task.taskType}`);
    } catch (err) {
      const isCancelled = (err as Error).message === '任务已被取消';
      if (!isCancelled) {
        this.logger.error(`任务失败: ${taskId} err=${(err as Error).message}`);
      }
      task.status = isCancelled ? 'cancelled' : 'failed';
      task.errorMessage = isCancelled ? null : ((err as Error).message || '任务执行失败');
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
    await this.checkCancelled(job, task);

    const userId = task.ownerId;
    const nodeParams = params.nodeParams || {};
    const prompt = params.prompt || nodeParams.prompt || nodeParams.text || '';
    const modelId = params.modelId || nodeParams.model_id;
    const inputArtifacts = params.inputArtifacts || [];

    if (!modelId) {
      throw new Error('AI 任务缺少 model_id');
    }

    await job.updateProgress(10);

    let resultUrl: string;

    if (task.taskType === 'ai_text2img') {
      const result = await this.aiService.callImageGen(modelId, { prompt, size: nodeParams.size }, userId);
      await job.updateProgress(60);
      resultUrl = result.url;
    } else if (task.taskType === 'ai_img2img') {
      // C11: 图生图
      const imageUrl = inputArtifacts.find((a: any) => a.url)?.url || '';
      if (!imageUrl) {
        this.logger.warn(`图生图任务 ${task.id} 无上游图片，使用模拟`);
        resultUrl = await this.generateSimulatedResult(userId, 'png');
      } else {
        const result = await this.aiService.callImg2Img(modelId, prompt, imageUrl, { size: nodeParams.size }, userId);
        await job.updateProgress(60);
        resultUrl = result.url;
      }
    } else if (task.taskType === 'ai_text2video' || task.taskType === 'ai_img2video') {
      if (task.taskType === 'ai_img2video' && inputArtifacts.length === 0) {
        this.logger.warn(`图生视频任务 ${task.id} 无上游图片，使用模拟`);
        resultUrl = await this.generateSimulatedResult(userId, 'mp4');
      } else {
        const videoParams: any = { prompt };
        if (inputArtifacts.length > 0) {
          videoParams.image = inputArtifacts.find((a: any) => a.url)?.url;
        }
        const result = await this.aiService.callVideoGen(modelId, videoParams, userId);
        await job.updateProgress(60);
        resultUrl = result.video_url;
      }
    } else if (task.taskType === 'ai_tts') {
      // C10: TTS 改用 Ark 异步
      const result = await this.aiService.callAudioGen(modelId, { text: prompt, voice: nodeParams.voice }, userId);
      await job.updateProgress(60);
      resultUrl = result.audio_url;
    } else {
      // LLM 文本生成
      const content = await this.aiService.callLlm(modelId, [{ role: 'user', content: prompt }], userId);
      await job.updateProgress(60);
      const buffer = Buffer.from(content, 'utf-8');
      resultUrl = await this.uploadResultAndBuildUrl(buffer, userId, 'txt', 'text/plain');
    }

    await this.checkCancelled(job, task);
    await job.updateProgress(100);
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }

  /** C18: 检查任务是否被取消，若是则抛出异常终止执行 */
  private async checkCancelled(job: Job, task: RenderTask): Promise<void> {
    // BullMQ 5.x: discard() 仅本地标志（跨实例不可见），通过 getState() 检测任务被 remove() 后的状态
    const state = await job.getState();
    if (state === 'unknown') {
      task.status = 'cancelled';
      await this.taskRepo.save(task);
      throw new Error('任务已被取消');
    }
  }

  // ── 模拟渲染任务（C9: 按 subtype 透传上游资产）──
  private async executeRenderTask(task: RenderTask, job: Job, params: any) {
    const nodeParams = params?.nodeParams || {};
    const inputArtifacts = params?.inputArtifacts || [];

    // 查询节点 subtype（用于透传逻辑）
    let subtype: string | undefined;
    if (task.nodeId) {
      const node = await this.nodeRepo.findOne({ where: { id: task.nodeId } });
      subtype = node?.config?.subtype;
    }

    const subtypeExtMap: Record<string, string> = {
      image_output: '.png',
      video_output: '.mp4',
      audio_output: '.mp3',
      upscale: '.png',
      remove_bg: '.png',
      style_transfer: '.png',
      extend_image: '.png',
    };
    const ext = subtypeExtMap[subtype || ''] || '.mp4';

    // image_output / upscale 节点：透传上游图片 URL
    if (['image_output', 'upscale'].includes(subtype || '') && inputArtifacts.length > 0) {
      const imageArt = inputArtifacts.find((a: any) => a.type === 'image' && a.url);
      if (imageArt) {
        await job.updateProgress(50);
        task.resultUrl = imageArt.url;
        await this.taskRepo.save(task);
        await job.updateProgress(100);
        return;
      }
    }

    // audio_output 节点：透传上游音频 URL
    if (subtype === 'audio_output' && inputArtifacts.length > 0) {
      const audioArt = inputArtifacts.find((a: any) => a.type === 'audio' && a.url);
      if (audioArt) {
        await job.updateProgress(50);
        task.resultUrl = audioArt.url;
        await this.taskRepo.save(task);
        await job.updateProgress(100);
        return;
      }
    }

    // 其他节点：模拟渲染进度
    for (let i = 0; i <= 100; i += 20) {
      // C18: 每次循环检查是否被取消
      const state = await job.getState();
      if (state === 'unknown') {
        task.status = 'cancelled';
        await this.taskRepo.save(task);
        return;
      }
      task.progress = i;
      await this.taskRepo.save(task);
      await job.updateProgress(i);
      await new Promise(r => setTimeout(r, 500));
    }
    const resultUrl = await this.generateSimulatedResult(task.ownerId, ext.replace('.', ''));
    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
  }

  // ── 导出任务（C8: 完整 FFmpeg 合成）──
  private async executeExportTask(
    task: RenderTask,
    job: Job,
    params: { nodeParams?: any },
  ) {
    const exportParams = params.nodeParams || task.nodeParams || {};
    const timelineData = exportParams.timeline_data || {};
    const tracks = timelineData.tracks || [];
    const duration = timelineData.duration || 30;

    // 从 tracks 收集所有 clip
    const clips: Clip[] = [];
    for (const track of tracks) {
      if (track.visible === false) continue;
      for (const clip of (track.clips || [])) {
        if (clip.mediaUrl) {
          clips.push({
            url: clip.mediaUrl,
            start: clip.start || 0,
            end: clip.end || 5,
            track_type: track.type || 'video',
            media_type: clip.mediaType || 'video',
          });
        }
      }
    }

    if (clips.length === 0) {
      throw new Error('时间轴上没有素材');
    }

    await job.updateProgress(10);

    // 调用 ExportService 合成视频
    const localPath = await this.exportService.composeVideo(
      clips,
      exportParams.format || 'mp4',
      exportParams.resolution || '1080p',
      duration,
      task.id,
      exportParams.subtitles,
    );

    await job.updateProgress(90);

    // 上传 MinIO + 创建 MediaAsset
    const resultUrl = await this.exportService.uploadExportAndCreateAsset(
      localPath, task.id, task.ownerId, task.projectId,
    );

    task.resultUrl = resultUrl;
    await this.taskRepo.save(task);
    await job.updateProgress(100);
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

  private async generateSimulatedResult(userId: string, ext: string): Promise<string> {
    const buffer = Buffer.from(
      ext === 'mp4' ? 'simulated-video' : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      ext === 'mp4' ? 'utf-8' : 'base64',
    );
    const contentType = ext === 'mp4' ? 'video/mp4' : 'image/png';
    return this.uploadResultAndBuildUrl(buffer, userId, ext, contentType);
  }
}
