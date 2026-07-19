import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectInvitation } from './entities/project-invitation.entity';
import { ProjectCollaborator } from './entities/project-collaborator.entity';
import { Project } from '../projects/entities/project.entity';
import { User } from '../auth/entities/user.entity';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { AuthModule } from '../../common/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectInvitation, ProjectCollaborator, Project, User]),
    AuthModule,
  ],
  providers: [InvitationsService],
  controllers: [InvitationsController],
  exports: [InvitationsService],
})
export class InvitationsModule {}
