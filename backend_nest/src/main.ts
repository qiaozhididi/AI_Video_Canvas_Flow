// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { FastApiCompatFilter } from './common/filters/fastapi-compat.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  const config = app.get(ConfigService);

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
