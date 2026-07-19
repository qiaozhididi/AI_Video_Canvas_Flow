// src/common/auth/project-access.service.ts
// 统一项目访问权限校验（owner / editor / viewer 三级），解决 IDOR 漏洞
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../modules/projects/entities/project.entity';
import { ProjectCollaborator } from '../../modules/invitations/entities/project-collaborator.entity';

export type ProjectRole = 'viewer' | 'editor' | 'owner';

@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(ProjectCollaborator) private collaboratorRepo: Repository<ProjectCollaborator>,
  ) {}

  /**
   * 校验访问权限（owner 或任意协作者 viewer/editor）。
   * 项目不存在抛 404，无权访问抛 403。
   */
  async verifyAccess(userId: string, projectId: string): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.ownerId === userId) return;
    const collab = await this.collaboratorRepo.findOne({ where: { projectId, userId } });
    if (!collab) throw new ForbiddenException('无权访问该项目');
  }

  /**
   * 校验编辑权限（owner 或 editor）。
   */
  async verifyEditAccess(userId: string, projectId: string): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.ownerId === userId) return;
    const collab = await this.collaboratorRepo.findOne({ where: { projectId, userId } });
    if (!collab || collab.role !== 'editor') {
      throw new ForbiddenException('需要编辑权限');
    }
  }

  /**
   * 校验所有者权限（仅 owner）。
   */
  async verifyOwner(userId: string, projectId: string): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.ownerId !== userId) throw new ForbiddenException('仅项目所有者可操作');
  }

  /**
   * 检查权限（不抛异常，返回角色信息）。供 WebSocket 等场景使用。
   */
  async checkAccess(
    userId: string, projectId: string,
  ): Promise<{ canView: boolean; canEdit: boolean; isOwner: boolean }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return { canView: false, canEdit: false, isOwner: false };
    if (project.ownerId === userId) return { canView: true, canEdit: true, isOwner: true };
    const collab = await this.collaboratorRepo.findOne({ where: { projectId, userId } });
    if (!collab) return { canView: false, canEdit: false, isOwner: false };
    return { canView: true, canEdit: collab.role === 'editor', isOwner: false };
  }
}
