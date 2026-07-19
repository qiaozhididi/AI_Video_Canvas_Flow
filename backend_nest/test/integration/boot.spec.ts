// test/integration/boot.spec.ts
// 集成装配验证：import 完整 AppModule，compile 出 TestingModule
// 验证 DI 容器装配完整（无循环依赖、无缺失 provider、所有模块 import 链路正常）
// 不调用 app.init()，避免触发 DB/Redis/MinIO 真实连接（本地无 docker 环境）
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/modules/auth/auth.service';
import { ProjectsService } from '../../src/modules/projects/projects.service';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service';
import { MediaService } from '../../src/modules/media/media.service';
import { RenderService } from '../../src/modules/render/render.service';
import { AiService } from '../../src/modules/ai/ai.service';
import { SnapshotsService } from '../../src/modules/snapshots/snapshots.service';
import { TemplatesService } from '../../src/modules/templates/templates.service';
import { InvitationsService } from '../../src/modules/invitations/invitations.service';
import { QueueService } from '../../src/queue/queue.service';
import { ExportService } from '../../src/queue/export.service';
import { MinioService } from '../../src/common/utils/minio.service';
import { ProjectAccessService } from '../../src/common/auth/project-access.service';

describe('AppModule 装配验证 (integration)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // compile 只解析依赖图、实例化非 lazy provider，不触发 onModuleInit
    // TypeOrmModule.forRootAsync / BullModule.forRootAsync 的 factory 会执行（仅返回配置对象）
    // 真正的 DB/Redis 连接发生在 onModuleInit，compile 阶段不会连接
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  }, 60000);

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
  });

  it('DI 容器应成功装配（无循环依赖、无缺失 provider）', () => {
    expect(moduleRef).toBeDefined();
  });

  describe('核心基础设施 provider 应可解析', () => {
    it('ConfigService 可解析', () => {
      expect(moduleRef.get(ConfigService)).toBeDefined();
    });
  });

  describe('业务 service 应可解析（验证模块 import 链与 DI 完整）', () => {
    const cases: Array<[string, any]> = [
      ['AuthService', AuthService],
      ['ProjectsService', ProjectsService],
      ['WorkflowsService', WorkflowsService],
      ['MediaService', MediaService],
      ['RenderService', RenderService],
      ['AiService', AiService],
      ['SnapshotsService', SnapshotsService],
      ['TemplatesService', TemplatesService],
      ['InvitationsService', InvitationsService],
      ['QueueService', QueueService],
      ['ExportService', ExportService],
      ['MinioService', MinioService],
      ['ProjectAccessService', ProjectAccessService],
    ];

    for (const [name, token] of cases) {
      it(`${name} 可解析`, () => {
        expect(moduleRef.get(token)).toBeDefined();
      });
    }
  });

  describe('M14/M15 修复后配置应正确加载', () => {
    it('limits 配置段应存在且默认值正确', () => {
      const config = moduleRef.get(ConfigService);
      // M15: 业务阈值抽离到 configuration.ts limits 段
      expect(config.get('limits.media.maxUploadSize')).toBe(100 * 1024 * 1024);
      expect(config.get('limits.media.coverMaxSize')).toBe(5 * 1024 * 1024);
      expect(config.get('limits.invitation.defaultExpiresHours')).toBe(24);
      expect(config.get('limits.invitation.maxCollaborators')).toBe(10);
      expect(config.get('limits.snapshot.autoMaxCount')).toBe(5);
      expect(config.get('limits.pagination.defaultLimit')).toBe(50);
      expect(config.get('limits.pagination.maxLimit')).toBe(100);
    });

    it('MinioService 应有 bucketReadyPromise 字段（M14 lazy once）', () => {
      // M14: lazy once 模式，初始时 Promise 为 null（首次 ensureBucket 才创建）
      const minio = moduleRef.get(MinioService);
      expect(minio).toBeDefined();
      // onModuleInit 未触发，bucketReadyPromise 应为 null
      expect((minio as any).bucketReadyPromise).toBeNull();
    });
  });
});

