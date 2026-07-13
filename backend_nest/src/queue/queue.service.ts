// src/queue/queue.service.ts (占位，Task 15 完善实现)
import { Injectable } from '@nestjs/common';
import { IQueueService } from '../modules/render/render.service';

@Injectable()
export class QueueService implements IQueueService {
  async enqueueRenderTask(taskId: string, params: any): Promise<string> {
    // Task 15 实现: BullMQ queue.add
    throw new Error('QueueService 尚未实现，请完成 Task 15');
  }

  async cancelTask(jobId: string): Promise<void> {
    // Task 15 实现: BullMQ job.remove
  }
}
