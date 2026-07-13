// src/modules/snapshots/snapshots.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectSnapshot } from './entities/project-snapshot.entity';
import { WorkflowNode } from '../workflows/entities/workflow-node.entity';
import { WorkflowEdge } from '../workflows/entities/workflow-edge.entity';
import { SnapshotsService } from './snapshots.service';
import { SnapshotsController } from './snapshots.controller';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectSnapshot, WorkflowNode, WorkflowEdge]), AuthModule],
  providers: [SnapshotsService],
  controllers: [SnapshotsController],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
