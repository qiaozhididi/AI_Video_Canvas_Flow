// src/queue/queue.module.ts (占位，Task 15 完善实现)
import { Module, Global } from '@nestjs/common';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
