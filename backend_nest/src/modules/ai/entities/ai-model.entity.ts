// src/modules/ai/entities/ai-model.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('ai_models')
@Index('idx_ai_models_provider_id', ['providerId'])
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
