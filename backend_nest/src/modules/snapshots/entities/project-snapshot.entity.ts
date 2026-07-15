// src/modules/snapshots/entities/project-snapshot.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('project_snapshots')
export class ProjectSnapshot {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ length: 16 }) source: string;  // auto/manual
  @Column({ length: 128, nullable: true }) label: string;
  @Column({ length: 100, nullable: true }) name: string;
  @Column({ name: 'snapshot_data', type: 'jsonb' }) snapshotData: any;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
