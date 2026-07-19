// src/modules/projects/entities/project.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 注意：@Index 仅作代码层声明，索引真正生效需配套 Alembic 迁移
@Entity('projects')
@Index('idx_projects_owner_id', ['ownerId'])
export class Project {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 128 }) name: string;
  @Column('text', { nullable: true }) description: string;
  @Column({ name: 'cover_url', length: 512, nullable: true }) coverUrl: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ name: 'is_template', default: false }) isTemplate: boolean;
  @Column({ name: 'template_category', length: 64, nullable: true }) templateCategory: string;
  @Column({ name: 'template_tags', type: 'json', nullable: true }) templateTags: any;
  @CreateDateColumn({ name: 'created_at', default: () => 'NOW()' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', default: () => 'NOW()' }) updatedAt: Date;
}
