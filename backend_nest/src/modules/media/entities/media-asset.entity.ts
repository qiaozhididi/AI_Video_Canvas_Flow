// src/modules/media/entities/media-asset.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('media_assets')
@Index('idx_media_assets_owner_id', ['ownerId'])
@Index('idx_media_assets_project_id', ['projectId'])
export class MediaAsset {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId: string;
  @Column({ name: 'file_name', length: 255 }) fileName: string;
  @Column({ name: 'file_type', length: 64 }) fileType: string;
  @Column({ name: 'file_size', type: 'bigint' }) fileSize: number;
  @Column({ name: 'storage_key', length: 512 }) storageKey: string;
  @Column({ name: 'thumbnail_key', length: 512, nullable: true }) thumbnailKey: string;
  @CreateDateColumn({ name: 'created_at', default: () => 'NOW()' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', default: () => 'NOW()' }) updatedAt: Date;
}
