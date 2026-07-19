// src/modules/render/render.controller.ts
import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode,
} from '@nestjs/common';
import { RenderService } from './render.service';
import { RenderTaskCreateDto, ExportRequestDto } from './dto/render.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { clampLimit } from '../../common/utils/pagination';

@Controller('render')
@UseGuards(JwtAuthGuard)
export class RenderController {
  constructor(private renderService: RenderService) {}

  @Get()
  list(@CurrentUser() userId: string, @Query('status') status?: string, @Query('limit') limit = 50) {
    // I9: limit 上限保护（防止恶意拉取全表）
    return this.renderService.list(userId, status, clampLimit(limit));
  }

  @Post()
  @HttpCode(200)
  create(@CurrentUser() userId: string, @Body() dto: RenderTaskCreateDto) {
    return this.renderService.create(userId, dto);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') taskId: string) {
    return this.renderService.get(userId, taskId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() userId: string, @Param('id') taskId: string) {
    return this.renderService.cancel(userId, taskId);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@CurrentUser() userId: string, @Param('id') taskId: string) {
    return this.renderService.retry(userId, taskId);
  }

  @Post('export')
  @HttpCode(200)
  exportVideo(@CurrentUser() userId: string, @Body() dto: ExportRequestDto) {
    return this.renderService.exportVideo(userId, dto);
  }
}
