// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './common/auth/auth.module';
import { AuthBusinessModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { MediaModule } from './modules/media/media.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    AuthBusinessModule,
    ProjectsModule,
    WorkflowsModule,
    MediaModule,
  ],
})
export class AppModule {}
