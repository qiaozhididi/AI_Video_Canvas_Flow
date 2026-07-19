// src/modules/media/media.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { MediaAsset } from './entities/media-asset.entity';
import { MinioService } from '../../common/utils/minio.service';
import { ProjectAccessService } from '../../common/auth/project-access.service';
import { validateImageSignature } from '../../common/utils/file-signature.util';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  constructor(
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private minioService: MinioService,
    private dataSource: DataSource,
    private projectAccess: ProjectAccessService,
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
    // C7: 改用 SQL 聚合，避免全表加载到内存（原实现加载所有 media_assets 行再 JS 循环累加）
    const rows = await this.dataSource.query(
      `SELECT file_type, COUNT(*)::int AS cnt, COALESCE(SUM(file_size), 0)::bigint AS size
       FROM media_assets WHERE owner_id = $1 GROUP BY file_type`,
      [userId],
    );
    const categories: Record<string, { count: number; size: number }> = {};
    let totalSize = 0;
    let totalCount = 0;
    for (const row of rows) {
      const cat = (row.file_type || 'other').split('/')[0];
      const size = Number(row.size) || 0;
      const count = Number(row.cnt) || 0;
      totalSize += size;
      totalCount += count;
      if (!categories[cat]) categories[cat] = { count: 0, size: 0 };
      categories[cat].count += count;
      categories[cat].size += size;
    }
    const quota = 10 * 1024 * 1024 * 1024; // 10 GB
    return {
      total_size: totalSize,
      total_count: totalCount,
      quota,
      categories,
    };
  }

  async upload(userId: string, file: Express.Multer.File, projectId?: string) {
    // B1: 若指定 project_id，校验编辑权限，防止 IDOR（把资产挂到他人项目，被级联删除时误删）
    if (projectId) {
      await this.projectAccess.verifyEditAccess(userId, projectId);
    }

    // M7: 文件大小限制（100MB，防大文件撑爆 MinIO）
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('文件大小不能超过 100MB');
    }

    // M7: 文件类型白名单 + 图片 magic number 校验（防 mimetype 伪造上传 webshell）
    // 攻击者可改 .php 为 .png 并伪造 Content-Type: image/png，仅校验 mimetype 无效
    const ALLOWED_MIMETYPES = new Set([
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
      'video/mp4', 'audio/mpeg', 'application/pdf',
    ]);
    const declaredType = (file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIMETYPES.has(declaredType)) {
      throw new BadRequestException(`不支持的文件类型: ${declaredType}`);
    }
    // 图片类型必须通过 magic number 校验（webshell 最常见的伪装载体）
    if (declaredType.startsWith('image/')) {
      if (!validateImageSignature(file.buffer, declaredType)) {
        throw new BadRequestException('文件内容与声明类型不符（图片 magic number 校验失败）');
      }
    }

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
    if (media.ownerId !== userId) throw new NotFoundException('媒体资产不存在');
    return this.toResponse(media);
  }

  async getPresign(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new NotFoundException('媒体资产不存在');
    const url = await this.minioService.getPresignedUrl(media.storageKey, 1);
    return { url, expires_in: 3600 };
  }

  async download(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new NotFoundException('媒体资产不存在');
    const buffer = await this.minioService.downloadObject(media.storageKey);
    return { buffer, contentType: media.fileType, fileName: media.fileName };
  }

  async delete(userId: string, mediaId: string) {
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体资产不存在');
    if (media.ownerId !== userId) throw new NotFoundException('媒体资产不存在');

    // I-25: 先删 DB 再删 MinIO（容错，对齐 Python：DB 删除不被 MinIO 失败阻止）
    await this.mediaRepo.delete({ id: mediaId });
    try {
      await this.minioService.deleteObject(media.storageKey);
    } catch (err) {
      // MinIO 删除失败仅记录日志，不阻止 DB 删除（m5: 传 stack 便于排障）
      this.logger.warn(
        `MinIO 删除失败 mediaId=${mediaId}: ${(err as Error).message}`,
        (err as Error)?.stack,
      );
    }
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
