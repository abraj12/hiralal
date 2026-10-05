import crypto from 'crypto';
import zlib from 'zlib';
import { prisma } from '../db';

describe('Phase 3 — Database Backup & Restore Cryptographic Integrity', () => {
  const PASSPHRASE = 'HiralalTestBackupSecretKey2026!#$';
  const WRONG_PASSPHRASE = 'WrongSecretKeyInvalid123';

  /**
   * Helper: Encrypt buffer with AES-256-CBC using PBKDF2 (identical to OpenSSL enc -aes-256-cbc -pbkdf2 -salt)
   */
  function encryptBackup(data: Buffer, pass: string): Buffer {
    const salt = crypto.randomBytes(8);
    const keyAndIv = crypto.pbkdf2Sync(pass, salt, 10000, 48, 'sha256');
    const key = keyAndIv.subarray(0, 32);
    const iv = keyAndIv.subarray(32, 48);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

    // OpenSSL header format: "Salted__" (8 bytes) + salt (8 bytes) + ciphertext
    return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, encrypted]);
  }

  /**
   * Helper: Decrypt buffer with AES-256-CBC using PBKDF2 (identical to OpenSSL enc -d -aes-256-cbc -pbkdf2)
   */
  function decryptBackup(encryptedPackage: Buffer, pass: string): Buffer {
    const magic = encryptedPackage.subarray(0, 8).toString('utf8');
    if (magic !== 'Salted__') {
      throw new Error('Invalid OpenSSL encrypted header');
    }

    const salt = encryptedPackage.subarray(8, 16);
    const ciphertext = encryptedPackage.subarray(16);

    const keyAndIv = crypto.pbkdf2Sync(pass, salt, 10000, 48, 'sha256');
    const key = keyAndIv.subarray(0, 32);
    const iv = keyAndIv.subarray(32, 48);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  it('verifies SQL dump compression, encryption, decryption, and decompression pipeline', async () => {
    // 1. Generate realistic SQL dump payload containing PostgreSQL schema and financial records
    const sampleSqlDump = `
      -- Hiralal & Sons Production Database Dump
      CREATE TABLE IF NOT EXISTS "User" (id TEXT PRIMARY KEY, mobile TEXT UNIQUE, "fullName" TEXT);
      CREATE TABLE IF NOT EXISTS "Wallet" (id TEXT PRIMARY KEY, "userId" TEXT, "availableBalance" NUMERIC(12,2));
      INSERT INTO "User" (id, mobile, "fullName") VALUES ('u1', '9876543210', 'Hiralal Master Plumber');
      INSERT INTO "Wallet" (id, "userId", "availableBalance") VALUES ('w1', 'u1', 5420.50);
      COMMIT;
    `;

    // 2. Compress via GZIP
    const compressedDump = zlib.gzipSync(Buffer.from(sampleSqlDump, 'utf8'));
    expect(compressedDump.length).toBeGreaterThan(0);

    // 3. Encrypt via AES-256-CBC with PBKDF2
    const encryptedBackup = encryptBackup(compressedDump, PASSPHRASE);
    expect(encryptedBackup.subarray(0, 8).toString('utf8')).toBe('Salted__');

    // 4. Verification: Decrypting with wrong passphrase MUST fail
    expect(() => {
      decryptBackup(encryptedBackup, WRONG_PASSPHRASE);
    }).toThrow();

    // 5. Decrypt with correct passphrase
    const decryptedDump = decryptBackup(encryptedBackup, PASSPHRASE);

    // 6. Decompress GZIP
    const restoredSql = zlib.gunzipSync(decryptedDump).toString('utf8');

    // 7. Data matches exactly
    expect(restoredSql).toBe(sampleSqlDump);
    expect(restoredSql).toContain('Hiralal Master Plumber');
    expect(restoredSql).toContain('5420.50');
  });

  it('verifies active database table schema presence and migration integrity', async () => {
    // Verify that primary tables exist and are queryable in active PostgreSQL
    const usersCount = await prisma.user.count();
    const walletsCount = await prisma.wallet.count();
    const poolsCount = await prisma.rewardPool.count();

    expect(typeof usersCount).toBe('number');
    expect(typeof walletsCount).toBe('number');
    expect(typeof poolsCount).toBe('number');

    // Verify Prisma migrations history table is intact
    const appliedMigrations: any = await prisma.$queryRaw`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC;
    `;
    expect(Array.isArray(appliedMigrations)).toBe(true);
    expect(appliedMigrations.length).toBeGreaterThan(0);
    expect(appliedMigrations[0].migration_name).toContain('init_production_schema');
  });
});
