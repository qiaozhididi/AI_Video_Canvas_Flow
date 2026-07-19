// src/common/status/status.module.ts
import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';

// O1: 健康检查模块（无需单独 forFeature，DataSource 由 TypeOrmModule.forRootAsync 全局注册）
@Module({
  controllers: [StatusController],
})
export class StatusModule {}
