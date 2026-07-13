// src/modules/render/entities/render-task.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('render_tasks')
export class RenderTask {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'node_id', length: 128, nullable: true }) nodeId: string;
  @Column({ name: 'task_type', length: 64 }) taskType: string;
  @Column({ length: 32 }) status: string;  // pending/running/completed/failed/cancelled
  @Column({ type: 'int', default: 0 }) progress: number;  // 0-100 整数
  @Column({ name: 'celery_task_id', length: 256, nullable: true }) celeryTaskId: string;  // 复用列名，存储 BullMQ job ID
  @Column({ name: 'model_id', type: 'uuid', nullable: true }) modelId: string;
  @Column('text', { nullable: true }) prompt: string;
  @Column({ name: 'input_artifacts', type: 'json', nullable: true }) inputArtifacts: any;
  @Column({ name: 'result_url', length: 512, nullable: true }) resultUrl: string;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
