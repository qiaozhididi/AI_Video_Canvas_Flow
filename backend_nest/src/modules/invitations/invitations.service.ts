import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, HttpException, HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ProjectInvitation } from './entities/project-invitation.entity';
import { ProjectCollaborator } from './entities/project-collaborator.entity';
import { Project } from '../projects/entities/project.entity';
import { User } from '../auth/entities/user.entity';
import { CreateInvitationDto } from './dto/invitation.dto';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(ProjectInvitation) private invitationRepo: Repository<ProjectInvitation>,
    @InjectRepository(ProjectCollaborator) private collaboratorRepo: Repository<ProjectCollaborator>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private dataSource: DataSource,
  ) {}

  // I-27: 校验 role 合法性（对齐 project_memory: 3 permission levels）
  private validateRole(role: string): void {
    const validRoles = ['editor', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException('角色必须是 editor 或 viewer');
    }
  }

  // 创建邀请（owner only）
  async createInvitation(userId: string, projectId: string, dto: CreateInvitationDto): Promise<{
    id: string; token: string; role: string; expires_at: string | null;
  }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project || project.ownerId !== userId) {
      throw new ForbiddenException('仅项目所有者可生成邀请链接');
    }

    this.validateRole(dto.role);

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = dto.expires_in_hours
      ? new Date(Date.now() + dto.expires_in_hours * 3600 * 1000)
      : null;

    const invitation = this.invitationRepo.create({
      id: uuidv4(),
      projectId,
      token,
      role: dto.role,
      expiresAt,
      createdBy: userId,
      usedBy: null,
    });
    await this.invitationRepo.save(invitation);

    return {
      id: invitation.id,
      token: invitation.token,
      role: invitation.role,
      expires_at: invitation.expiresAt ? invitation.expiresAt.toISOString() : null,
    };
  }

  // 查看邀请信息（无需登录，供前端 AcceptInvite 页面在登录前调用）
  async getInvitation(token: string): Promise<{
    id: string; project_id: string; project_name: string; role: string;
    created_by_username: string; expires_at: string | null; is_valid: boolean;
  }> {
    const invitation = await this.invitationRepo.findOne({ where: { token } });
    if (!invitation) throw new NotFoundException('邀请不存在');

    const isValid =
      invitation.usedBy === null &&
      (invitation.expiresAt === null || invitation.expiresAt > new Date());

    const project = await this.projectRepo.findOne({ where: { id: invitation.projectId } });
    const creator = await this.userRepo.findOne({ where: { id: invitation.createdBy } });

    return {
      id: invitation.id,
      project_id: invitation.projectId,
      project_name: project ? project.name : '未知项目',
      role: invitation.role,
      created_by_username: creator ? creator.username : '未知用户',
      expires_at: invitation.expiresAt ? invitation.expiresAt.toISOString() : null,
      is_valid: isValid,
    };
  }

  // 接受邀请（登录用户）
  async acceptInvitation(token: string, userId: string): Promise<{
    project_id: string; project_name: string; role: string;
  }> {
    const invitation = await this.invitationRepo.findOne({ where: { token } });
    if (!invitation) throw new NotFoundException('邀请不存在');

    if (invitation.usedBy) {
      throw new HttpException('邀请已被使用', HttpStatus.GONE);
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new HttpException('邀请已过期', HttpStatus.GONE);
    }

    const project = await this.projectRepo.findOne({ where: { id: invitation.projectId } });
    if (project && project.ownerId === userId) {
      throw new ConflictException('不能接受自己项目的邀请');
    }

    const existing = await this.collaboratorRepo.findOne({
      where: { projectId: invitation.projectId, userId },
    });
    if (existing) throw new ConflictException('已是项目协作者');

    // B4: 协作者上限检查（硬约束：3 权限级 + 10 用户上限，owner 不在 collaborator 表内）
    const collaboratorCount = await this.collaboratorRepo.count({
      where: { projectId: invitation.projectId },
    });
    if (collaboratorCount >= 10) {
      throw new ConflictException('项目协作者已达上限（10 人）');
    }

    await this.dataSource.transaction(async (manager) => {
      const collab = manager.create(ProjectCollaborator, {
        id: uuidv4(),
        projectId: invitation.projectId,
        userId,
        role: invitation.role,
      });
      await manager.save(collab);

      invitation.usedBy = userId;
      await manager.save(invitation);
    });

    return {
      project_id: invitation.projectId,
      project_name: project ? project.name : '未知项目',
      role: invitation.role,
    };
  }

  // 列出协作者（owner 或协作者可查看）
  async listCollaborators(userId: string, projectId: string): Promise<Array<{
    id: string; project_id: string; user_id: string; username: string;
    role: string; joined_at: string;
  }>> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');

    const isOwner = project.ownerId === userId;
    if (!isOwner) {
      const collab = await this.collaboratorRepo.findOne({
        where: { projectId, userId },
      });
      if (!collab) throw new ForbiddenException('无权查看');
    }

    const collaborators = await this.collaboratorRepo.find({ where: { projectId } });
    const userIds = Array.from(new Set([project.ownerId, ...collaborators.map((c) => c.userId)]));
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const result: Array<{
      id: string; project_id: string; user_id: string; username: string;
      role: string; joined_at: string;
    }> = [];

    result.push({
      id: 'owner',
      project_id: projectId,
      user_id: project.ownerId,
      username: userMap.get(project.ownerId) ?? 'unknown',
      role: 'owner',
      joined_at: project.createdAt ? project.createdAt.toISOString() : new Date().toISOString(),
    });

    for (const c of collaborators) {
      result.push({
        id: c.id,
        project_id: projectId,
        user_id: c.userId,
        username: userMap.get(c.userId) ?? 'unknown',
        role: c.role,
        joined_at: c.joinedAt ? c.joinedAt.toISOString() : new Date().toISOString(),
      });
    }

    return result;
  }

  // 修改协作者权限（owner only）
  async updateCollaboratorRole(
    userId: string, projectId: string, targetUserId: string, role: string,
  ): Promise<{ message: string }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project || project.ownerId !== userId) {
      throw new ForbiddenException('仅项目所有者可修改权限');
    }

    this.validateRole(role);

    const collab = await this.collaboratorRepo.findOne({
      where: { projectId, userId: targetUserId },
    });
    if (!collab) throw new NotFoundException('协作者不存在');

    collab.role = role;
    await this.collaboratorRepo.save(collab);
    return { message: `已将权限修改为 ${role}` };
  }

  // 移除协作者（owner only）
  async removeCollaborator(
    userId: string, projectId: string, targetUserId: string,
  ): Promise<{ message: string }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project || project.ownerId !== userId) {
      throw new ForbiddenException('仅项目所有者可移除协作者');
    }

    const collab = await this.collaboratorRepo.findOne({
      where: { projectId, userId: targetUserId },
    });
    if (!collab) throw new NotFoundException('协作者不存在');

    await this.collaboratorRepo.remove(collab);
    return { message: '已移除协作者' };
  }

  // 供 CollaborationGateway (Task 16) 调用：检查编辑权限
  async checkEditPermission(userId: string, projectId: string): Promise<{ canEdit: boolean; isOwner: boolean }> {
    const project = await this.projectRepo.findOne({ where: { id: projectId } });
    if (!project) return { canEdit: false, isOwner: false };

    if (project.ownerId === userId) {
      return { canEdit: true, isOwner: true };
    }

    const collab = await this.collaboratorRepo.findOne({
      where: { projectId, userId },
    });
    if (collab && (collab.role === 'editor' || collab.role === 'owner')) {
      return { canEdit: true, isOwner: false };
    }

    return { canEdit: false, isOwner: false };
  }
}
