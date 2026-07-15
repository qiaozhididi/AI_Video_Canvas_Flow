// src/modules/ai/ai.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { ProviderCreateDto, ProviderUpdateDto, ModelCreateDto, ModelUpdateDto, GenerateWorkflowDto, GenerateSubtitlesDto } from './dto/ai.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  // Provider
  @Get('providers')
  listProviders(@CurrentUser() userId: string) {
    return this.aiService.listProviders(userId);
  }

  @Post('providers')
  @HttpCode(200)
  createProvider(@CurrentUser() userId: string, @Body() dto: ProviderCreateDto) {
    return this.aiService.createProvider(userId, dto);
  }

  @Put('providers/:id')
  updateProvider(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: ProviderUpdateDto) {
    return this.aiService.updateProvider(userId, id, dto);
  }

  // DELETE providers 保持 200+body（Python ai.py:168 返回 {message: ...}）
  @Delete('providers/:id')
  deleteProvider(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.aiService.deleteProvider(userId, id);
  }

  // Model
  @Get('models')
  listModels(
    @CurrentUser() userId: string,
    @Query('provider_id') providerId?: string,
    @Query('model_type') modelType?: string,
  ) {
    return this.aiService.listModels(userId, providerId, modelType);
  }

  @Post('models')
  @HttpCode(200)
  createModel(@CurrentUser() userId: string, @Body() dto: ModelCreateDto) {
    return this.aiService.createModel(userId, dto);
  }

  @Put('models/:id')
  updateModel(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: ModelUpdateDto) {
    return this.aiService.updateModel(userId, id, dto);
  }

  // DELETE models 保持 200+body（Python ai.py:295 返回 {message: ...}）
  @Delete('models/:id')
  async deleteModel(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.aiService.deleteModel(userId, id);
    return { message: '已删除模型' };
  }

  @Get('models/default')
  getDefaultModel(@CurrentUser() userId: string, @Query('model_type') modelType?: string) {
    return this.aiService.getDefaultModel(userId, modelType);
  }

  // AI 生成
  @Post('generate-workflow')
  @HttpCode(200)
  generateWorkflow(@CurrentUser() userId: string, @Body() dto: GenerateWorkflowDto) {
    return this.aiService.generateWorkflow(userId, dto);
  }

  @Post('generate-subtitles')
  @HttpCode(200)
  generateSubtitles(@CurrentUser() userId: string, @Body() dto: GenerateSubtitlesDto) {
    return this.aiService.generateSubtitles(userId, dto);
  }
}
