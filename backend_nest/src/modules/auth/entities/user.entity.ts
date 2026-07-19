// src/modules/auth/entities/user.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

// 注意：username / email 的 unique 约束已自动生成唯一索引，无需额外声明 @Index。
// 如需新增其他查询字段索引，需配套 Alembic 迁移生效。
@Entity('users')
export class User {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 64, unique: true }) username: string;
  @Column({ length: 255, unique: true }) email: string;
  @Column({ name: 'hashed_password', length: 255 }) hashedPassword: string;
  @Column({ name: 'avatar_url', length: 512, nullable: true }) avatarUrl: string;
}
