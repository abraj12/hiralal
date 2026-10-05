import path from 'path';
import crypto from 'crypto';
import { StorageProvider } from './storage.interface';
import { R2StorageProvider } from './r2.provider';
import { LocalStorageProvider } from './local.provider';
import { config } from '../../config';
import { sha256Hash } from '../../utils/crypto.utils';

export class StorageService {
  private static provider: StorageProvider | null = null;

  static getProvider(): StorageProvider {
    if (this.provider) return this.provider;

    const hasR2Credentials =
      Boolean(config.r2.accessKeyId) &&
      Boolean(config.r2.secretAccessKey) &&
      Boolean(config.r2.bucketName) &&
      Boolean(config.r2.endpoint);

    if (config.isProduction) {
      if (!hasR2Credentials) {
        throw new Error('[STORAGE ERROR] Cloudflare R2 credentials are required in production.');
      }
      this.provider = new R2StorageProvider();
      return this.provider;
    }

    if (hasR2Credentials && config.nodeEnv !== 'test') {
      try {
        this.provider = new R2StorageProvider();
        return this.provider;
      } catch (err) {
        console.warn('⚠️ Failed to initialize R2, falling back to local storage in development.');
      }
    }

    this.provider = new LocalStorageProvider();
    return this.provider;
  }

  static setProvider(customProvider: StorageProvider) {
    this.provider = customProvider;
  }

  /**
   * Validates file buffer against magic-byte signatures to prevent spoofing.
   */
  static validateMagicBytes(buffer: Buffer): { isValid: boolean; detectedMime?: string } {
    if (buffer.length < 4) return { isValid: false };

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { isValid: true, detectedMime: 'image/jpeg' };
    }

    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { isValid: true, detectedMime: 'image/png' };
    }

    // PDF: 25 50 44 46 (%PDF)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { isValid: true, detectedMime: 'application/pdf' };
    }

    // WEBP: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { isValid: true, detectedMime: 'image/webp' };
    }

    return { isValid: false };
  }

  /**
   * Validates document and computes SHA-256 hash.
   */
  static validateAndHashFile(params: {
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    maxSizeInMb?: number;
  }): { fileHash: string; normalizedMime: string; extension: string } {
    const maxSize = (params.maxSizeInMb || 10) * 1024 * 1024;
    if (params.buffer.length > maxSize) {
      throw new Error(`File size (${(params.buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 10MB.`);
    }

    const ext = path.extname(params.originalFilename).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    if (!allowedExtensions.includes(ext)) {
      throw new Error(`Invalid file extension '${ext}'. Allowed formats: JPG, JPEG, PNG, WEBP, PDF.`);
    }

    // Deep magic-byte inspection
    const magic = this.validateMagicBytes(params.buffer);
    if (!magic.isValid) {
      throw new Error('File contents do not match genuine JPEG, PNG, WEBP, or PDF file signatures.');
    }

    const fileHash = sha256Hash(params.buffer);
    return {
      fileHash,
      normalizedMime: magic.detectedMime || params.mimeType,
      extension: ext,
    };
  }

  static calculateFileHash(buffer: Buffer): string {
    return sha256Hash(buffer);
  }

  /**
   * Uploads invoice file using the active StorageProvider.
   * Path schema: bills/{userId}/{billId}/{uuid}{ext}
   */
  static async uploadInvoice(params: {
    userId: string;
    billId: string;
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
  }) {
    const { fileHash, normalizedMime, extension } = this.validateAndHashFile({
      buffer: params.buffer,
      originalFilename: params.originalFilename,
      mimeType: params.mimeType,
    });

    const randomSuffix = crypto.randomUUID();
    const key = `bills/${params.userId}/${params.billId}/${randomSuffix}${extension}`;

    const provider = this.getProvider();
    const uploadResult = await provider.upload({
      key,
      buffer: params.buffer,
      mimeType: normalizedMime,
    });

    return {
      ...uploadResult,
      fileHash,
    };
  }

  static async getSignedInvoiceUrl(key: string, expiresInSeconds = 1800): Promise<string> {
    const provider = this.getProvider();
    return await provider.getSignedUrl(key, expiresInSeconds);
  }

  /**
   * Generates time-limited HMAC-signed URL for document access.
   */
  static generateSignedUrl(fileKey?: string | null, expiresInMinutes: number = 30): string {
    if (!fileKey) return '';
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;
    const dataToSign = `${fileKey}:${expiresAt}`;
    const secret = config.jwt.accessSecret || 'hiralal_doc_secret';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(dataToSign)
      .digest('hex');

    const cleanKey = encodeURIComponent(fileKey);
    return `/api/bills/file?key=${cleanKey}&expires=${expiresAt}&sig=${signature}`;
  }

  /**
   * Validates signed URL HMAC and expiry.
   */
  static verifySignedUrl(fileKey: string, expires: number, signature: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    if (now > expires) {
      return false; // Expired
    }

    const dataToSign = `${fileKey}:${expires}`;
    const secret = config.jwt.accessSecret || 'hiralal_doc_secret';
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(dataToSign)
      .digest('hex');

    if (signature.length !== expectedSignature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  static getLocalFilePath(fileKey: string): string {
    const safeKey = fileKey.replace(/\//g, '_');
    return path.join(__dirname, '../../../../uploads', safeKey);
  }
}
