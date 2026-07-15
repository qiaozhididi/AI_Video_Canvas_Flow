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
    const [items] = await this.mediaRepo.findAndCount({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return items.map(m => this.toResponse(m));
  }

  async getStorageUsage(userId: string) {
    const assets = await this.mediaRepo.find({ where: { ownerId: userId } });
    const categories: Record<string, { count: number; size: number }> = {};
    let totalSize = 0;
    for (const asset of assets) {
      const cat = (asset.fileType || 'other').split('/')[0];
      const size = Number(asset.fileSize) || 0;
      totalSize += size;
      if (!categories[cat]) categories[cat] = { count: 0, size: 0 };
      categories[cat].count += 1;
      categories[cat].size += size;
    }
    const quota = 10 * 1024 * 1024 * 1024; // 10 GB
    return {
      total_size: totalSize,
      total_count: assets.length,
      quota,
      categories,
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
      storageKey: objectName,
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
    const url = await this.minioService.getPresignedUrl(media.storageKey, 1);
    return { url, expires_in: 3600 };
  }

  async download(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权访问此资产');
    const buffer = await this.minioService.downloadObject(media.storageKey);
    return { buffer, contentType: media.fileType, fileName: media.fileName };
  }

  async delete(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new ForbiddenException('无权删除此资产');

    await this.minioService.deleteObject(media.storageKey);
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
      storage_key: m.storageKey,
      thumbnail_key: m.thumbnailKey,
      created_at: m.createdAt?.toISOString(),
      updated_at: m.updatedAt?.toISOString(),
    };
  }
}
