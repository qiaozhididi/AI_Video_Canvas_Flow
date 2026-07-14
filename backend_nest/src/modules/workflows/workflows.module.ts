// src/modules/workflows/workflows.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowNode } from './entities/workflow-node.entity';
import { WorkflowEdge } from './entities/workflow-edge.entity';
import { Project } from '../projects/entities/project.entity';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([WorkflowNode, WorkflowEdge, Project]), AuthModule],
  providers: [WorkflowsService],
  controllers: [WorkflowsController],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
