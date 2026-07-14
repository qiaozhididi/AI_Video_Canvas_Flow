// test/e2e/auth.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '../../src/common/config/config.module';
import { AuthBusinessModule } from '../../src/modules/auth/auth.module';
import { FastApiCompatFilter } from '../../src/common/filters/fastapi-compat.filter';

// E2E 测试需要可用的 PostgreSQL 测试数据库
// 默认连接 localhost:5432/ai_canvas_flow_test，可通过 TEST_DATABASE_URL 环境变量覆盖
// 运行前请确保: createdb ai_canvas_flow_test 或 docker run postgres
describe('AuthController (e2e)', () => {
  let app: INestApplication;

  // 数据库连接+建表可能较慢，给 beforeAll 30s 超时
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // 项目的 ConfigModule 已配置 load: [configuration]，提供 jwt.secret 等默认值
        ConfigModule,
        // 测试数据库，synchronize:true 自动建表，dropSchema:true 每次清空
        // retryAttempts 限制为 3 次以避免无数据库时长时间等待
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: process.env.TEST_DATABASE_URL
            || 'postgresql://postgres:postgres@localhost:5432/ai_canvas_flow_test',
          entities: [__dirname + '/../../src/modules/**/*.entity{.ts,.js}'],
          synchronize: true,
          dropSchema: true,
          retryAttempts: 3,
          retryDelay: 1000,
        }),
        // AuthBusinessModule 已包含 AuthModule（JwtModule.registerAsync + PassportModule + JwtStrategy + MinioService）
        // 无需在顶层重复注册 JwtModule/PassportModule，否则会与 registerAsync 冲突
        AuthBusinessModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // 与 main.ts 保持一致的全局配置
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new FastApiCompatFilter());
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('应成功注册新用户', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: 'e2euser', email: 'e2e@test.com', password: 'password123' })
        .expect(201)
        .expect((res) => {
          expect(res.body.username).toBe('e2euser');
          expect(res.body.email).toBe('e2e@test.com');
          expect(res.body.id).toBeDefined();
        });
    });

    it('重复用户名应返回 409', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ username: 'e2euser', email: 'e2e2@test.com', password: 'password123' })
        .expect(409)
        .expect((res) => {
          expect(res.body.detail).toBe('用户名已存在');
        });
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('应成功登录并返回 token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'e2euser', password: 'password123' })
        .expect(201)
        .expect((res) => {
          expect(res.body.access_token).toBeDefined();
          expect(res.body.refresh_token).toBeDefined();
          expect(res.body.token_type).toBe('bearer');
        });
    });

    it('密码错误应返回 401', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'e2euser', password: 'wrongpassword' })
        .expect(401)
        .expect((res) => {
          expect(res.body.detail).toBe('用户名或密码错误');
        });
    });
  });

  describe('错误格式验证', () => {
    it('错误响应应为 FastAPI 格式 { detail: string }', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent', password: 'password' })
        .expect(401)
        .expect((res) => {
          expect(res.body).toHaveProperty('detail');
          expect(typeof res.body.detail).toBe('string');
        });
    });
  });
});
