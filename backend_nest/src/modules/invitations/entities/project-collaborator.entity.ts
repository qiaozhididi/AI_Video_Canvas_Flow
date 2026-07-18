import { Entity, PrimaryColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移。
// 已有 @Unique 复合约束 uq_project_user，下面补充单列索引以加速按项目/按用户查询。
@Entity('project_collaborators')
@Unique('uq_project_user', ['projectId', 'userId'])
@Index('idx_project_collaborators_project_id', ['projectId'])
@Index('idx_project_collaborators_user_id', ['userId'])
export class ProjectCollaborator {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ length: 20, default: 'editor' }) role: string;
  @CreateDateColumn({ name: 'joined_at' }) joinedAt: Date;
}
