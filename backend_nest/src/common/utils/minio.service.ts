// src/common/utils/minio.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private client: Minio.Client;
  private bucket: string;
  private readonly logger = new Logger('MinioService');

  constructor(private config: ConfigService) {}

  onModuleInit() {
    // 兼容 Python 格式的 endpoint（host:port），minio.js 需要分开传
    const rawEndpoint = this.config.get<string>('minio.endpoint')!;
    const secure = this.config.get<boolean>('minio.secure');
    const [host, portStr] = rawEndpoint.split(':');
    const port = portStr ? Number(portStr) : (secure ? 443 : 80);
    this.client = new Minio.Client({
      endPoint: host,
      port,
      useSSL: secure,
      accessKey: this.config.get<string>('minio.accessKey'),
      secretKey: this.config.get<string>('minio.secretKey'),
    });
    this.bucket = this.config.get<string>('minio.bucket')!;
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`创建存储桶: ${this.bucket}`);
    }
  }

  async uploadFile(objectName: string, data: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(this.bucket, objectName, data, data.length, { 'Content-Type': contentType });
  }

  async getPresignedUrl(objectName: string, expiresHours = 1): Promise<string> {
    await this.ensureBucket();
    return this.client.presignedGetObject(this.bucket, objectName, expiresHours * 3600);
  }

  async statObject(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, objectName);
      return true;
    } catch {
      return false;
    }
  }

  async downloadObject(objectName: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectName);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(objectName: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectName);
  }
}
