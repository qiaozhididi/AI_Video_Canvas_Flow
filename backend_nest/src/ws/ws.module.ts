// src/ws/ws.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../modules/auth/entities/user.entity';
import { NodeLockService } from './node-lock.service';
import { CollaborationGateway } from './collaboration.gateway';
import { AuthModule } from '../common/auth/auth.module';
import { InvitationsModule } from '../modules/invitations/invitations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule,
    InvitationsModule,
  ],
  providers: [NodeLockService, CollaborationGateway],
  exports: [NodeLockService],
})
export class WsModule {}
