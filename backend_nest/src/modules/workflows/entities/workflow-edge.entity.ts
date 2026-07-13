// src/modules/workflows/entities/workflow-edge.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('workflow_edges')
export class WorkflowEdge {
  @PrimaryColumn({ length: 128 }) id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'source_node_id', length: 128 }) sourceNodeId: string;
  @Column({ name: 'target_node_id', length: 128 }) targetNodeId: string;
  @Column({ name: 'source_port', length: 64, nullable: true }) sourcePort: string;
  @Column({ name: 'target_port', length: 64, nullable: true }) targetPort: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
