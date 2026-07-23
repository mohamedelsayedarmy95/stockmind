import { Module, Global, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FILE_STORAGE_TOKEN } from '../domain/services/file-storage.interface';
import { LocalStorageService } from '../infrastructure/storage/local-storage.service';
import { S3StorageService } from '../infrastructure/storage/s3-storage.service';
import { CloudinaryStorageService } from '../infrastructure/storage/cloudinary-storage.service';

const storageProvider: Provider = {
  provide: FILE_STORAGE_TOKEN,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => {
    const driver = (cfg.get<string>('STORAGE_DRIVER') ?? 'local').toLowerCase();
    switch (driver) {
      case 's3': return new S3StorageService(cfg);
      case 'cloudinary': return new CloudinaryStorageService(cfg);
      case 'local':
      default: return new LocalStorageService(cfg);
    }
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [storageProvider, LocalStorageService, S3StorageService, CloudinaryStorageService],
  exports: [FILE_STORAGE_TOKEN],
})
export class StorageModule {}
