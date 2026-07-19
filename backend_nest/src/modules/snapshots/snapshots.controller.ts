// src/modules/snapshots/snapshots.controller.ts
import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode,
} from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { SnapshotCreateDto } from './dto/snapshot.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class SnapshotsController {
  constructor(private snapshotsService: SnapshotsService) {}

  // 项目下的快照
  @Post('projects/:id/snapshots')
  @HttpCode(200)
  create(@CurrentUser() userId: string, @Param('id') projectId: string, @Body() dto: SnapshotCreateDto) {
    return this.snapshotsService.create(userId, projectId, dto);
  }

  @Get('projects/:id/snapshots')
  list(@CurrentUser() userId: string, @Param('id') projectId: string, @Query('source') source?: string) {
    return this.snapshotsService.list(userId, projectId, source);
  }

  @Get('projects/:id/snapshots/latest')
  getLatest(@CurrentUser() userId: string, @Param('id') projectId: string) {
    return this.snapshotsService.getLatest(userId, projectId);
  }

  // 独立快照路由
  @Get('snapshots/:id')
  get(@CurrentUser() userId: string, @Param('id') snapshotId: string) {
    return this.snapshotsService.get(userId, snapshotId);
  }

  @Delete('snapshots/:id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id') snapshotId: string) {
    await this.snapshotsService.delete(userId, snapshotId);
  }

  @Post('snapshots/:id/restore')
  @HttpCode(200)
  restore(@CurrentUser() userId: string, @Param('id') snapshotId: string) {
    return this.snapshotsService.restore(userId, snapshotId);
  }
}
