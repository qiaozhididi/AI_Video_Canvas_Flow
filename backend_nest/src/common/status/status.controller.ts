// src/common/status/status.controller.ts
import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Response } from 'express';

// O1: 健康检查端点（README 已声明 /api/v1/status，对齐实现）
//   - 公开访问（无 JwtAuthGuard）
//   - M2: @SkipThrottle 跳过全局限流，避免探活被 429 阻断导致 pod 雪崩重启
//   - M3: DB 探活 3s 超时，避免 DB 网络分区时 query 挂起耗尽连接池
//   - m1: DB down 时返回 503，便于 readiness probe 摘流（liveness 可通过 failureThreshold 容忍抖动）
//   - m2: no-store 防止 Nginx/CDN 缓存探活响应
@Controller('status')
@SkipThrottle()
export class StatusController {
  constructor(private dataSource: DataSource) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{
    status: string;
    timestamp: string;
    uptime: number;
    dependencies: { database: string };
  }> {
    let db = 'ok';
    try {
      // M3: Promise.race 加 3s 超时，避免挂起 query 占用连接池
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DB probe timeout')), 3000),
        ),
      ]);
    } catch {
      db = 'error';
    }
    const status = db === 'ok' ? 'ok' : 'degraded';
    const body = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      dependencies: { database: db },
    };
    if (status !== 'ok') {
      // m1: DB down 时返回 503，便于 readiness probe 摘流
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
