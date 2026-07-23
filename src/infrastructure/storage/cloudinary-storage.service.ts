import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { IFileStorageService, UploadedFileInfo } from '../../domain/services/file-storage.interface';

@Injectable()
export class CloudinaryStorageService implements IFileStorageService {
  private readonly logger = new Logger(CloudinaryStorageService.name);

  constructor(cfg: ConfigService) {
    cloudinary.config({
      cloud_name: cfg.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: cfg.get<string>('CLOUDINARY_API_KEY'),
      api_secret: cfg.get<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    folder = 'general',
  ): Promise<UploadedFileInfo> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto' },
        (err, result?: UploadApiResponse) => {
          if (err || !result) return reject(err ?? new Error('Cloudinary upload failed'));
          resolve({
            key: result.public_id,
            url: result.secure_url,
            size: result.bytes,
            mimeType: file.mimetype,
          });
        },
      );
      stream.end(file.buffer);
    });
  }

  async delete(key: string): Promise<void> {
    await cloudinary.uploader.destroy(key);
  }

  async getUrl(key: string): Promise<string> {
    return cloudinary.url(key, { secure: true });
  }
}
