// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { FastApiCompatFilter } from './common/filters/fastapi-compat.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JWT_DEFAULT_SECRET } from './common/config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  const config = app.get(ConfigService);

  // I1+I2: 接入 helmet 安全头（自动移除 X-Powered-By 等）
  // Reviewer I-1: helmet 默认 CSP(default-src 'self')/HSTS 会破坏 Canvas/MinIO 跨域资源加载
  //   - 开发环境关闭 CSP/HSTS 避免本地调试被拦截
  //   - 生产环境保留 HSTS；CORS 由 enableCors 单独控制，CSP 暂不启用（前端有内联 worker/Canvas）
  //   - MinIO 跨域资源需 cross-origin CORP，否则 <img>/封面加载被浏览器拦截
  app.use(helmet({
    contentSecurityPolicy: false,
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // Reviewer I-2: 反向代理环境下需信任 X-Forwarded-For，否则 ThrottlerGuard 按 proxy IP 限流（误伤或失效）
  //   生产部署在 Nginx/ALB 后，trust proxy=1 表示信任一层代理
  if (process.env.NODE_ENV === 'production') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // C1: 生产环境校验 SECRET_KEY 非默认值，防止密钥泄露导致身份伪造
  // M-1: 去掉非空断言（与后续判空逻辑矛盾）；M-2: 引用 configuration 集中管理的常量
  const secretKey = config.get<string>('jwt.secret');
  if (process.env.NODE_ENV === 'production' && (!secretKey || secretKey === JWT_DEFAULT_SECRET)) {
    throw new Error('生产环境必须配置安全的 SECRET_KEY 环境变量（不可使用默认值）');
  }
  if (secretKey === JWT_DEFAULT_SECRET) {
    Logger.warn('JWT SECRET_KEY 使用默认值，生产环境必须替换为安全随机字符串', 'Bootstrap');
  }

  // CORS
  const origins = config.get<string[]>('cors.origins')!;
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // 全局前缀
  app.setGlobalPrefix('api/v1');

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // 全局异常过滤器 (FastAPI 兼容)
  app.useGlobalFilters(new FastApiCompatFilter());

  // 全局请求日志拦截器
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Socket.IO 适配器
  app.useWebSocketAdapter(new IoAdapter(app));

  const port = process.env.PORT || 8000;
  await app.listen(port);
  Logger.log(`NestJS 后端启动: http://localhost:${port}`, 'Bootstrap');
  Logger.log(`CORS origins: ${origins.join(', ')}`, 'Bootstrap');
}
bootstrap();
