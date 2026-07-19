// src/modules/snapshots/entities/project-snapshot.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('project_snapshots')
@Index('idx_project_snapshots_project_id', ['projectId'])
@Index('idx_project_snapshots_owner_id', ['ownerId'])
export class ProjectSnapshot {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ length: 16 }) source: string;  // auto/manual
  @Column({ length: 128, nullable: true }) label: string;
  @Column({ length: 100, nullable: true }) name: string;
  @Column({ name: 'snapshot_data', type: 'jsonb' }) snapshotData: any;
  @CreateDateColumn({ name: 'created_at', default: () => 'NOW()' }) createdAt: Date;
}
