// src/modules/ai/entities/ai-provider.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('ai_providers')
@Index('idx_ai_providers_user_id', ['userId'])
export class AiProvider {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ length: 128 }) name: string;
  @Column({ length: 64 }) platform: string;
  @Column({ name: 'base_url', length: 512 }) baseUrl: string;
  @Column({ name: 'api_key', length: 512 }) apiKey: string;
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
