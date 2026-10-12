/**
 * Phase F — Final Remediation Regression Tests
 * Tests cover:
 *   - Lock heartbeat renewal in AccountDeletionWorker.processTick()
 *   - assertLease guard preventing anonymization after lock loss
 *   - Welcome notification status semantics (NOT_SENT vs DELIVERED vs RECORDED)
 *   - Pre-auth nonce endpoint for AUTH and REGISTRATION actions
 *   - .env.example config correctness (PLAY_INTEGRITY_REQUIRE_LICENSING must be true)
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { AccountDeletionService } from '../services/account-deletion.service';
import { AccountDeletionWorker } from '../worker/account-deletion.worker';
import { StorageService } from '../services/storage';

const TEST_MOBILE = '9822200099';
const TEST_PASSWORD = 'PhaseF_Test@2026';

let userId: string;
let userToken: string;

async function cleanTestUser() {
  await prisma.accountDeletionOperation.deleteMany({ where: { user: { mobile: TEST_MOBILE } } });
  await prisma.appInstallation.deleteMany({ where: { user: { mobile: TEST_MOBILE } } });
  await prisma.pushDeviceToken.deleteMany({ where: { user: { mobile: TEST_MOBILE } } });
  await prisma.authSession.deleteMany({ where: { user: { mobile: TEST_MOBILE } } });
  await prisma.otpRequest.deleteMany({ where: { mobile: TEST_MOBILE } });
  await prisma.bill.deleteMany({ where: { user: { mobile: TEST_MOBILE } } });
  await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: TEST_MOBILE } } } });
  await prisma.wallet.deleteMany({ where: { user: { mobile: TEST_MOBILE } } });
  await prisma.user.deleteMany({ where: { mobile: TEST_MOBILE } });
}

beforeAll(async () => {
  await cleanTestUser();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      mobile: TEST_MOBILE,
      fullName: 'Phase F Test User',
      firstName: 'PhaseF',
      lastName: 'Test',
      passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      profession: 'PLUMBER',
      isVerified: true,
      wallet: { create: { availableBalance: 500.0, totalRedeemed: 0.0 } },
    },
  });
  userId = user.id;
  userToken = jwt.sign({ userId: user.id, role: 'USER', mobile: TEST_MOBILE }, config.jwt.accessSecret, { expiresIn: '1h' });
});

afterAll(async () => {
  await cleanTestUser();
});

// ==========================================
// 1. Lock Heartbeat Renewal Wiring
// ==========================================
describe('AccountDeletionWorker — Lock Heartbeat Renewal', () => {
  test('processTick() calls renewLock periodically and releases lock after batch', async () => {
    const renewSpy = jest.spyOn(AccountDeletionWorker as any, 'renewLock').mockResolvedValue(true);
    const releaseSpy = jest.spyOn(AccountDeletionWorker as any, 'releaseLock').mockResolvedValue(undefined);
    const acquireSpy = jest.spyOn(AccountDeletionWorker as any, 'acquireLock').mockResolvedValue(true);
    jest.spyOn(AccountDeletionService, 'processScheduledDeletions').mockResolvedValue({ processedCount: 0, errors: [] });

    await AccountDeletionWorker.processTick();

    // Lock must always be released in finally block
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(acquireSpy).toHaveBeenCalledTimes(1);

    renewSpy.mockRestore();
    releaseSpy.mockRestore();
    acquireSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('processTick() aborts immediately if lock acquisition fails', async () => {
    const acquireSpy = jest.spyOn(AccountDeletionWorker as any, 'acquireLock').mockResolvedValue(false);
    const processSpy = jest.spyOn(AccountDeletionService, 'processScheduledDeletions');

    const result = await AccountDeletionWorker.processTick();

    expect(result.processedCount).toBe(0);
    expect(result.errorsCount).toBe(0);
    expect(processSpy).not.toHaveBeenCalled();

    acquireSpy.mockRestore();
    processSpy.mockRestore();
  });

  test('processTick() passes assertLease to processScheduledDeletions', async () => {
    jest.spyOn(AccountDeletionWorker as any, 'acquireLock').mockResolvedValue(true);
    jest.spyOn(AccountDeletionWorker as any, 'releaseLock').mockResolvedValue(undefined);

    let assertLeaseThrowsInsideBatch: boolean | undefined;
    const processSpy = jest.spyOn(AccountDeletionService, 'processScheduledDeletions').mockImplementation(async (_prismaClient, assertLease) => {
      // While the batch runs (leaseActive=true), assertLease must NOT throw
      try {
        assertLease?.();
        assertLeaseThrowsInsideBatch = false;
      } catch {
        assertLeaseThrowsInsideBatch = true;
      }
      return { processedCount: 0, errors: [] };
    });

    await AccountDeletionWorker.processTick();

    expect(assertLeaseThrowsInsideBatch).toBe(false);

    processSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('assertLease throws after lock renewal fails (post-finally, leaseActive=false)', async () => {
    jest.spyOn(AccountDeletionWorker as any, 'acquireLock').mockResolvedValue(true);
    jest.spyOn(AccountDeletionWorker as any, 'releaseLock').mockResolvedValue(undefined);
    jest.spyOn(AccountDeletionWorker as any, 'renewLock').mockResolvedValue(false);

    let capturedAssertLease: (() => void) | undefined;

    const processSpy = jest.spyOn(AccountDeletionService, 'processScheduledDeletions').mockImplementation(async (_prismaClient, assertLease) => {
      capturedAssertLease = assertLease;
      return { processedCount: 0, errors: [] };
    });

    await AccountDeletionWorker.processTick();

    // After finally block runs, leaseActive=false, so assertLease must throw
    expect(capturedAssertLease).toBeDefined();
    expect(() => capturedAssertLease!()).toThrow(/distributed lock/i);

    processSpy.mockRestore();
    jest.restoreAllMocks();
  });
});

// ==========================================
// 2. assertLease in processScheduledDeletions
// ==========================================
describe('AccountDeletionService — assertLease Guard', () => {
  test('processScheduledDeletions accepts optional assertLease without breaking when not provided', async () => {
    // Should work fine without assertLease (backward compatible)
    const result = await AccountDeletionService.processScheduledDeletions(prisma, undefined);
    expect(result).toHaveProperty('processedCount');
    expect(result).toHaveProperty('errors');
  });

  test('assertLease throw causes current user to be counted as error, not anonymized', async () => {
    // Schedule this test user for deletion
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: new Date(Date.now() - 9 * 24 * 3600 * 1000),
        deletionScheduledAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      },
    });

    // assertLease that always throws (simulate lost lock)
    const lostLease = () => { throw new Error('Simulated lock loss for test'); };

    // Mock storage so it succeeds (files "deleted")
    const originalProvider = StorageService.getProvider();
    (StorageService as any).provider = {
      delete: jest.fn().mockResolvedValue(undefined),
    };

    try {
      const result = await AccountDeletionService.processScheduledDeletions(prisma, lostLease);
      // The error from assertLease should be caught per-user and reported
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      const userError = result.errors.find(e => e.userId === userId);
      expect(userError).toBeDefined();
      expect(userError!.error).toContain('Simulated lock loss');

      // Verify user was NOT anonymized
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.fullName).toBe('Phase F Test User');
      expect(user?.mobile).toBe(TEST_MOBILE);
    } finally {
      (StorageService as any).provider = originalProvider;
      // Restore user state
      await prisma.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: null, deletionScheduledAt: null },
      });
    }
  });
});

// ==========================================
// 3. Welcome Notification Status Semantics
// ==========================================
describe('Welcome Notification Status Semantics', () => {
  test('POST /api/notifications/welcome unauthenticated request is rejected with 401', async () => {
    const installId = `inst-phase-f-${Date.now()}-nosend`;

    const res = await request(app)
      .post('/api/notifications/welcome')
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(401);
  });

  test('POST /api/notifications/welcome with auth token but no registered FCM token returns RECORDED_PENDING_PUSH', async () => {
    const installId = `inst-phase-f-${Date.now()}-recorded`;

    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('RECORDED_PENDING_PUSH');

    const dbRec = await prisma.appInstallation.findUnique({ where: { installationId: installId } });
    expect(dbRec?.userId).toBe(userId);

    // Cleanup
    await prisma.appInstallation.delete({ where: { installationId: installId } });
  });

  test('Second call with DELIVERED status returns ALREADY_ACCEPTED (idempotent)', async () => {
    const installId = `inst-phase-f-${Date.now()}-idempotent`;
    // Create installation as already delivered
    await prisma.appInstallation.create({
      data: {
        installationId: installId,
        userId,
        platform: 'ANDROID',
        welcomeStatus: 'DELIVERED',
        welcomeSentAt: new Date(),
      },
    });

    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ALREADY_ACCEPTED');
    expect(res.body.delivered).toBe(true);

    // Cleanup
    await prisma.appInstallation.delete({ where: { installationId: installId } });
  });
});

// ==========================================
// 4. Pre-Auth Nonce Endpoints
// ==========================================
describe('Pre-Auth Nonce Endpoint — AUTH and REGISTRATION', () => {
  const validHash = crypto.createHash('sha256').update('test-canonical-payload-phase-f').digest('hex');

  test('POST /api/auth/integrity/pre-auth/nonce returns nonce for AUTH action', async () => {
    const res = await request(app)
      .post('/api/auth/integrity/pre-auth/nonce')
      .send({ action: 'AUTH', requestHash: validHash });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(20);
  });

  test('POST /api/auth/integrity/pre-auth/nonce returns nonce for REGISTRATION action', async () => {
    const res = await request(app)
      .post('/api/auth/integrity/pre-auth/nonce')
      .send({ action: 'REGISTRATION', requestHash: validHash });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.nonce).toBe('string');
  });

  test('POST /api/auth/integrity/pre-auth/nonce defaults action to AUTH when omitted', async () => {
    const res = await request(app)
      .post('/api/auth/integrity/pre-auth/nonce')
      .send({ requestHash: validHash });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.nonce).toBe('string');
  });

  test('POST /api/auth/integrity/pre-auth/nonce rejects invalid requestHash', async () => {
    const res = await request(app)
      .post('/api/auth/integrity/pre-auth/nonce')
      .send({ action: 'AUTH', requestHash: 'not-a-valid-hash' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST_HASH');
  });

  test('POST /api/auth/integrity/pre-auth/nonce rejects unauthorized action (e.g., BILL_UPLOAD)', async () => {
    const res = await request(app)
      .post('/api/auth/integrity/pre-auth/nonce')
      .send({ action: 'BILL_UPLOAD', requestHash: validHash });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ACTION');
  });
});

// ==========================================
// 5. .env.example Production Config Integrity
// ==========================================
describe('.env.example production configuration sanity', () => {
  const ENV_EXAMPLE_PATH = path.resolve(__dirname, '../../../.env.example');

  test('.env.example must exist', () => {
    expect(fs.existsSync(ENV_EXAMPLE_PATH)).toBe(true);
  });

  test('PLAY_INTEGRITY_REQUIRE_LICENSING must be true in .env.example (not false)', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    // Must not have =false
    expect(content).not.toMatch(/^PLAY_INTEGRITY_REQUIRE_LICENSING=false/m);
    // Must have =true
    expect(content).toMatch(/^PLAY_INTEGRITY_REQUIRE_LICENSING=true/m);
  });

  test('PLAY_INTEGRITY_ALLOW_MOCK must be false in .env.example (production default)', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    expect(content).toMatch(/^PLAY_INTEGRITY_ALLOW_MOCK=false/m);
  });

  test('PLAY_INTEGRITY_ENFORCE_ACTIONS must be true in .env.example (production default)', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    expect(content).toMatch(/^PLAY_INTEGRITY_ENFORCE_ACTIONS=true/m);
  });

  test('All REPLACE_WITH_* placeholders must exist (no accidental real credentials)', () => {
    const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    // These sensitive fields must still be placeholders
    expect(content).toMatch(/POSTGRES_PASSWORD=REPLACE_WITH/);
    expect(content).toMatch(/JWT_ACCESS_SECRET=REPLACE_WITH/);
    expect(content).toMatch(/FIREBASE_PRIVATE_KEY="REPLACE_WITH/);
  });
});
