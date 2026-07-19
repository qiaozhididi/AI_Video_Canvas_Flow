// src/modules/snapshots/snapshots.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { ProjectSnapshot } from './entities/project-snapshot.entity';
import { SnapshotCreateDto } from './dto/snapshot.dto';
import { WorkflowNode } from '../../modules/workflows/entities/workflow-node.entity';
import { WorkflowEdge } from '../../modules/workflows/entities/workflow-edge.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectAccessService } from '../../common/auth/project-access.service';

@Injectable()
export class SnapshotsService {
  constructor(
    @InjectRepository(ProjectSnapshot) private snapshotRepo: Repository<ProjectSnapshot>,
    private dataSource: DataSource,
    private projectAccess: ProjectAccessService,
    private config: ConfigService,
  ) {}

  async create(userId: string, projectId: string, dto: SnapshotCreateDto) {
    // C2: 校验编辑权限，防止为他人项目创建快照（IDOR）
    await this.projectAccess.verifyEditAccess(userId, projectId);

    // M16: 事务内执行 auto 源 5 条上限检查 + 删除 + 插入，并用 advisory lock 防 TOCTOU race
    // （原实现 count + delete + save 在事务外，并发可都看到 count=5 都删同一条最旧都插入，最终 6+ 条违反约束）
    const snapshot = await this.dataSource.transaction(async (manager) => {
      // pg_advisory_xact_lock 基于 projectId 哈希序列化同一项目的并发快照创建
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [projectId]);

      // I-26+M15: auto 源受上限保护（默认 5 条），只删 1 条最旧的（对齐 Python snapshots.py:91-97）
      if (dto.source === 'auto') {
        const autoMaxCount = this.config.get<number>('limits.snapshot.autoMaxCount')!;
        const autoCount = await manager.count(ProjectSnapshot, { where: { projectId, source: 'auto' } });
        if (autoCount >= autoMaxCount) {
          const oldest = await manager.findOne(ProjectSnapshot, {
            where: { projectId, source: 'auto' },
            order: { createdAt: 'ASC' },
          });
          if (oldest) {
            await manager.delete(ProjectSnapshot, { id: oldest.id });
          }
        }
      }

      const snap = manager.create(ProjectSnapshot, {
        id: uuidv4(),
        projectId,
        ownerId: userId,
        source: dto.source,
        label: dto.label || undefined,
        name: dto.name || undefined,
        snapshotData: dto.snapshot_data,
      });
      await manager.save(snap);
      return snap;
    });

    return this.toResponse(snapshot);
  }

  async list(userId: string, projectId: string, source?: string) {
    // C2: 校验访问权限（owner/editor/viewer 均可查看快照）
    await this.projectAccess.verifyAccess(userId, projectId);
    const where: any = { projectId };
    if (source) where.source = source;
    // C9: 列表接口排除 snapshot_data 大 jsonb 字段，节省带宽和内存（单条接口仍返回完整数据）
    const snapshots = await this.snapshotRepo.find({
      where,
      order: { createdAt: 'DESC' },
      select: ['id', 'projectId', 'ownerId', 'source', 'label', 'name', 'createdAt'],
    });
    return snapshots.map(s => this.toListResponse(s));
  }

  async getLatest(userId: string, projectId: string) {
    await this.projectAccess.verifyAccess(userId, projectId);
    const snapshot = await this.snapshotRepo.findOne({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    if (!snapshot) throw new NotFoundException('无快照');
    return this.toResponse(snapshot);
  }

  async get(userId: string, snapshotId: string) {
    // C2: 先查快照拿到 projectId，再校验访问权限（防 IDOR）
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId } });
    if (!snapshot) throw new NotFoundException('快照不存在');
    await this.projectAccess.verifyAccess(userId, snapshot.projectId);
    return this.toResponse(snapshot);
  }

  async delete(userId: string, snapshotId: string) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId } });
    if (!snapshot) throw new NotFoundException('快照不存在');
    await this.projectAccess.verifyEditAccess(userId, snapshot.projectId);
    await this.snapshotRepo.delete({ id: snapshotId });
  }

  async restore(userId: string, snapshotId: string) {
    // C2: 校验编辑权限，防止通过自建快照篡改他人项目 workflow（IDOR）
    const snapshot = await this.snapshotRepo.findOne({ where: { id: snapshotId } });
    if (!snapshot) throw new NotFoundException('快照不存在');
    await this.projectAccess.verifyEditAccess(userId, snapshot.projectId);

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

  // C9: 列表响应不含 snapshot_data（大 jsonb 字段），单条接口用 toResponse 返回完整数据
  private toListResponse(s: ProjectSnapshot) {
    return {
      id: s.id,
      project_id: s.projectId,
      owner_id: s.ownerId,
      source: s.source,
      label: s.label,
      name: s.name,
      created_at: s.createdAt?.toISOString(),
    };
  }
}
