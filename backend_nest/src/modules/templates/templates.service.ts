// src/modules/templates/templates.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Project } from '../projects/entities/project.entity';
import { WorkflowNode } from '../workflows/entities/workflow-node.entity';
import { WorkflowEdge } from '../workflows/entities/workflow-edge.entity';
import { TemplatePublishDto } from './dto/template.dto';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private dataSource: DataSource,
  ) {}

  async list(q?: string, category?: string) {
    const qb = this.projectRepo
      .createQueryBuilder('p')
      .where('p.is_template = true');
    if (q) {
      qb.andWhere('(p.name ILIKE :q OR p.template_tags::text ILIKE :q)', { q: `%${q}%` });
    }
    if (category) {
      qb.andWhere('p.template_category = :category', { category });
    }
    qb.orderBy('p.created_at', 'DESC');
    const templates = await qb.getMany();
    return templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      cover_url: t.coverUrl,
      owner_id: t.ownerId,
      is_template: true,
      template_category: t.templateCategory,
      template_tags: t.templateTags,
      created_at: t.createdAt?.toISOString(),
      updated_at: t.updatedAt?.toISOString(),
    }));
  }

  async clone(userId: string, templateId: string) {
    const template = await this.projectRepo.findOne({ where: { id: templateId, isTemplate: true } });
    if (!template) throw new NotFoundException('模板不存在');

    // 克隆为新项目 (复制 nodes/edges，ID 加前缀)
    const newProjectId = uuidv4();
    const newProject = this.projectRepo.create({
      id: newProjectId,
      name: `${template.name} (副本)`,
      description: template.description,
      coverUrl: template.coverUrl,
      ownerId: userId,
      isTemplate: false,
    });
    await this.projectRepo.save(newProject);

    // 复制 nodes/edges (ID 加前缀避免冲突)
    const [nodes, edges] = await Promise.all([
      this.dataSource.query('SELECT * FROM workflow_nodes WHERE project_id = $1', [templateId]),
      this.dataSource.query('SELECT * FROM workflow_edges WHERE project_id = $1', [templateId]),
    ]);

    if (nodes.length > 0) {
      const nodeRows = nodes.map((n: any) => ({
        id: `clone-${newProjectId}-${n.id}`,
        projectId: newProjectId,
        nodeType: n.node_type,
        label: n.label,
        positionX: n.position_x,
        positionY: n.position_y,
        config: typeof n.config === 'string' ? JSON.parse(n.config) : n.config,
      }));
      await this.dataSource.createQueryBuilder().insert().into(WorkflowNode).values(nodeRows).execute();
    }

    if (edges.length > 0) {
      const idMap = new Map(nodes.map((n: any) => [n.id, `clone-${newProjectId}-${n.id}`]));
      const edgeRows = edges.map((e: any) => ({
        id: `clone-${newProjectId}-${e.id}`,
        projectId: newProjectId,
        sourceNodeId: idMap.get(e.source_node_id) || e.source_node_id,
        targetNodeId: idMap.get(e.target_node_id) || e.target_node_id,
        sourcePort: e.source_port,
        targetPort: e.target_port,
      }));
      await this.dataSource.createQueryBuilder().insert().into(WorkflowEdge).values(edgeRows).execute();
    }

    return {
      id: newProjectId,
      name: newProject.name,
      description: newProject.description,
      cover_url: newProject.coverUrl,
      owner_id: newProject.ownerId,
      created_at: newProject.createdAt?.toISOString(),
      updated_at: newProject.updatedAt?.toISOString(),
    };
  }

  async publish(userId: string, projectId: string, dto: TemplatePublishDto) {
    const project = await this.projectRepo.findOne({ where: { id: projectId, ownerId: userId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.isTemplate) throw new ConflictException('该项目已是模板');

    project.isTemplate = true;
    project.templateCategory = dto.category;
    project.templateTags = dto.tags || [];
    await this.projectRepo.save(project);

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      cover_url: project.coverUrl,
      owner_id: project.ownerId,
      is_template: true,
      template_category: project.templateCategory,
      template_tags: project.templateTags,
      created_at: project.createdAt?.toISOString(),
      updated_at: project.updatedAt?.toISOString(),
    };
  }

  async unpublish(userId: string, templateId: string) {
    const project = await this.projectRepo.findOne({ where: { id: templateId, ownerId: userId, isTemplate: true } });
    if (!project) throw new NotFoundException('模板不存在');

    project.isTemplate = false;
    project.templateCategory = null as any;
    project.templateTags = null;
    await this.projectRepo.save(project);
    // 不返回 body，配合 @HttpCode(204)
    return;
  }
}
