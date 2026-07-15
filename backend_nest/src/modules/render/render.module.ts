// src/modules/render/render.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenderTask } from './entities/render-task.entity';
import { Project } from '../projects/entities/project.entity';
import { RenderService } from './render.service';
import { RenderController } from './render.controller';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RenderTask, Project]),
    AuthModule,
  ],
  providers: [RenderService],
  controllers: [RenderController],
  exports: [RenderService],
})
export class RenderModule {}
