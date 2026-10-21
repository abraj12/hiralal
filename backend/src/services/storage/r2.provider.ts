import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import path from 'path';
import { StorageProvider, UploadResult } from './storage.interface';
import { config } from '../../config';
import { sha256Hash } from '../../utils/crypto.utils';

export class R2StorageProvider implements StorageProvider {
  name = 'CLOUDFLARE_R2';
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.r2.bucketName;
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }

  async upload(params: { key: string; buffer: Buffer; mimeType: string }): Promise<UploadResult> {
    const fileHash = sha256Hash(params.buffer);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.buffer,
        ContentType: params.mimeType,
      })
    );

    const ttl = parseInt(process.env.R2_SIGNED_URL_TTL_SECONDS || '1800', 10);
    const signedUrl = await this.getSignedUrl(params.key, ttl);

    return {
      fileKey: params.key,
      fileUrl: signedUrl,
      fileHash,
      fileSize: params.buffer.length,
      mimeType: params.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async getSignedUrl(key: string, expiresInSeconds = parseInt(process.env.R2_SIGNED_URL_TTL_SECONDS || '1800', 10)): Promise<string> {
    const ext = path.extname(key).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.webp') {
      contentType = 'image/webp';
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `inline; filename="invoice${ext}"`,
    });
    return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
    return response.Body as Readable;
  }
}
