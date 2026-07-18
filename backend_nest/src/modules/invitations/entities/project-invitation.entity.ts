import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移。
// token 已有唯一索引，下面补充按项目/创建人/使用人查询的常用索引。
@Entity('project_invitations')
@Index(['token'], { unique: true })
@Index('idx_project_invitations_project_id', ['projectId'])
@Index('idx_project_invitations_created_by', ['createdBy'])
@Index('idx_project_invitations_used_by', ['usedBy'])
export class ProjectInvitation {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ length: 64 }) token: string;
  @Column({ length: 20, default: 'editor' }) role: string;
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true }) expiresAt: Date | null;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy: string;
  @Column({ name: 'used_by', type: 'uuid', nullable: true }) usedBy: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
