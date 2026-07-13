// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './common/auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    // 业务模块将在后续 Task 中添加:
    // AuthBusinessModule, ProjectsModule, WorkflowsModule, MediaModule,
    // RenderModule, AiModule, SnapshotsModule, TemplatesModule,
    // InvitationsModule, CollaborationModule, QueueModule, WsModule
  ],
})
export class AppModule {}
