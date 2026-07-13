// src/modules/render/render.controller.ts
import {
  Controller, Get, Post, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { RenderService } from './render.service';
import { RenderTaskCreateDto, ExportRequestDto } from './dto/render.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('render')
@UseGuards(JwtAuthGuard)
export class RenderController {
  constructor(private renderService: RenderService) {}

  @Get()
  list(@CurrentUser() userId: string, @Query('status') status?: string, @Query('limit') limit = 50) {
    return this.renderService.list(userId, status, Number(limit));
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: RenderTaskCreateDto) {
    return this.renderService.create(userId, dto);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') taskId: string) {
    return this.renderService.get(userId, taskId);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() userId: string, @Param('id') taskId: string) {
    return this.renderService.cancel(userId, taskId);
  }

  @Post(':id/retry')
  retry(@CurrentUser() userId: string, @Param('id') taskId: string) {
    return this.renderService.retry(userId, taskId);
  }

  @Post('export')
  exportVideo(@CurrentUser() userId: string, @Body() dto: ExportRequestDto) {
    return this.renderService.exportVideo(userId, dto);
  }
}
