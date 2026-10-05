/**
 * External Backup Upload Runner for Cloudflare R2 / AWS S3
 * Platform: AWS EC2 t4g.medium
 */
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

async function uploadBackup() {
  const localFile = process.argv[2];
  const remoteKey = process.argv[3];
  const bucketName = process.argv[4] || process.env.R2_BACKUP_BUCKET || process.env.R2_BUCKET_NAME;

  if (!localFile || !remoteKey || !bucketName) {
    console.error('Usage: node upload-backup.js <localFile> <remoteKey> <bucketName>');
    process.exit(1);
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    console.error('[ERROR] Missing R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT)');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  const fileStream = fs.createReadStream(localFile);
  const fileStats = fs.statSync(localFile);

  console.log(`[R2-BACKUP] Uploading ${localFile} (${(fileStats.size / (1024 * 1024)).toFixed(2)} MB) to ${bucketName}/${remoteKey}...`);

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: remoteKey,
      Body: fileStream,
      ContentType: 'application/octet-stream',
    })
  );

  console.log(`[R2-BACKUP] External backup successfully uploaded: ${remoteKey}`);
}

uploadBackup().catch((err) => {
  console.error('[R2-BACKUP-FAILED]', err.message);
  process.exit(1);
});
