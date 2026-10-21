/**
 * Cryptographic Backup Utility for Hiralal & Sons Platform
 * Authenticated Encryption (AES-256-GCM) with PBKDF2 & Legacy OpenSSL AES-256-CBC Fallback.
 * Platform: Hostinger KVM 2 VPS (Ubuntu x86_64)
 */

const fs = require('fs');
const crypto = require('crypto');

const GCM_MAGIC = Buffer.from('GCM2026', 'utf8'); // 7 bytes
const OPENSSL_MAGIC = Buffer.from('Salted__', 'utf8'); // 8 bytes

// VULN-CRYPTO-02: 600,000 iterations for PBKDF2 key derivation (OWASP/NIST SP 800-132 recommendation)
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

function encryptBackupGcm(dataBuffer, passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('A secure passphrase is required for backup encryption.');
  }
  if (passphrase.length < 16) {
    throw new Error('Passphrase must be at least 16 characters long for backup encryption.');
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');

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

    // Try current 600,000 iterations first, then fall back to legacy 100,000
    try {
      const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (gcmErr) {
      const key = crypto.pbkdf2Sync(passphrase, salt, LEGACY_PBKDF2_ITERATIONS, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
  }

  // 2. Check for Legacy OpenSSL AES-256-CBC with PBKDF2
  if (encryptedBuffer.length >= 16 && encryptedBuffer.subarray(0, 8).equals(OPENSSL_MAGIC)) {
    if (process.env.ALLOW_LEGACY_UNAUTHENTICATED_CBC_BACKUP !== 'true') {
      throw new Error(
        'Unauthenticated legacy AES-CBC backup rejected. Legacy CBC mode lacks cryptographic authentication and is vulnerable to padding oracle attacks. Set ALLOW_LEGACY_UNAUTHENTICATED_CBC_BACKUP=true to decrypt legacy archives, or migrate to AES-256-GCM.'
      );
    }
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
  const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE || process.env.BACKUP_ENCRYPTION_KEY;

  if (!mode || !inputFile || !outputFile) {
    console.error('Usage: node crypto-backup.js <encrypt|decrypt> <inputFile> <outputFile>');
    process.exit(1);
  }

  if (!passphrase || passphrase.length < 16) {
    console.error('[FATAL] BACKUP_ENCRYPTION_PASSPHRASE (or BACKUP_ENCRYPTION_KEY) must be at least 16 characters.');
    process.exit(1);
  }

  (async () => {
    try {
      if (mode === 'encrypt') {
        await encryptFileStream(inputFile, outputFile, passphrase);
      } else if (mode === 'decrypt') {
        await decryptFileStream(inputFile, outputFile, passphrase);
      } else {
        console.error(`Invalid mode: ${mode}. Must be 'encrypt' or 'decrypt'.`);
        process.exit(1);
      }
      process.exit(0);
    } catch (err) {
      console.error(`[CRYPTO-ERROR] ${err.message}`);
      process.exit(1);
    }
  })();
}

function encryptFileStream(inputFile, outputFile, passphrase) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const tempCipherPath = `${outputFile}.tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const inStream = fs.createReadStream(inputFile);
    const outStream = fs.createWriteStream(tempCipherPath);

    inStream.pipe(cipher).pipe(outStream);

    outStream.on('finish', () => {
      try {
        const tag = cipher.getAuthTag();
        const header = Buffer.concat([GCM_MAGIC, salt, iv, tag]);
        const finalFd = fs.openSync(outputFile, 'w');
        fs.writeSync(finalFd, header, 0, header.length, 0);

        const cipherFd = fs.openSync(tempCipherPath, 'r');
        const buf = Buffer.alloc(64 * 1024);
        let bytesRead = 0;
        let pos = header.length;
        while ((bytesRead = fs.readSync(cipherFd, buf, 0, buf.length, null)) > 0) {
          fs.writeSync(finalFd, buf, 0, bytesRead, pos);
          pos += bytesRead;
        }
        fs.closeSync(cipherFd);
        fs.closeSync(finalFd);
        try { fs.unlinkSync(tempCipherPath); } catch (_) {}
        resolve();
      } catch (err) {
        try { if (fs.existsSync(tempCipherPath)) fs.unlinkSync(tempCipherPath); } catch (_) {}
        reject(err);
      }
    });

    inStream.on('error', (err) => {
      try { if (fs.existsSync(tempCipherPath)) fs.unlinkSync(tempCipherPath); } catch (_) {}
      reject(err);
    });
    outStream.on('error', (err) => {
      try { if (fs.existsSync(tempCipherPath)) fs.unlinkSync(tempCipherPath); } catch (_) {}
      reject(err);
    });
  });
}

function decryptFileStream(inputFile, outputFile, passphrase) {
  return new Promise((resolve, reject) => {
    let tempOutputFile = null;
    try {
      const fd = fs.openSync(inputFile, 'r');
      const header = Buffer.alloc(51);
      const bytesRead = fs.readSync(fd, header, 0, 51, 0);
      fs.closeSync(fd);

      if (bytesRead >= 51 && header.subarray(0, 7).equals(GCM_MAGIC)) {
        const salt = header.subarray(7, 23);
        const iv = header.subarray(23, 35);
        const tag = header.subarray(35, 51);

        const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);

        tempOutputFile = `${outputFile}.tmp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const inStream = fs.createReadStream(inputFile, { start: 51 });
        const outStream = fs.createWriteStream(tempOutputFile);

        const cleanupOnError = (err) => {
          if (tempOutputFile && fs.existsSync(tempOutputFile)) {
            try { fs.unlinkSync(tempOutputFile); } catch (_) {}
          }
          reject(err);
        };

        inStream.pipe(decipher).pipe(outStream);

        outStream.on('finish', () => {
          try {
            fs.renameSync(tempOutputFile, outputFile);
            resolve();
          } catch (renameErr) {
            cleanupOnError(renameErr);
          }
        });
        decipher.on('error', cleanupOnError);
        inStream.on('error', cleanupOnError);
        outStream.on('error', cleanupOnError);
      } else {
        const inputBuffer = fs.readFileSync(inputFile);
        const outputBuffer = decryptBackup(inputBuffer, passphrase);
        fs.writeFileSync(outputFile, outputBuffer);
        resolve();
      }
    } catch (e) {
      if (tempOutputFile && fs.existsSync(tempOutputFile)) {
        try { fs.unlinkSync(tempOutputFile); } catch (_) {}
      }
      reject(e);
    }
  });
}
