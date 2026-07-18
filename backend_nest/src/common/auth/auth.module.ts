// src/common/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './jwt.strategy';
import { MinioService } from '../utils/minio.service';
import { ProjectAccessService } from './project-access.service';
import { Project } from '../../modules/projects/entities/project.entity';
import { ProjectCollaborator } from '../../modules/invitations/entities/project-collaborator.entity';

@Module({
  imports: [
    PassportModule,
    TypeOrmModule.forFeature([Project, ProjectCollaborator]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<number>('jwt.expiresIn'), algorithm: 'HS256' },
      }),
    }),
  ],
  providers: [JwtStrategy, MinioService, ProjectAccessService],
  exports: [JwtModule, PassportModule, MinioService, ProjectAccessService],
})
export class AuthModule {}
