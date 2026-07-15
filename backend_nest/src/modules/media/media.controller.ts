// src/modules/media/media.controller.ts
import {
  Controller, Get, Post, Delete, Param, Query, Res, UseGuards,
  UseInterceptors, UploadedFile, Body, HttpCode,
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
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('project_id') projectId?: string,
  ) {
    return this.mediaService.upload(userId, file, projectId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats/usage')
  getStorageUsage(@CurrentUser() userId: string) {
    return this.mediaService.getStorageUsage(userId);
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
    @Query('download') download: string,
    @Res() res: any,
  ) {
    const result = await this.mediaService.download(userId, mediaId);
    // C6: download=true 强制下载(attachment)，否则 inline（对齐 Python media.py:165）
    const disposition = download === 'true' ? 'attachment' : 'inline';
    const encodedFilename = encodeURIComponent(result.fileName);
    res.set('Content-Type', result.contentType);
    res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedFilename}`);
    res.send(result.buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id') mediaId: string) {
    await this.mediaService.delete(userId, mediaId);
  }
}
