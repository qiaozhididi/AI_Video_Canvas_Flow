// src/modules/media/media.controller.ts
import {
  Controller, Get, Post, Delete, Param, Query, Res, UseGuards,
  UseInterceptors, UploadedFile, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OptionalTokenGuard } from '../../common/auth/optional-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('media')
export class MediaController {
  constructor(private mediaService: MediaService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() userId: string, @Query('limit') limit = 50, @Query('offset') offset = 0) {
    return this.mediaService.list(userId, Number(limit), Number(offset));
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('project_id') projectId?: string,
  ) {
    return this.mediaService.upload(userId, file, projectId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') mediaId: string) {
    return this.mediaService.get(userId, mediaId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/presign')
  getPresign(@CurrentUser() userId: string, @Param('id') mediaId: string) {
    return this.mediaService.getPresign(userId, mediaId);
  }

  @UseGuards(OptionalTokenGuard)
  @Get(':id/download')
  async download(
    @CurrentUser() userId: string,
    @Param('id') mediaId: string,
    @Res() res: any,
  ) {
    const result = await this.mediaService.download(userId, mediaId);
    res.set('Content-Type', result.contentType);
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`);
    res.send(result.buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async delete(@CurrentUser() userId: string, @Param('id') mediaId: string) {
    await this.mediaService.delete(userId, mediaId);
    return { detail: '已删除' };
  }
}
