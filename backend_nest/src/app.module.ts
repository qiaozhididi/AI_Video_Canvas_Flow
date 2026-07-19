// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './common/auth/auth.module';
import { StatusModule } from './common/status/status.module';
import { AuthBusinessModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { MediaModule } from './modules/media/media.module';
import { RenderModule } from './modules/render/render.module';
import { AiModule } from './modules/ai/ai.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { QueueModule } from './queue/queue.module';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    // 核心基础设施
    ConfigModule,
    DatabaseModule,
    AuthModule,
    // O1: 健康检查端点 GET /api/v1/status
    StatusModule,
    // I3: 全局限流，每分钟 60 次/IP（敏感路由可用 @Throttle 加严）
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
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
    // B3: 移除 CollaborationModule（死代码，getStatus 被 StatusController 覆盖且无鉴权）
    // 协作功能由 WsModule 的 collaboration.gateway.ts 提供
    // 异步任务与 WebSocket
    QueueModule,
    WsModule,
  ],
  providers: [
    // I3: 全局启用 ThrottlerGuard
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
