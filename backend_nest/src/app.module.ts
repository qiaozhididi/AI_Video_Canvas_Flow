// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './common/auth/auth.module';
import { AuthBusinessModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { MediaModule } from './modules/media/media.module';
import { RenderModule } from './modules/render/render.module';
import { AiModule } from './modules/ai/ai.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { QueueModule } from './queue/queue.module';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    // 核心基础设施
    ConfigModule,
    DatabaseModule,
    AuthModule,
    // 业务模块
    AuthBusinessModule,
    ProjectsModule,
    WorkflowsModule,
    MediaModule,
    RenderModule,
    AiModule,
    SnapshotsModule,
    TemplatesModule,
    InvitationsModule,
    CollaborationModule,
    // 异步任务与 WebSocket
    QueueModule,
    WsModule,
  ],
})
export class AppModule {}
