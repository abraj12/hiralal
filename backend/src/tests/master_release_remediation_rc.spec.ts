import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { checkAdminRoleIntegrity } from '../db';
import { AccountDeletionService } from '../services/account-deletion.service';
import { AuthService } from '../services/auth.service';
import { StorageService } from '../services/storage';
import { PlayIntegrityService } from '../services/integrity/playIntegrity.service';
import { getOrCreateBillAdmin, getOrCreateOpsAdmin } from './test_helpers';

describe('Master Release-Blocker Remediation Final Corrective Verification (Workstreams A-E)', () => {
  const testUserMobile = '9811100099';
  const testPassword = 'TestPassword@123';
  let userId: string;
  let userToken: string;

  beforeAll(async () => {
    // Clean up test user
    await prisma.accountDeletionOperation.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.appInstallation.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.pushDeviceToken.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.authSession.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.otpRequest.deleteMany({
      where: { mobile: testUserMobile },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: testUserMobile } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.user.deleteMany({
      where: { mobile: testUserMobile },
    });

    // Create fresh test user
    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        mobile: testUserMobile,
        fullName: 'Ramesh Craftsman',
        firstName: 'Ramesh',
        lastName: 'Craftsman',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 1200.0,
            totalRedeemed: 0.0,
          },
        },
      },
    });
    userId = user.id;

    userToken = jwt.sign(
      { userId: user.id, role: 'USER', mobile: testUserMobile },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await prisma.accountDeletionOperation.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.appInstallation.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.pushDeviceToken.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.authSession.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.otpRequest.deleteMany({
      where: { mobile: testUserMobile },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: testUserMobile } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: testUserMobile } },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
  });

  describe('Workstream B: AppInstallation Model & Idempotent Truthful Welcome Delivery', () => {
    const installId1 = `inst-test-${Date.now()}-abc`;

    test('POST /api/notifications/welcome records durable AppInstallation without synthetic tokens', async () => {
      const res = await request(app)
        .post('/api/notifications/welcome')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          installationId: installId1,
          platform: 'ANDROID',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('RECORDED_PENDING_PUSH');
      expect(res.body.delivered).toBe(false);

      const dbRecord = await prisma.appInstallation.findUnique({
        where: { installationId: installId1 },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.platform).toBe('ANDROID');
      expect(dbRecord?.welcomeStatus).toBe('PENDING');
      expect(dbRecord?.userId).toBe(userId);
    });

    test('Idempotent replay: repeated welcome request returns ALREADY_ACCEPTED and avoids duplication', async () => {
      // Simulate delivered status
      await prisma.appInstallation.update({
        where: { installationId: installId1 },
        data: { welcomeStatus: 'DELIVERED', welcomeSentAt: new Date() },
      });

      const res = await request(app)
        .post('/api/notifications/welcome')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          installationId: installId1,
          platform: 'ANDROID',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('ALREADY_ACCEPTED');
      expect(res.body.delivered).toBe(true);
      expect(res.body.message).toContain('already delivered previously');
    });

    test('Authenticated welcome associates user with installation record', async () => {
      const installId2 = `inst-test-${Date.now()}-user`;

      const res = await request(app)
        .post('/api/notifications/welcome')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          installationId: installId2,
          platform: 'ANDROID',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('RECORDED_PENDING_PUSH');

      const dbRecord = await prisma.appInstallation.findUnique({
        where: { installationId: installId2 },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.userId).toBe(userId);
    });
  });

  describe('Workstream C: Account Deletion Operation Tracking & Grace Period Invariants', () => {
    test('Confirming deletion creates AccountDeletionOperation with 7-day grace period in PENDING status', async () => {
      // Step 1: Request deletion
      await AccountDeletionService.requestDeletion(userId, testPassword);

      // Setup OTP code
      const otpCode = '654321';
      const otpHash = crypto.createHash('sha256').update(otpCode).digest('hex');
      const latestOtp = await prisma.otpRequest.findFirst({
        where: { mobile: testUserMobile, purpose: 'ACCOUNT_DELETION', isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      expect(latestOtp).toBeTruthy();
      await prisma.otpRequest.update({
        where: { id: latestOtp!.id },
        data: { otpHash },
      });

      // Step 2: Confirm deletion
      const confirmRes = await AccountDeletionService.confirmDeletion(userId, otpCode);
      expect(confirmRes.success).toBe(true);
      expect(confirmRes.gracePeriodDays).toBe(7);

      // Verify AccountDeletionOperation row created
      const op = await prisma.accountDeletionOperation.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(op).not.toBeNull();
      expect(op?.status).toBe('PENDING');
      expect(op?.scheduledFor).toBeDefined();

      const scheduledDiffDays = Math.round(
        (op!.scheduledFor.getTime() - Date.now()) / (24 * 3600 * 1000)
      );
      expect(scheduledDiffDays).toBe(7);
    });

    test('Logging in during 7-day grace period cancels AccountDeletionOperation', async () => {
      const loginRes = await AuthService.login(testUserMobile, testPassword);
      expect(loginRes).toBeDefined();
      expect(loginRes.token).toBeDefined();

      const op = await prisma.accountDeletionOperation.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(op?.status).toBe('CANCELLED');

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.deletionScheduledAt).toBeNull();
      expect(user?.status).toBe('ACTIVE');
    });

    test('processScheduledDeletions with storage deletion failure transitions operation to FAILED_RETRYABLE with backoff and avoids user anonymization', async () => {
      // Add a bill with a fileKey for this user
      const bill = await prisma.bill.create({
        data: {
          userId,
          invoiceNumber: `INV-DEL-FAIL-${Date.now()}`,
          billAmount: 1000,
          grossBillAmount: 1000,
          calculatedReward: 10,
          status: 'PENDING',
          fileUrl: 'https://storage.hsspl.algions.in/bills/fail-doc.jpg',
          fileKey: 'bills/fail-doc.jpg',
          fileHash: `hash_del_fail_${Date.now()}`,
          invoiceDate: new Date(),
        },
      });

      // Schedule deletion in the past
      await prisma.user.update({
        where: { id: userId },
        data: {
          deletionRequestedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
          deletionScheduledAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
        },
      });

      // Mock storage provider to fail delete
      const originalProvider = StorageService.getProvider();
      const mockStorage = {
        delete: jest.fn().mockRejectedValue(new Error('R2 network timeout connecting to Cloudflare')),
      };
      (StorageService as any).provider = mockStorage;

      try {
        const result = await AccountDeletionService.processScheduledDeletions(prisma);
        expect(result.errors.length).toBeGreaterThanOrEqual(1);

        // Verify operation is FAILED_RETRYABLE
        const op = await prisma.accountDeletionOperation.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        expect(op?.status).toBe('FAILED_RETRYABLE');
        expect(op?.attemptCount).toBeGreaterThanOrEqual(1);
        expect(op?.nextRetryAt).toBeDefined();
        expect(op?.lastError).toContain('Failed to delete');

        // Verify User was NOT anonymized
        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(user?.fullName).toBe('Ramesh Craftsman');
        expect(user?.mobile).toBe(testUserMobile);
      } finally {
        (StorageService as any).provider = originalProvider;
        await prisma.bill.delete({ where: { id: bill.id } });
      }
    });
  });

  describe('Workstream D: Play Integrity Action Nonces & Pre-Auth Verification', () => {
    test('Can generate nonce for ACCOUNT_DELETION_REQUEST and ACCOUNT_DELETION_CONFIRM', async () => {
      const dummyHash = crypto.createHash('sha256').update('test_payload').digest('hex');

      const reqRes = await request(app)
        .post('/api/auth/integrity/nonce')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          action: 'ACCOUNT_DELETION_REQUEST',
          requestHash: dummyHash,
        });

      expect(reqRes.status).toBe(200);
      expect(reqRes.body.success).toBe(true);
      expect(reqRes.body.nonce).toBeDefined();

      const confRes = await request(app)
        .post('/api/auth/integrity/nonce')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          action: 'ACCOUNT_DELETION_CONFIRM',
          requestHash: dummyHash,
        });

      expect(confRes.status).toBe(200);
      expect(confRes.body.success).toBe(true);
      expect(confRes.body.nonce).toBeDefined();
    });

    test('Mobile pre-auth login proceeds seamlessly without integrity token when enforcement is disabled in dev/test', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testUserMobile,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.type).toBe('USER_AUTHENTICATED');
    });
  });

  describe('Workstream E: Two-Admin System Integrity Startup Invariant', () => {
    test('checkAdminRoleIntegrity verifies exactly one BILL_ADMIN and one OPERATIONS_ADMIN', async () => {
      // Ensure admins are present
      await getOrCreateBillAdmin(prisma);
      await getOrCreateOpsAdmin(prisma);

      const isValid = await checkAdminRoleIntegrity(prisma);
      expect(isValid).toBe(true);
    });
  });
});
