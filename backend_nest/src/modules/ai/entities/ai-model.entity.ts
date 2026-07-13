// src/modules/ai/entities/ai-model.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('ai_models')
export class AiModel {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'provider_id', type: 'uuid' }) providerId: string;
  @Column({ name: 'model_id', length: 128 }) modelId: string;  // API 模型 ID
  @Column({ name: 'display_name', length: 128 }) displayName: string;
  @Column({ name: 'model_type', length: 32 }) modelType: string;  // llm/image_gen/video_gen/tts
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ name: 'is_default', default: false }) isDefault: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
