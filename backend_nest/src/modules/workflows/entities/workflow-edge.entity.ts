// src/modules/workflows/entities/workflow-edge.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('workflow_edges')
@Index('idx_workflow_edges_project_id', ['projectId'])
@Index('idx_workflow_edges_source_node_id', ['sourceNodeId'])
@Index('idx_workflow_edges_target_node_id', ['targetNodeId'])
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
