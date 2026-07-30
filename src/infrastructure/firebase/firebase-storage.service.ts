import { Injectable, Logger } from '@nestjs/common';
import { getStorage, isFirebaseConfigured } from './firebase-admin';

@Injectable()
export class FirebaseStorageService {
  private readonly logger = new Logger(FirebaseStorageService.name);

  async uploadFile(
    file: Express.Multer.File,
    destination: string,
  ): Promise<string> {
    if (!isFirebaseConfigured() || !getStorage()) {
      this.logger.warn('Firebase Storage not configured');
      throw new Error('Firebase Storage not configured');
    }

    try {
      const bucket = getStorage().bucket();
      const blob = bucket.file(destination);
      const blobStream = blob.createWriteStream({
        resumable: false,
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', (error: Error) => {
          this.logger.error(`Unable to upload file: ${error}`);
          reject(error);
        });

        blobStream.on('finish', () => {
          // Make the file public
          blob.makePublic().then(() => {
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
            resolve(publicUrl);
          });
        });

        blobStream.end(file.buffer);
      });
    } catch (error) {
      this.logger.error(`Error uploading file: ${error}`);
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!isFirebaseConfigured() || !getStorage()) {
      this.logger.warn('Firebase Storage not configured');
      throw new Error('Firebase Storage not configured');
    }

    try {
      const bucket = getStorage().bucket();
      const file = bucket.file(filePath);
      await file.delete();
    } catch (error) {
      this.logger.error(`Error deleting file: ${error}`);
      throw error;
    }
  }
}
