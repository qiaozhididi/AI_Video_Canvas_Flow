// src/common/utils/minio.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private client: Minio.Client;
  private bucket: string;
  private readonly logger = new Logger('MinioService');
  // M14: lazy once 模式，缓存 ensureBucket 的 Promise，避免每次上传/下载都做 bucketExists 网络请求
  private bucketReadyPromise: Promise<void> | null = null;

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
    // M14: 模块初始化时触发一次 ensureBucket（不 await，不阻塞启动），后续方法调用复用同一 Promise
    this.ensureBucket().catch(err => {
      this.logger.error(`MinIO bucket 初始化失败: ${err.message}`);
    });
  }

  async ensureBucket(): Promise<void> {
    // M14: 复用已启动的初始化 Promise 避免并发重复执行；失败时清空允许下次重试
    if (!this.bucketReadyPromise) {
      this.bucketReadyPromise = (async () => {
        const exists = await this.client.bucketExists(this.bucket);
        if (!exists) {
          await this.client.makeBucket(this.bucket);
          this.logger.log(`创建存储桶: ${this.bucket}`);
        }
      })().catch(err => {
        this.bucketReadyPromise = null;
        throw err;
      });
    }
    return this.bucketReadyPromise;
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
