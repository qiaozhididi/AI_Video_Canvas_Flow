// src/modules/media/entities/media-asset.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('media_assets')
export class MediaAsset {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId: string;
  @Column({ name: 'file_name', length: 255 }) fileName: string;
  @Column({ name: 'file_type', length: 64 }) fileType: string;
  @Column({ name: 'file_size', type: 'bigint' }) fileSize: number;
  @Column({ name: 'storage_path', length: 512 }) storagePath: string;
  @Column({ name: 'thumbnail_url', length: 512, nullable: true }) thumbnailUrl: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
