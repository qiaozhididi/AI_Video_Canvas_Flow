import { Entity, PrimaryColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity('project_collaborators')
@Unique('uq_project_user', ['projectId', 'userId'])
export class ProjectCollaborator {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ length: 20, default: 'editor' }) role: string;
  @CreateDateColumn({ name: 'joined_at' }) joinedAt: Date;
}
