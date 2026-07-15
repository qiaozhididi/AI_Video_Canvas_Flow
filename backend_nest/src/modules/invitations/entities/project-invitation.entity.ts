import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('project_invitations')
@Index(['token'], { unique: true })
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
