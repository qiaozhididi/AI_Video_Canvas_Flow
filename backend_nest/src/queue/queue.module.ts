// src/queue/queue.module.ts
import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueService } from './queue.service';
import { RenderProcessor } from './render.processor';
import { ExportService } from './export.service';
import { RenderTask } from '../modules/render/entities/render-task.entity';
import { MediaAsset } from '../modules/media/entities/media-asset.entity';
import { WorkflowNode } from '../modules/workflows/entities/workflow-node.entity';
import { AiModule } from '../modules/ai/ai.module';
import { AuthModule } from '../common/auth/auth.module';  // 提供 MinioService

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('redis.url') },
        defaultJobOptions: {
          // I-29: 不重试（对齐 Python Celery 默认不重试），同时解决 I-30 status 跳变
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
    }),
    BullModule.registerQueue({ name: 'render-tasks' }),
    TypeOrmModule.forFeature([RenderTask, MediaAsset, WorkflowNode]),
    AuthModule,
    AiModule,
  ],
  providers: [QueueService, RenderProcessor, ExportService],
  exports: [QueueService, ExportService],
})
export class QueueModule {}
