// src/modules/workflows/workflows.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WorkflowNode } from './entities/workflow-node.entity';
import { WorkflowEdge } from './entities/workflow-edge.entity';
import { Project } from '../projects/entities/project.entity';
import { NodeCreateDto, EdgeCreateDto, WorkflowSaveDto } from './dto/workflow.dto';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(WorkflowNode) private nodeRepo: Repository<WorkflowNode>,
    @InjectRepository(WorkflowEdge) private edgeRepo: Repository<WorkflowEdge>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private dataSource: DataSource,
  ) {}

  private async verifyProjectOwner(projectId: string, userId: string): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project || project.ownerId !== userId) throw new NotFoundException('项目不存在');
  }

  async listNodes(projectId: string, userId: string) {
    await this.verifyProjectOwner(projectId, userId);
    const nodes = await this.nodeRepo.find({ where: { projectId } });
    return nodes.map(n => ({
      id: n.id,
      project_id: n.projectId,
      node_type: n.nodeType,
      label: n.label,
      position_x: n.positionX,
      position_y: n.positionY,
      config: n.config,
      created_at: n.createdAt?.toISOString(),
      updated_at: n.updatedAt?.toISOString(),
    }));
  }

  async createNode(projectId: string, userId: string, dto: NodeCreateDto) {
    await this.verifyProjectOwner(projectId, userId);
    const node = this.nodeRepo.create({
      id: dto.id,
      projectId,
      nodeType: dto.node_type,
      label: dto.label,
      positionX: dto.position_x,
      positionY: dto.position_y,
      config: dto.config,
    });
    await this.nodeRepo.save(node);
    // 重新查询以获取 created_at/updated_at（@CreateDateColumn 在 save 后可能未填充）
    const saved = await this.nodeRepo.findOne({ where: { id: dto.id } });
    return this.nodeToResponse(saved || node);
  }

  async deleteNode(projectId: string, userId: string, nodeId: string) {
    await this.verifyProjectOwner(projectId, userId);
    // C14: 先删关联边，再删节点（避免 FK 违约，对齐 Python workflows.py:119-128）
    await this.edgeRepo.delete([
      { sourceNodeId: nodeId, projectId },
      { targetNodeId: nodeId, projectId },
    ]);
    const result = await this.nodeRepo.delete({ id: nodeId, projectId });
    if (result.affected === 0) throw new NotFoundException('节点不存在');
  }

  async listEdges(projectId: string, userId: string) {
    await this.verifyProjectOwner(projectId, userId);
    const edges = await this.edgeRepo.find({ where: { projectId } });
    return edges.map(e => ({
      id: e.id,
      project_id: e.projectId,
      source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId,
      source_port: e.sourcePort,
      target_port: e.targetPort,
      created_at: e.createdAt?.toISOString(),
      updated_at: e.updatedAt?.toISOString(),
    }));
  }

  async createEdge(projectId: string, userId: string, dto: EdgeCreateDto) {
    await this.verifyProjectOwner(projectId, userId);
    const edge = this.edgeRepo.create({
      id: dto.id,
      projectId,
      sourceNodeId: dto.source_node_id,
      targetNodeId: dto.target_node_id,
      sourcePort: dto.source_port,
      targetPort: dto.target_port,
    });
    await this.edgeRepo.save(edge);
    const saved = await this.edgeRepo.findOne({ where: { id: dto.id } });
    return this.edgeToResponse(saved || edge);
  }

  async deleteEdge(projectId: string, userId: string, edgeId: string) {
    await this.verifyProjectOwner(projectId, userId);
    const result = await this.edgeRepo.delete({ id: edgeId, projectId });
    if (result.affected === 0) throw new NotFoundException('边不存在');
  }

  async saveWorkflow(projectId: string, userId: string, dto: WorkflowSaveDto) {
    await this.verifyProjectOwner(projectId, userId);
    // 事务: 先删后插，先 flush 节点再插边 (避免外键约束冲突)
    await this.dataSource.transaction(async (manager) => {
      // 1. 删除现有 nodes + edges
      await manager.delete(WorkflowEdge, { projectId });
      await manager.delete(WorkflowNode, { projectId });

      // 2. 插入新 nodes (flush)
      if (dto.nodes.length > 0) {
        const nodes = dto.nodes.map(n => ({
          id: n.id,
          projectId,
          nodeType: n.node_type,
          label: n.label,
          positionX: n.position_x,
          positionY: n.position_y,
          config: n.config,
        }));
        await manager.insert(WorkflowNode, nodes);
      }

      // 3. 插入新 edges
      if (dto.edges.length > 0) {
        const edges = dto.edges.map(e => ({
          id: e.id,
          projectId,
          sourceNodeId: e.source_node_id,
          targetNodeId: e.target_node_id,
          sourcePort: e.source_port || undefined,
          targetPort: e.target_port || undefined,
        }));
        await manager.insert(WorkflowEdge, edges);
      }
    });

    return { nodes_count: dto.nodes.length, edges_count: dto.edges.length };
  }

  private nodeToResponse(n: WorkflowNode) {
    return {
      id: n.id, project_id: n.projectId, node_type: n.nodeType, label: n.label,
      position_x: n.positionX, position_y: n.positionY, config: n.config,
      created_at: n.createdAt?.toISOString(),
      updated_at: n.updatedAt?.toISOString(),
    };
  }

  private edgeToResponse(e: WorkflowEdge) {
    return {
      id: e.id, project_id: e.projectId, source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId, source_port: e.sourcePort, target_port: e.targetPort,
      created_at: e.createdAt?.toISOString(),
      updated_at: e.updatedAt?.toISOString(),
    };
  }
}
