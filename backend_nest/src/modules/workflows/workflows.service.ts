// src/modules/workflows/workflows.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WorkflowNode } from './entities/workflow-node.entity';
import { WorkflowEdge } from './entities/workflow-edge.entity';
import { NodeCreateDto, EdgeCreateDto, WorkflowSaveDto } from './dto/workflow.dto';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(WorkflowNode) private nodeRepo: Repository<WorkflowNode>,
    @InjectRepository(WorkflowEdge) private edgeRepo: Repository<WorkflowEdge>,
    private dataSource: DataSource,
  ) {}

  async listNodes(projectId: string) {
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

  async createNode(projectId: string, dto: NodeCreateDto) {
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
    return this.nodeToResponse(node);
  }

  async deleteNode(projectId: string, nodeId: string) {
    const result = await this.nodeRepo.delete({ id: nodeId, projectId });
    if (result.affected === 0) throw new NotFoundException('节点不存在');
    // 同时删除关联的边
    await this.edgeRepo.delete({ sourceNodeId: nodeId });
    await this.edgeRepo.delete({ targetNodeId: nodeId });
  }

  async listEdges(projectId: string) {
    const edges = await this.edgeRepo.find({ where: { projectId } });
    return edges.map(e => ({
      id: e.id,
      project_id: e.projectId,
      source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId,
      source_port: e.sourcePort,
      target_port: e.targetPort,
    }));
  }

  async createEdge(projectId: string, dto: EdgeCreateDto) {
    const edge = this.edgeRepo.create({
      id: dto.id,
      projectId,
      sourceNodeId: dto.source_node_id,
      targetNodeId: dto.target_node_id,
      sourcePort: dto.source_port,
      targetPort: dto.target_port,
    });
    await this.edgeRepo.save(edge);
    return this.edgeToResponse(edge);
  }

  async deleteEdge(projectId: string, edgeId: string) {
    const result = await this.edgeRepo.delete({ id: edgeId, projectId });
    if (result.affected === 0) throw new NotFoundException('边不存在');
  }

  async saveWorkflow(projectId: string, dto: WorkflowSaveDto) {
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

    return { detail: '已保存' };
  }

  private nodeToResponse(n: WorkflowNode) {
    return {
      id: n.id, project_id: n.projectId, node_type: n.nodeType, label: n.label,
      position_x: n.positionX, position_y: n.positionY, config: n.config,
    };
  }

  private edgeToResponse(e: WorkflowEdge) {
    return {
      id: e.id, project_id: e.projectId, source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId, source_port: e.sourcePort, target_port: e.targetPort,
    };
  }
}
