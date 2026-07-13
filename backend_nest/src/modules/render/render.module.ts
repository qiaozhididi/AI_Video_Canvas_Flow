// src/modules/render/render.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenderTask } from './entities/render-task.entity';
import { RenderService } from './render.service';
import { RenderController } from './render.controller';
import { AuthModule } from '../../common/auth/auth.module';
import { QueueModule } from '../../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RenderTask]),
    AuthModule,
    forwardRef(() => QueueModule),  // 延迟引用，避免循环依赖
  ],
  providers: [RenderService],
  controllers: [RenderController],
  exports: [RenderService],
})
export class RenderModule {}
