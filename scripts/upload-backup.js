/**
 * External Backup Upload & Verification Runner for Cloudflare R2 / AWS S3
 * Platform: AWS EC2 t4g.medium (Graviton2 ARM64)
 * Client: HIRALAL AND SONS SALES PVT. LTD.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let S3Client, PutObjectCommand, HeadObjectCommand;
try {
  ({ S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3'));
} catch (e) {
  try {
    ({ S3Client, PutObjectCommand, HeadObjectCommand } = require(path.join(__dirname, '../backend/node_modules/@aws-sdk/client-s3')));
  } catch (err) {
    // Will be injected in unit tests or throw when client is instantiated
  }
}

async function uploadAndVerifyBackup(localFile, remoteKey, bucketName, injectedClient = null) {
  if (!localFile || !remoteKey || !bucketName) {
    throw new Error('Usage: uploadBackup(localFile, remoteKey, bucketName)');
  }

  if (!fs.existsSync(localFile)) {
    throw new Error(`Local backup file not found: ${localFile}`);
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error('Missing R2 credentials: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT are required.');
  }

  const client = injectedClient || new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  // 1. Calculate local size and SHA-256 hash
  const fileBuffer = fs.readFileSync(localFile);
  const fileStats = fs.statSync(localFile);
  const localSize = fileStats.size;
  const localSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  if (localSize === 0) {
    throw new Error(`Local backup file is empty (0 bytes): ${localFile}`);
  }

  console.log(`[R2-BACKUP] Preparing upload of ${localFile} (${(localSize / (1024 * 1024)).toFixed(2)} MB, SHA256: ${localSha256})`);
  console.log(`[R2-BACKUP] Target: s3://${bucketName}/${remoteKey}`);

  // 2. Upload file with SHA-256 metadata
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: remoteKey,
      Body: fileBuffer,
      ContentType: 'application/octet-stream',
      Metadata: {
        sha256: localSha256,
        original_filename: path.basename(localFile),
        backup_timestamp: new Date().toISOString(),
      },
    })
  );
  console.log(`[R2-BACKUP] Upload finished. Commencing remote verification...`);

  // 3. Remote Verification via HeadObject
  const headResult = await client.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: remoteKey,
    })
  );

  const remoteSize = headResult.ContentLength;
  if (!remoteSize || remoteSize === 0) {
    throw new Error(`Remote verification FAILED: Object exists but reported 0 bytes size.`);
  }

  if (remoteSize !== localSize) {
    throw new Error(`Remote verification FAILED: Size mismatch! Local: ${localSize} bytes vs Remote: ${remoteSize} bytes.`);
  }

  console.log(`[R2-BACKUP-VERIFIED] External backup verified successfully: s3://${bucketName}/${remoteKey} (Size: ${remoteSize} bytes, SHA256: ${localSha256})`);
  return {
    verified: true,
    bucket: bucketName,
    key: remoteKey,
    size: remoteSize,
    sha256: localSha256,
  };
}

module.exports = { uploadAndVerifyBackup };

if (require.main === module) {
  const localFile = process.argv[2];
  const remoteKey = process.argv[3];
  const bucketName = process.argv[4] || process.env.R2_BACKUP_BUCKET || process.env.R2_BUCKET_NAME;

  uploadAndVerifyBackup(localFile, remoteKey, bucketName)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[FATAL] ${err.message}`);
      process.exit(1);
    });
}
