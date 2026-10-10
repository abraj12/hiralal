/**
 * Cryptographic Backup Utility for Hiralal & Sons Platform
 * Authenticated Encryption (AES-256-GCM) with PBKDF2 & Legacy OpenSSL AES-256-CBC Fallback.
 * Platform: AWS EC2 t4g.medium (Graviton2 ARM64)
 */

const fs = require('fs');
const crypto = require('crypto');

const GCM_MAGIC = Buffer.from('GCM2026', 'utf8'); // 7 bytes
const OPENSSL_MAGIC = Buffer.from('Salted__', 'utf8'); // 8 bytes

function encryptBackupGcm(dataBuffer, passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('A secure passphrase is required for backup encryption.');
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([GCM_MAGIC, salt, iv, tag, encrypted]);
}

function decryptBackup(encryptedBuffer, passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Passphrase is required for backup decryption.');
  }

  // 1. Check for AES-256-GCM Authenticated Encryption
  if (encryptedBuffer.length >= 51 && encryptedBuffer.subarray(0, 7).equals(GCM_MAGIC)) {
    const salt = encryptedBuffer.subarray(7, 23);
    const iv = encryptedBuffer.subarray(23, 35);
    const tag = encryptedBuffer.subarray(35, 51);
    const ciphertext = encryptedBuffer.subarray(51);

    const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  // 2. Check for Legacy OpenSSL AES-256-CBC with PBKDF2
  if (encryptedBuffer.length >= 16 && encryptedBuffer.subarray(0, 8).equals(OPENSSL_MAGIC)) {
    const salt = encryptedBuffer.subarray(8, 16);
    const ciphertext = encryptedBuffer.subarray(16);

    const keyAndIv = crypto.pbkdf2Sync(passphrase, salt, 10000, 48, 'sha256');
    const key = keyAndIv.subarray(0, 32);
    const iv = keyAndIv.subarray(32, 48);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  throw new Error('Unknown or corrupted backup encryption header.');
}

module.exports = {
  encryptBackupGcm,
  decryptBackup,
  GCM_MAGIC,
  OPENSSL_MAGIC,
};

if (require.main === module) {
  const mode = process.argv[2];
  const inputFile = process.argv[3];
  const outputFile = process.argv[4];
  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE;

  if (!mode || !inputFile || !outputFile) {
    console.error('Usage: node crypto-backup.js <encrypt|decrypt> <inputFile> <outputFile>');
    process.exit(1);
  }

  if (!passphrase) {
    console.error('[FATAL] BACKUP_ENCRYPTION_PASSPHRASE environment variable is missing.');
    process.exit(1);
  }

  try {
    const inputBuffer = fs.readFileSync(inputFile);
    let outputBuffer;

    if (mode === 'encrypt') {
      outputBuffer = encryptBackupGcm(inputBuffer, passphrase);
    } else if (mode === 'decrypt') {
      outputBuffer = decryptBackup(inputBuffer, passphrase);
    } else {
      console.error(`Invalid mode: ${mode}. Must be 'encrypt' or 'decrypt'.`);
      process.exit(1);
    }

    fs.writeFileSync(outputFile, outputBuffer);
    process.exit(0);
  } catch (err) {
    console.error(`[CRYPTO-ERROR] ${err.message}`);
    process.exit(1);
  }
}
