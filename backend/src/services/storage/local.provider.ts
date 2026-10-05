import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { StorageProvider, UploadResult } from './storage.interface';
import { sha256Hash } from '../../utils/crypto.utils';

export class LocalStorageProvider implements StorageProvider {
  name = 'LOCAL_FILESYSTEM';
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(__dirname, '../../../../uploads');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFullPath(key: string): string {
    const safeKey = key.replace(/\//g, '_');
    return path.join(this.baseDir, safeKey);
  }

  async upload(params: { key: string; buffer: Buffer; mimeType: string }): Promise<UploadResult> {
    const fullPath = this.getFullPath(params.key);
    fs.writeFileSync(fullPath, params.buffer);
    const fileHash = sha256Hash(params.buffer);

    return {
      fileKey: params.key,
      fileUrl: `/uploads/${path.basename(fullPath)}`,
      fileHash,
      fileSize: params.buffer.length,
      mimeType: params.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    return fs.existsSync(fullPath);
  }

  async getSignedUrl(key: string): Promise<string> {
    const fullPath = this.getFullPath(key);
    return `/uploads/${path.basename(fullPath)}`;
  }

  async getStream(key: string): Promise<Readable> {
    const fullPath = this.getFullPath(key);
    return fs.createReadStream(fullPath);
  }
}
