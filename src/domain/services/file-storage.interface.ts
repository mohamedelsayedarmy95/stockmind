export const FILE_STORAGE_TOKEN = Symbol('IFileStorageService');

export interface UploadedFileInfo {
  key: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface IFileStorageService {
  upload(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }, folder?: string): Promise<UploadedFileInfo>;

  delete(key: string): Promise<void>;

  getUrl(key: string): Promise<string>;
}
