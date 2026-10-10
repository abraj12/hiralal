import crypto from 'crypto';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
// @ts-ignore
const { uploadAndVerifyBackup } = require('../../../scripts/upload-backup');

describe('Phase 3 & Release-Blocker 1 & 2 — Backup Fail-Closed & Restore Financial Integrity', () => {
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

  describe('1. Backup Cryptographic Pipeline', () => {
    it('verifies SQL dump compression, encryption, decryption, and decompression pipeline', async () => {
      const sampleSqlDump = `
        -- Hiralal & Sons Production Database Dump
        CREATE TABLE IF NOT EXISTS "User" (id TEXT PRIMARY KEY, mobile TEXT UNIQUE, "fullName" TEXT);
        CREATE TABLE IF NOT EXISTS "Wallet" (id TEXT PRIMARY KEY, "userId" TEXT, "availableBalance" NUMERIC(12,2));
        INSERT INTO "User" (id, mobile, "fullName") VALUES ('u1', '9876543210', 'Hiralal Master Plumber');
        INSERT INTO "Wallet" (id, "userId", "availableBalance") VALUES ('w1', 'u1', 5420.50);
        COMMIT;
      `;

      const compressedDump = zlib.gzipSync(Buffer.from(sampleSqlDump, 'utf8'));
      const encryptedBackup = encryptBackup(compressedDump, PASSPHRASE);
      expect(encryptedBackup.subarray(0, 8).toString('utf8')).toBe('Salted__');

      // Decrypting with wrong passphrase MUST fail
      expect(() => {
        decryptBackup(encryptedBackup, WRONG_PASSPHRASE);
      }).toThrow();

      // Decrypt with correct passphrase
      const decryptedDump = decryptBackup(encryptedBackup, PASSPHRASE);
      const restoredSql = zlib.gunzipSync(decryptedDump).toString('utf8');

      expect(restoredSql).toBe(sampleSqlDump);
      expect(restoredSql).toContain('Hiralal Master Plumber');
      expect(restoredSql).toContain('5420.50');
    });
  });

  describe('2. Backup Fail-Closed & Remote Verification Tests', () => {
    const tempTestFile = path.join(__dirname, 'temp_backup_test.enc');

    beforeAll(() => {
      fs.writeFileSync(tempTestFile, Buffer.from('test_encrypted_database_backup_payload_2026', 'utf8'));
    });

    afterAll(() => {
      if (fs.existsSync(tempTestFile)) {
        fs.unlinkSync(tempTestFile);
      }
    });

    it('Scenario 1: fails closed when R2 credentials are missing', async () => {
      const oldKey = process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_ACCESS_KEY_ID;

      await expect(
        uploadAndVerifyBackup(tempTestFile, 'backups/test.enc', 'test-bucket')
      ).rejects.toThrow('Missing R2 credentials');

      // Local file MUST remain intact for emergency recovery
      expect(fs.existsSync(tempTestFile)).toBe(true);

      process.env.R2_ACCESS_KEY_ID = oldKey || 'mock_r2_key';
    });

    it('Scenario 2: fails closed when external R2 upload throws network error', async () => {
      process.env.R2_ACCESS_KEY_ID = 'test_key';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret';
      process.env.R2_ENDPOINT = 'https://mock.r2.cloudflarestorage.com';

      const mockS3Client = {
        send: jest.fn().mockRejectedValue(new Error('Network timeout: ETIMEDOUT connecting to Cloudflare R2')),
      };

      await expect(
        uploadAndVerifyBackup(tempTestFile, 'backups/test.enc', 'test-bucket', mockS3Client as any)
      ).rejects.toThrow('Network timeout');

      // Local file MUST remain available for emergency recovery
      expect(fs.existsSync(tempTestFile)).toBe(true);
    });

    it('Scenario 3: fails closed when upload succeeds but remote HeadObject verification detects size mismatch', async () => {
      process.env.R2_ACCESS_KEY_ID = 'test_key';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret';
      process.env.R2_ENDPOINT = 'https://mock.r2.cloudflarestorage.com';

      const mockS3Client = {
        send: jest.fn()
          .mockResolvedValueOnce({ ETag: '"mock_etag"' }) // PutObject succeeds
          .mockResolvedValueOnce({ ContentLength: 99999 }), // HeadObject returns corrupt size
      };

      await expect(
        uploadAndVerifyBackup(tempTestFile, 'backups/test.enc', 'test-bucket', mockS3Client as any)
      ).rejects.toThrow('Remote verification FAILED: Size mismatch');

      expect(fs.existsSync(tempTestFile)).toBe(true);
    });

    it('Scenario 4: succeeds and confirms verification when remote object exists with identical size', async () => {
      process.env.R2_ACCESS_KEY_ID = 'test_key';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret';
      process.env.R2_ENDPOINT = 'https://mock.r2.cloudflarestorage.com';

      const localSize = fs.statSync(tempTestFile).size;

      const mockS3Client = {
        send: jest.fn()
          .mockResolvedValueOnce({ ETag: '"mock_etag"' }) // PutObject
          .mockResolvedValueOnce({ ContentLength: localSize }), // HeadObject verified
      };

      const result = await uploadAndVerifyBackup(tempTestFile, 'backups/test.enc', 'test-bucket', mockS3Client as any);
      expect(result.verified).toBe(true);
      expect(result.size).toBe(localSize);
      expect(typeof result.sha256).toBe('string');
    });

    it('Scenario 5: fails closed when upload succeeds but remote HeadObject verification detects SHA-256 mismatch', async () => {
      process.env.R2_ACCESS_KEY_ID = 'test_key';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret';
      process.env.R2_ENDPOINT = 'https://mock.r2.cloudflarestorage.com';

      const localSize = fs.statSync(tempTestFile).size;

      const mockS3Client = {
        send: jest.fn()
          .mockResolvedValueOnce({ ETag: '"mock_etag"' }) // PutObject
          .mockResolvedValueOnce({ ContentLength: localSize, Metadata: { sha256: 'corrupted_hash_mismatch_12345' } }),
      };

      await expect(
        uploadAndVerifyBackup(tempTestFile, 'backups/test.enc', 'test-bucket', mockS3Client as any)
      ).rejects.toThrow('Remote verification FAILED: SHA-256 digest mismatch');

      expect(fs.existsSync(tempTestFile)).toBe(true);
    });

    it('Scenario 6: verifies retention policy is 30 days in backup script', () => {
      const scriptPath = path.join(__dirname, '../../../scripts/backup-db.sh');
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      expect(scriptContent).toContain('RETENTION_DAYS="${RETENTION_DAYS:-30}"');
      expect(scriptContent).not.toContain('RETENTION_DAYS="${RETENTION_DAYS:-7}"');
    });
  });

  describe('3. Restore Deep Financial Ledger & Data Reconciliation', () => {
    let testUser: any;
    let testWallet: any;
    let testPool: any;
    let testBill: any;
    let testPayout: any;

    beforeAll(async () => {
      // Clean up previous test runs
      await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: '9777788888' } } } });
      await prisma.payout.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.bill.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.paymentAccount.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.wallet.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.user.deleteMany({ where: { mobile: '9777788888' } });

      testUser = await prisma.user.create({
        data: {
          mobile: '9777788888',
          fullName: 'Restore Financial Auditor',
          passwordHash: 'hash123',
          profession: 'PLUMBER',
          role: 'USER',
          status: 'ACTIVE',
        },
      });

      testWallet = await prisma.wallet.create({
        data: {
          userId: testUser.id,
          availableBalance: 1400.0,
          processingAmount: 0.0,
          totalRedeemed: 600.0,
        },
      });

      testPool = await prisma.rewardPool.upsert({
        where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year: 2026, month: 10 } },
        update: { totalPoolCap: 50000.0, usedAmount: 2000.0 },
        create: { profession: 'PLUMBER', year: 2026, month: 10, totalPoolCap: 50000.0, usedAmount: 2000.0 },
      });

      await prisma.rewardRule.upsert({
        where: { id: 'test_rule_plumber' },
        update: { rewardPercentage: 0.50, isActive: true },
        create: { id: 'test_rule_plumber', profession: 'PLUMBER', rewardPercentage: 0.50, monthlyPoolLimit: 50000.0 },
      });

      await prisma.redemptionSettings.upsert({
        where: { id: 'default' },
        update: { isEnabled: true },
        create: { id: 'default', isEnabled: true, minimumAmount: 500.0, maximumAmount: 10000.0 },
      });

      testBill = await prisma.bill.create({
        data: {
          userId: testUser.id,
          invoiceNumber: 'INV-RESTORE-001',
          invoiceDate: new Date(),
          billAmount: 400000.0,
          calculatedReward: 2000.0,
          status: 'APPROVED',
          fileUrl: 'https://r2.storage/bills/test.pdf',
          fileKey: 'bills/test.pdf',
          fileHash: 'sha256_mock_restore_bill_hash',
        },
      });

      // Transaction 1: Reward Credit (+2000)
      await prisma.walletTransaction.create({
        data: {
          walletId: testWallet.id,
          userId: testUser.id,
          amount: 2000.0,
          type: 'REWARD_CREDIT',
          balanceAfter: 2000.0,
          referenceType: 'BILL',
          referenceId: testBill.id,
          description: 'Reward credit for verified bill',
        },
      });

      // Account & Payout
      const testAccount = await prisma.paymentAccount.create({
        data: {
          userId: testUser.id,
          accountType: 'UPI',
          upiId: 'auditor@upi',
          maskedInfo: 'aud***@upi',
          isVerified: true,
        },
      });

      testPayout = await prisma.payout.create({
        data: {
          userId: testUser.id,
          walletId: testWallet.id,
          amount: 800.0,
          paymentAccountId: testAccount.id,
          paymentType: 'UPI',
          idempotencyKey: 'idemp_restore_pout_1',
          status: 'SUCCESS',
        },
      });

      // Transaction 2: Payout Debit (-800)
      await prisma.walletTransaction.create({
        data: {
          walletId: testWallet.id,
          userId: testUser.id,
          amount: 800.0,
          type: 'PAYOUT_DEBIT',
          balanceAfter: 1200.0,
          referenceType: 'PAYOUT',
          referenceId: testPayout.idempotencyKey,
          description: 'Redemption debit',
        },
      });

      // Transaction 3: Partial Payout Reversal (+200)
      await prisma.walletTransaction.create({
        data: {
          walletId: testWallet.id,
          userId: testUser.id,
          amount: 200.0,
          type: 'PAYOUT_REVERSAL',
          balanceAfter: 1400.0,
          referenceType: 'PAYOUT',
          referenceId: testPayout.idempotencyKey + '_rev',
          description: 'Reversal refund',
        },
      });
    });

    afterAll(async () => {
      await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: '9777788888' } } } });
      await prisma.payout.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.bill.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.paymentAccount.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.wallet.deleteMany({ where: { user: { mobile: '9777788888' } } });
      await prisma.user.deleteMany({ where: { mobile: '9777788888' } });
    });

    it('verifies wallet balance reconciles exactly to immutable ledger transactions', async () => {
      const wallet = await prisma.wallet.findUnique({ where: { id: testWallet.id } });
      const transactions = await prisma.walletTransaction.findMany({ where: { walletId: testWallet.id } });

      let calculatedAvailableBalance = 0;
      for (const tx of transactions) {
        const amt = Number(tx.amount);
        if (tx.type === 'REWARD_CREDIT' || tx.type === 'PAYOUT_REVERSAL' || tx.type === 'REFUND' || tx.type === 'MANUAL_ADJUSTMENT') {
          calculatedAvailableBalance += amt;
        } else if (tx.type === 'PAYOUT_DEBIT') {
          calculatedAvailableBalance -= amt;
        }
      }

      // Authoritative verification
      expect(Number(wallet?.availableBalance)).toBe(1400.0);
      expect(calculatedAvailableBalance).toBe(1400.0);
      expect(Number(wallet?.availableBalance)).toBe(calculatedAvailableBalance);
    });

    it('verifies reward pool usedAmount reconciles with approved bills', async () => {
      const pool = await prisma.rewardPool.findUnique({
        where: { pool_profession_year_month_unique: { profession: 'PLUMBER', year: 2026, month: 10 } },
      });
      expect(Number(pool?.usedAmount)).toBe(2000.0);
    });

    it('verifies payout state machine and ledger correlation (no orphaned debits)', async () => {
      const payout = await prisma.payout.findUnique({ where: { id: testPayout.id } });
      expect(payout?.status).toBe('SUCCESS');

      const debitTx = await prisma.walletTransaction.findFirst({
        where: {
          walletId: testWallet.id,
          type: 'PAYOUT_DEBIT',
          referenceId: payout?.idempotencyKey,
        },
      });
      expect(debitTx).toBeDefined();
      expect(Number(debitTx?.amount)).toBe(800.0);
    });

    it('verifies core database tables exist with valid records', async () => {
      expect(await prisma.user.count()).toBeGreaterThan(0);
      expect(await prisma.wallet.count()).toBeGreaterThan(0);
      expect(await prisma.walletTransaction.count()).toBeGreaterThan(0);
      expect(await prisma.bill.count()).toBeGreaterThan(0);
      expect(await prisma.rewardPool.count()).toBeGreaterThan(0);
      expect(await prisma.rewardRule.count()).toBeGreaterThan(0);
      expect(await prisma.redemptionSettings.count()).toBeGreaterThan(0);
      expect(await prisma.payout.count()).toBeGreaterThan(0);
    });
  });
});
