// src/modules/media/media.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { MediaAsset } from './entities/media-asset.entity';
import { MinioService } from '../../common/utils/minio.service';

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private minioService: MinioService,
  ) {}

  async list(userId: string, limit = 50, offset = 0) {
    const [items, total] = await this.mediaRepo.findAndCount({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map(m => this.toResponse(m)),
      total,
      limit,
      offset,
    };
  }

  async upload(userId: string, file: Express.Multer.File, projectId?: string) {
    const mediaId = uuidv4();
    const ext = file.originalname.split('.').pop() || 'bin';
    const objectName = `media/${userId}/${mediaId}.${ext}`;

    await this.minioService.uploadFile(objectName, file.buffer, file.mimetype);

    const media = this.mediaRepo.create({
      id: mediaId,
      ownerId: userId,
      projectId: projectId || undefined,
      fileName: file.originalname,
      fileType: file.mimetype || 'application/octet-stream',
      fileSize: file.size,
      storagePath: objectName,
    });
    await this.mediaRepo.save(media);
    return this.toResponse(media);
  }

  async get(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权访问此资产');
    return this.toResponse(media);
  }

  async getPresign(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权访问此资产');
    const url = await this.minioService.getPresignedUrl(media.storagePath, 1);
    return { url };
  }

  async download(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权访问此资产');
    const buffer = await this.minioService.downloadObject(media.storagePath);
    return { buffer, contentType: media.fileType, fileName: media.fileName };
  }

  async delete(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权删除此资产');

    await this.minioService.deleteObject(media.storagePath);
    await this.mediaRepo.delete({ id: mediaId });
  }

  private toResponse(m: MediaAsset) {
    return {
      id: m.id,
      owner_id: m.ownerId,
      project_id: m.projectId,
      file_name: m.fileName,
      file_type: m.fileType,
      file_size: Number(m.fileSize),
      storage_path: m.storagePath,
      thumbnail_url: m.thumbnailUrl,
      created_at: m.createdAt?.toISOString(),
    };
  }
}
