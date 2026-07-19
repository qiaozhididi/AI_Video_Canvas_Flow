// src/modules/workflows/entities/workflow-node.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('workflow_nodes')
@Index('idx_workflow_nodes_project_id', ['projectId'])
export class WorkflowNode {
  @PrimaryColumn({ length: 128 }) id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'node_type', length: 64 }) nodeType: string;
  @Column({ type: 'varchar', length: 128, nullable: true }) label: string | null;
  @Column({ name: 'position_x', type: 'double precision', default: 0 }) positionX: number;
  @Column({ name: 'position_y', type: 'double precision', default: 0 }) positionY: number;
  @Column({ type: 'json', nullable: true }) config: any | null;
  @CreateDateColumn({ name: 'created_at', default: () => 'NOW()' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', default: () => 'NOW()' }) updatedAt: Date;
}
