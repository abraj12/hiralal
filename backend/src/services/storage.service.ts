import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export class StorageService {
  private static s3Client: S3Client | null = null;

  private static getS3Client(): S3Client | null {
    if (this.s3Client) return this.s3Client;

    if (config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.endpoint) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: config.r2.endpoint,
        credentials: {
          accessKeyId: config.r2.accessKeyId,
          secretAccessKey: config.r2.secretAccessKey,
        },
      });
      return this.s3Client;
    }
    return null;
  }

  /**
   * Computes SHA-256 hash of file buffer for tamper and duplicate detection.
   */
  static calculateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Uploads invoice file privately to Cloudflare R2 (or secure local vault if R2 credentials not configured).
   */
  static async uploadInvoiceFile(
    fileBuffer: Buffer,
    originalFilename: string,
    mimeType: string,
    userId: string
  ): Promise<{ fileKey: string; fileUrl: string; fileHash: string; fileSize: number }> {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedMimeTypes.includes(mimeType.toLowerCase())) {
      throw new Error('Invalid file type. Only JPEG, PNG, WEBP and PDF documents are permitted.');
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (fileBuffer.length > maxSize) {
      throw new Error('File size exceeds the maximum limit of 10MB.');
    }

    const fileHash = this.calculateFileHash(fileBuffer);
    const ext = path.extname(originalFilename) || '.jpg';
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    const fileKey = `invoices/${userId}/${timestamp}_${randomSuffix}${ext}`;
    const fileSize = fileBuffer.length;

    const s3 = this.getS3Client();

    if (s3 && config.r2.bucketName) {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.r2.bucketName,
            Key: fileKey,
            Body: fileBuffer,
            ContentType: mimeType,
          })
        );

        // Generate R2 Pre-signed URL valid for 30 minutes
        const getCommand = new GetObjectCommand({
          Bucket: config.r2.bucketName,
          Key: fileKey,
        });
        const fileUrl = await getSignedUrl(s3, getCommand, { expiresIn: 1800 });

        return { fileKey, fileUrl, fileHash, fileSize };
      } catch (err) {
        console.warn('⚠️ Cloudflare R2 upload failed, falling back to secure local storage vault:', err);
      }
    }

    // Secure local vault fallback with HMAC signed URL
    const fullPath = path.join(UPLOADS_DIR, path.basename(fileKey));
    fs.writeFileSync(fullPath, fileBuffer);
    const fileUrl = this.generateSignedUrl(fileKey, 60);

    return { fileKey, fileUrl, fileHash, fileSize };
  }

  /**
   * Generates time-limited HMAC-signed URL for private document access.
   */
  static generateSignedUrl(fileKey: string, expiresInMinutes: number = 30): string {
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
      return false;
    }

    const dataToSign = `${fileKey}:${expires}`;
    const expectedSignature = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(dataToSign)
      .digest('hex');

    if (signature.length !== expectedSignature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  static getLocalFilePath(fileKey: string): string {
    return path.join(UPLOADS_DIR, path.basename(fileKey));
  }
}
