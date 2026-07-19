// src/modules/projects/projects.service.ts
import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Project } from './entities/project.entity';
import { ProjectCreateDto, ProjectUpdateDto } from './dto/project.dto';
import { MinioService } from '../../common/utils/minio.service';
import { ProjectAccessService } from '../../common/auth/project-access.service';
import { validateImageSignature } from '../../common/utils/file-signature.util';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private minioService: MinioService,
    private dataSource: DataSource,
    private projectAccess: ProjectAccessService,
  ) {}

  async list(userId: string, limit = 50, offset = 0) {
    // I-21: 移除 isTemplate: false 过滤（对齐 Python projects.py 不过滤）
    // C8: 列表加分页（take/skip），limit 上限由 controller 的 clampLimit 保证
    const projects = await this.projectRepo.find({
      where: { ownerId: userId },
      order: { updatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    // 批量查询 node_count
    const projectIds = projects.map(p => p.id);
    let nodeCounts: Record<string, number> = {};
    if (projectIds.length > 0) {
      const rows = await this.dataSource.query(
        `SELECT project_id, COUNT(*) as cnt FROM workflow_nodes WHERE project_id = ANY($1::uuid[]) GROUP BY project_id`,
        [projectIds],
      );
      nodeCounts = rows.reduce((acc, r) => ({ ...acc, [r.project_id]: Number(r.cnt) }), {});
    }
    return projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      cover_url: p.coverUrl,
      owner_id: p.ownerId,
      created_at: p.createdAt?.toISOString(),
      updated_at: p.updatedAt?.toISOString(),
      node_count: nodeCounts[p.id] || 0,
    }));
  }

  async create(userId: string, dto: ProjectCreateDto) {
    const project = this.projectRepo.create({
      id: uuidv4(),
      name: dto.name,
      description: dto.description || '',
      ownerId: userId,
      isTemplate: false,
    });
    await this.projectRepo.save(project);
    return this.toResponse(project, 0);
  }

  async get(userId: string, projectId: string) {
    // I-1: 协作者权限校验（owner/editor/viewer 均可读，对齐硬约束）
    await this.projectAccess.verifyAccess(userId, projectId);
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    // verifyAccess 已校验项目存在性，此处 findOne 仅为取数据；防御性判断
    if (!project) throw new NotFoundException('项目不存在');

    const nodeCountRow = await this.dataSource.query(
      `SELECT COUNT(*) as cnt FROM workflow_nodes WHERE project_id = $1`,
      [projectId],
    );
    const nodeCount = Number(nodeCountRow[0]?.cnt || 0);
    return this.toResponse(project, nodeCount);
  }

  async update(userId: string, projectId: string, dto: ProjectUpdateDto) {
    // I-1: 协作者编辑权限校验（owner/editor 可改，对齐硬约束）
    await this.projectAccess.verifyEditAccess(userId, projectId);
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.cover_url !== undefined) project.coverUrl = dto.cover_url;

    await this.projectRepo.save(project);
    return this.toResponse(project);
  }

  async delete(userId: string, projectId: string) {
    // I-1: 删除是危险操作，仅 owner 可执行（对齐硬约束）
    await this.projectAccess.verifyOwner(userId, projectId);

    // 事务级联删除: edges → nodes → snapshots → render_tasks → media_assets → project
    await this.dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM workflow_edges WHERE project_id = $1', [projectId]);
      await manager.query('DELETE FROM workflow_nodes WHERE project_id = $1', [projectId]);
      await manager.query('DELETE FROM project_snapshots WHERE project_id = $1', [projectId]);
      await manager.query('DELETE FROM render_tasks WHERE project_id = $1', [projectId]);
      await manager.query('DELETE FROM media_assets WHERE project_id = $1', [projectId]);
      await manager.query('DELETE FROM projects WHERE id = $1', [projectId]);
    });
  }

  async uploadCover(userId: string, projectId: string, file: Express.Multer.File) {
    // I-1: 封面上传需要编辑权限（owner/editor 可改，对齐硬约束）
    await this.projectAccess.verifyEditAccess(userId, projectId);
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    // I-22: 文件类型与大小校验（对齐 Python projects.py:158-169）
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('封面必须是图片格式(png/jpeg/webp/gif)');
    }
    const maxSize = 5 * 1024 * 1024;  // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException('封面图片大小不能超过 5MB');
    }
    // M9: magic number 校验（mimetype 由客户端 Content-Type 提供，可任意伪造；
    // 攻击者可上传 .php 改名 .png + 伪造 Content-Type: image/png 的 webshell）
    if (!validateImageSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('文件内容与声明类型不符（图片 magic number 校验失败）');
    }

    // 封面上传到 MinIO covers/{pid}.png (覆盖旧文件)
    const objectName = `covers/${projectId}.png`;
    await this.minioService.uploadFile(objectName, file.buffer, file.mimetype || 'image/png');

    // 更新 cover_url (使用相对路径，前端通过 /api/v1/projects/{id}/cover/download 访问)
    project.coverUrl = `/api/v1/projects/${projectId}/cover/download`;
    await this.projectRepo.save(project);

    return { cover_url: project.coverUrl };
  }

  async downloadCover(userId: string, projectId: string) {
    // C4: 封面下载必须鉴权（owner/editor/viewer 均可查看，匿名 401）
    if (!userId) throw new UnauthorizedException('请先登录');
    await this.projectAccess.verifyAccess(userId, projectId);

    const objectName = `covers/${projectId}.png`;
    // M4: 文件不存在返回 404（原直接 downloadObject 抛 S3Error 被 filter 转 500，前端无法区分无封面与服务器错误）
    const exists = await this.minioService.statObject(objectName);
    if (!exists) throw new NotFoundException('封面不存在');
    const buffer = await this.minioService.downloadObject(objectName);
    return { buffer, contentType: 'image/png' };
  }

  private toResponse(project: Project, nodeCount?: number) {
    const resp: any = {
      id: project.id,
      name: project.name,
      description: project.description,
      cover_url: project.coverUrl,
      owner_id: project.ownerId,
      created_at: project.createdAt?.toISOString(),
      updated_at: project.updatedAt?.toISOString(),
    };
    if (nodeCount !== undefined) resp.node_count = nodeCount;
    return resp;
  }
}
