import { Readable } from 'stream';

export interface UploadResult {
  fileKey: string;
  fileUrl: string;
  fileHash: string;
  fileSize: number;
  mimeType: string;
}

export interface StorageProvider {
  name: string;
  upload(params: {
    key: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<UploadResult>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  getStream(key: string): Promise<Readable>;
}
