// src/queue/queue.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IQueueService } from '../modules/render/render.service';

@Injectable()
export class QueueService implements IQueueService {
  constructor(@InjectQueue('render-tasks') private renderQueue: Queue) {}

  async enqueueRenderTask(taskId: string, params: any): Promise<string> {
    const job = await this.renderQueue.add('render', { taskId, params });
    return job.id!;
  }

  async cancelTask(jobId: string): Promise<void> {
    // C18: discard() 防止重试，processor 内通过 isDiscarded() 主动退出
    // （对齐 Python revoke(terminate=True) 的"终止运行中任务"语义）
    const job = await this.renderQueue.getJob(jobId);
    if (job) {
      await job.discard();
      await job.remove();
    }
  }
}
