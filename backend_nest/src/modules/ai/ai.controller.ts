// src/modules/ai/ai.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards,
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
  createProvider(@CurrentUser() userId: string, @Body() dto: ProviderCreateDto) {
    return this.aiService.createProvider(userId, dto);
  }

  @Put('providers/:id')
  updateProvider(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: ProviderUpdateDto) {
    return this.aiService.updateProvider(userId, id, dto);
  }

  @Delete('providers/:id')
  async deleteProvider(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.aiService.deleteProvider(userId, id);
    return { detail: '已删除' };
  }

  // Model
  @Get('models')
  listModels(@CurrentUser() userId: string, @Query('provider_id') providerId?: string) {
    return this.aiService.listModels(userId, providerId);
  }

  @Post('models')
  createModel(@CurrentUser() userId: string, @Body() dto: ModelCreateDto) {
    return this.aiService.createModel(userId, dto);
  }

  @Put('models/:id')
  updateModel(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: ModelUpdateDto) {
    return this.aiService.updateModel(userId, id, dto);
  }

  @Delete('models/:id')
  async deleteModel(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.aiService.deleteModel(userId, id);
    return { detail: '已删除' };
  }

  @Get('models/default')
  getDefaultModel(@CurrentUser() userId: string, @Query('model_type') modelType?: string) {
    return this.aiService.getDefaultModel(userId, modelType);
  }

  // AI 生成
  @Post('generate-workflow')
  generateWorkflow(@CurrentUser() userId: string, @Body() dto: GenerateWorkflowDto) {
    return this.aiService.generateWorkflow(userId, dto);
  }

  @Post('generate-subtitles')
  generateSubtitles(@CurrentUser() userId: string, @Body() dto: GenerateSubtitlesDto) {
    return this.aiService.generateSubtitles(userId, dto);
  }
}
