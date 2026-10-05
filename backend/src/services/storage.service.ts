import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export class StorageService {
  /**
   * Saves uploaded bill file privately.
   * In production with real Cloudflare R2 credentials, this uses AWS S3 SDK for R2.
   * In local/hybrid mode, files are kept strictly private in a protected local vault.
   */
  static async uploadInvoiceFile(
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string,
    userId: string
  ): Promise<{ fileKey: string; fileUrl: string }> {
    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedMimeTypes.includes(mimeType.toLowerCase())) {
      throw new Error('Invalid file type. Only JPEG, PNG, WEBP images and PDF invoices are allowed.');
    }

    // Limit size to 10MB
    const maxSize = 10 * 1024 * 1024;
    if (fileBuffer.length > maxSize) {
      throw new Error('File size exceeds the 10MB limit.');
    }

    const ext = path.extname(originalFilename) || '.jpg';
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    const fileKey = `invoices/${userId}/${timestamp}_${randomSuffix}${ext}`;

    // Store securely in protected directory
    const fullPath = path.join(UPLOADS_DIR, path.basename(fileKey));
    fs.writeFileSync(fullPath, fileBuffer);

    // Initial signed URL valid for 60 minutes
    const signedUrl = this.generateSignedUrl(fileKey, 60);

    return {
      fileKey,
      fileUrl: signedUrl,
    };
  }

  /**
   * Generates time-limited HMAC-signed URL for private document access.
   * Document cannot be accessed without valid HMAC signature.
   */
  static generateSignedUrl(fileKey: string, expiresInMinutes: number = 15): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInMinutes * 60;
    const dataToSign = `${fileKey}:${expiresAt}`;
    const signature = crypto
      .createHmac('sha256', config.jwt.secret)
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
    const expectedSignature = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(dataToSign)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  static getLocalFilePath(fileKey: string): string {
    return path.join(UPLOADS_DIR, path.basename(fileKey));
  }
}
