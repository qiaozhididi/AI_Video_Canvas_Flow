// src/modules/snapshots/snapshots.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ProjectSnapshot } from './entities/project-snapshot.entity';
import { SnapshotCreateDto } from './dto/snapshot.dto';
import { WorkflowNode } from '../../modules/workflows/entities/workflow-node.entity';
import { WorkflowEdge } from '../../modules/workflows/entities/workflow-edge.entity';
import { Project } from '../projects/entities/project.entity';

@Injectable()
export class SnapshotsService {
  constructor(
    @InjectRepository(ProjectSnapshot) private snapshotRepo: Repository<ProjectSnapshot>,
    private dataSource: DataSource,
  ) {}

  async create(userId: string, projectId: string, dto: SnapshotCreateDto) {
    // auto 源受 5 条上限
    if (dto.source === 'auto') {
      const autoCount = await this.snapshotRepo.count({ where: { projectId, source: 'auto' } });
      if (autoCount >= 5) {
        // 删除最旧的 auto 快照
        const oldest = await this.snapshotRepo.find({
          where: { projectId, source: 'auto' },
          order: { createdAt: 'ASC' },
          take: autoCount - 4,
        });
        for (const s of oldest) {
          await this.snapshotRepo.delete({ id: s.id });
        }
      }
    }

    const snapshot = this.snapshotRepo.create({
      id: uuidv4(),
      projectId,
      ownerId: userId,
      source: dto.source,
      label: dto.label || undefined,
      name: dto.name || undefined,
      snapshotData: dto.snapshot_data,
    });
    await this.snapshotRepo.save(snapshot);
    return this.toResponse(snapshot);
  }

  async list(userId: string, projectId: string, source?: string) {
    const where: any = { projectId, ownerId: userId };
    if (source) where.source = source;
    const snapshots = await this.snapshotRepo.find({ where, order: { createdAt: 'DESC' } });
    return snapshots.map(s => this.toResponse(s));
  }

  async getLatest(userId: string, projectId: string) {
    const snapshot = await this.snapshotRepo.findOne({
      where: { projectId, ownerId: userId },
      order: { createdAt: 'DESC' },
    });
    if (!snapshot) throw new NotFoundException('无快照');
    return this.toResponse(snapshot);
  }

  async get(userId: string, snapshotId: string) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId, ownerId: userId } });
    if (!snapshot) throw new NotFoundException('快照不存在');
    return this.toResponse(snapshot);
  }

  async delete(userId: string, snapshotId: string) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId, ownerId: userId } });
    if (!snapshot) throw new NotFoundException('快照不存在');
    await this.snapshotRepo.delete({ id: snapshotId });
  }

  async restore(userId: string, snapshotId: string) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId, ownerId: userId } });
    if (!snapshot) throw new NotFoundException('快照不存在');

    const data = snapshot.snapshotData;
    const nodes = data.nodes || [];
    const edges = data.edges || [];

    // 单事务恢复: 删除现有 nodes/edges + 插入快照数据
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(WorkflowEdge, { projectId: snapshot.projectId });
      await manager.delete(WorkflowNode, { projectId: snapshot.projectId });

      if (nodes.length > 0) {
        const nodeEntities = nodes.map((n: any) => ({
          id: n.id,
          projectId: snapshot.projectId,
          nodeType: n.node_type || n.nodeType,
          label: n.label,
          positionX: n.position_x || n.positionX,
          positionY: n.position_y || n.positionY,
          config: n.config,
        }));
        await manager.insert(WorkflowNode, nodeEntities);
      }

      if (edges.length > 0) {
        const edgeEntities = edges.map((e: any) => ({
          id: e.id,
          projectId: snapshot.projectId,
          sourceNodeId: e.source_node_id || e.sourceNodeId,
          targetNodeId: e.target_node_id || e.targetNodeId,
          sourcePort: e.source_port || e.sourcePort || undefined,
          targetPort: e.target_port || e.targetPort || undefined,
        }));
        await manager.insert(WorkflowEdge, edgeEntities);
      }

      // I-20: 刷新 project.updated_at（对齐 Python snapshots.py:264-270）
      await manager.update(Project, { id: snapshot.projectId }, { updatedAt: new Date() });
    });

    return {
      restored: true,
      project_id: snapshot.projectId,
      nodes_count: nodes.length,
      edges_count: edges.length,
    };
  }

  private toResponse(s: ProjectSnapshot) {
    return {
      id: s.id,
      project_id: s.projectId,
      owner_id: s.ownerId,
      source: s.source,
      label: s.label,
      name: s.name,
      snapshot_data: s.snapshotData,
      created_at: s.createdAt?.toISOString(),
    };
  }
}
