// src/modules/templates/templates.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/entities/project.entity';
import { WorkflowNode } from '../workflows/entities/workflow-node.entity';
import { WorkflowEdge } from '../workflows/entities/workflow-edge.entity';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Project, WorkflowNode, WorkflowEdge]), AuthModule],
  providers: [TemplatesService],
  controllers: [TemplatesController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
