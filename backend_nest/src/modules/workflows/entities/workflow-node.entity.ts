// src/modules/workflows/entities/workflow-node.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('workflow_nodes')
export class WorkflowNode {
  @PrimaryColumn({ length: 128 }) id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'node_type', length: 64 }) nodeType: string;
  @Column({ length: 128, nullable: true }) label: string | null;
  @Column({ name: 'position_x', type: 'double precision', default: 0 }) positionX: number;
  @Column({ name: 'position_y', type: 'double precision', default: 0 }) positionY: number;
  @Column({ type: 'json', nullable: true }) config: any | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
