import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { extname } from 'path';
import { IFileStorageService, UploadedFileInfo } from '../../domain/services/file-storage.interface';

@Injectable()
export class S3StorageService implements IFileStorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly bucket: string;
  private readonly region: string;
  private readonly cdnBase: string | undefined;
  private readonly client: S3Client;

  constructor(cfg: ConfigService) {
    this.bucket = cfg.get<string>('S3_BUCKET') ?? '';
    this.region = cfg.get<string>('S3_REGION') ?? 'us-east-1';
    this.cdnBase = cfg.get<string>('S3_CDN_BASE');

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: cfg.get<string>('S3_ACCESS_KEY_ID') ?? '',
        secretAccessKey: cfg.get<string>('S3_SECRET_ACCESS_KEY') ?? '',
      },
    });
  }

  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    folder = 'general',
  ): Promise<UploadedFileInfo> {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const key = `${folder}/${unique}${extname(file.originalname)}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.size,
      }),
    );

    return {
      key,
      url: await this.getUrl(key),
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getUrl(key: string): Promise<string> {
    if (this.cdnBase) return `${this.cdnBase.replace(/\/$/, '')}/${key}`;
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
