// src/modules/templates/templates.controller.ts
import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatePublishDto } from './dto/template.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  // 模板列表 (公开路由，但仍需登录)
  @Get('templates')
  list(@Query('q') q?: string, @Query('category') category?: string) {
    return this.templatesService.list(q, category);
  }

  @Post('templates/:id/clone')
  clone(@CurrentUser() userId: string, @Param('id') templateId: string) {
    return this.templatesService.clone(userId, templateId);
  }

  @Delete('templates/:id')
  unpublish(@CurrentUser() userId: string, @Param('id') templateId: string) {
    return this.templatesService.unpublish(userId, templateId);
  }

  // 发布项目为模板
  @Post('projects/:id/publish')
  publish(@CurrentUser() userId: string, @Param('id') projectId: string, @Body() dto: TemplatePublishDto) {
    return this.templatesService.publish(userId, projectId, dto);
  }
}
