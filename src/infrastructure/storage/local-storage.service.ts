import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { IFileStorageService, UploadedFileInfo } from '../../domain/services/file-storage.interface';

@Injectable()
export class LocalStorageService implements IFileStorageService {
  private readonly uploadDir: string;
  private readonly publicPath: string;

  constructor(cfg: ConfigService) {
    this.uploadDir = cfg.get<string>('UPLOAD_DIR') ?? './uploads';
    this.publicPath = cfg.get<string>('UPLOAD_PUBLIC_PATH') ?? '/uploads';
  }

  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    folder = 'general',
  ): Promise<UploadedFileInfo> {
    const dir = join(this.uploadDir, folder);
    await fs.mkdir(dir, { recursive: true });

    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const key = `${folder}/${unique}${extname(file.originalname)}`;
    const fullPath = join(this.uploadDir, key);

    await fs.writeFile(fullPath, file.buffer);

    return {
      key,
      url: `${this.publicPath}/${key}`,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.uploadDir, key);
    try {
      await fs.unlink(fullPath);
    } catch {
      // ignore if already gone
    }
  }

  async getUrl(key: string): Promise<string> {
    return `${this.publicPath}/${key}`;
  }
}
