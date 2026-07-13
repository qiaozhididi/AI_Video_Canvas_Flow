// src/modules/auth/entities/user.entity.ts
import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 64, unique: true }) username: string;
  @Column({ length: 255, unique: true }) email: string;
  @Column({ name: 'hashed_password', length: 255 }) hashedPassword: string;
  @Column({ name: 'avatar_url', length: 512, nullable: true }) avatarUrl: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
