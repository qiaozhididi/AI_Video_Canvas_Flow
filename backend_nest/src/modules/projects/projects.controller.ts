// src/modules/projects/projects.controller.ts
import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards,
  UseInterceptors, UploadedFile, Res, HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProjectsService } from './projects.service';
import { ProjectCreateDto, ProjectUpdateDto } from './dto/project.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OptionalTokenGuard } from '../../common/auth/optional-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() userId: string) {
    return this.projectsService.list(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(200)
  create(@CurrentUser() userId: string, @Body() dto: ProjectCreateDto) {
    return this.projectsService.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') projectId: string) {
    return this.projectsService.get(userId, projectId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@CurrentUser() userId: string, @Param('id') projectId: string, @Body() dto: ProjectUpdateDto) {
    return this.projectsService.update(userId, projectId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id') projectId: string) {
    await this.projectsService.delete(userId, projectId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cover')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  uploadCover(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.projectsService.uploadCover(userId, projectId, file);
  }

  // 使用 OptionalTokenGuard 支持 <img> 标签的 ?token=xxx
  @UseGuards(OptionalTokenGuard)
  @Get(':id/cover/download')
  async downloadCover(
    @Param('id') projectId: string,
    @Res() res: any,
  ) {
    const result = await this.projectsService.downloadCover('', projectId);
    res.set('Content-Type', result.contentType);
    res.send(result.buffer);
  }
}
