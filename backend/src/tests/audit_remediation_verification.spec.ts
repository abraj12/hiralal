import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { AuthService } from '../services/auth.service';
import { KycService } from '../services/kyc/index';
import { LocalStorageProvider } from '../services/storage/local.provider';
import { generateBlindIndex } from '../utils/crypto.utils';
import { config } from '../config';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';

describe('Audit Remediation & Security Defect Verification Suite', () => {
  const uniqueSuffix = Date.now().toString().slice(-6);
  const testMobileA = `9811${uniqueSuffix}`;
  const testMobileB = `9822${uniqueSuffix}`;
  const testPassword = 'Password@123';

  let userAId: string;
  let userBId: string;
  let opsAdminId: string;

  beforeAll(async () => {
    // Clean up any test users
    await prisma.user.deleteMany({
      where: { mobile: { in: [testMobileA, testMobileB, `9999${uniqueSuffix}`] } },
    });

    const testPasswordHash = await bcrypt.hash('Password@123', 10);

    const userA = await prisma.user.create({
      data: {
        mobile: testMobileA,
        fullName: 'Worker User A',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        passwordHash: testPasswordHash,
        wallet: { create: { availableBalance: 1500, totalRedeemed: 0 } },
      },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        mobile: testMobileB,
        fullName: 'Worker User B',
        profession: 'TILE_INSTALLER',
        status: 'ACTIVE',
        passwordHash: testPasswordHash,
        wallet: { create: { availableBalance: 0 } },
      },
    });
    userBId = userB.id;

    let opsAdmin = await prisma.user.findFirst({
      where: { role: 'OPERATIONS_ADMIN' },
    });
    if (!opsAdmin) {
      opsAdmin = await prisma.user.create({
        data: {
          mobile: `9999${uniqueSuffix}`,
          fullName: 'Operations Administrator Lead',
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
        },
      });
    }
    opsAdminId = opsAdmin.id;
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.payout.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.bill.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.paymentAccount.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.kycRecord.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.authSession.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [userAId, userBId].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId].filter(Boolean) } },
    });
  });

  describe('1. [CRIT-03] Global Cross-User Invoice Uniqueness', () => {
    it('prevents user B from submitting the same invoice number already submitted by user A', async () => {
      const invNum = `INV-GLOBAL-${uniqueSuffix}`;
      const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

      // User A submits invoice
      const billA = await BillService.submitBill({
        userId: userAId,
        invoiceNumber: invNum,
        invoiceDate: '2026-10-15',
        billAmount: 2500,
        fileName: 'billA.jpg',
        fileBuffer: fakeJpg,
        mimeType: 'image/jpeg',
      });
      expect(billA.id).toBeDefined();

      // Approve User A's bill to activate the global unique barrier (enforced for status = 'APPROVED')
      await BillService.approveBill(billA.id, opsAdminId);

      // User B attempts to submit the same invoice number with a different file
      const fakeJpg2 = Buffer.concat([fakeJpg, Buffer.from([0x01, 0x02, 0x03])]);
      await expect(
        BillService.submitBill({
          userId: userBId,
          invoiceNumber: invNum,
          invoiceDate: '2026-10-15',
          billAmount: 2500,
          fileName: 'billB.jpg',
          fileBuffer: fakeJpg2,
          mimeType: 'image/jpeg',
        })
      ).rejects.toThrow(/already been submitted/i);
    });
  });

  describe('2. [HIGH-01] Payout Manual Rejection in PAYOUT_INITIATED Under Manual Review', () => {
    it('allows operations admin to manually reject a payout stuck in PAYOUT_INITIATED when flagged for manual review', async () => {
      // Create user wallet and stuck payout
      const userAWallet = await prisma.wallet.findUnique({ where: { userId: userAId } });
      const payoutAmount = 500;

      // Reserve funds in wallet
      await prisma.wallet.update({
        where: { id: userAWallet!.id },
        data: {
          availableBalance: { decrement: payoutAmount },
          processingAmount: { increment: payoutAmount },
        },
      });

      const paymentAccount = await prisma.paymentAccount.create({
        data: {
          userId: userAId,
          accountType: 'UPI',
          upiId: `userA_${uniqueSuffix}@upi`,
          accountHolderName: 'Worker User A',
          maskedInfo: 'userA***@upi',
          isVerified: true,
          isDefault: true,
        },
      });

      const payout = await prisma.payout.create({
        data: {
          userId: userAId,
          walletId: userAWallet!.id,
          paymentAccountId: paymentAccount.id,
          amount: payoutAmount,
          status: 'PAYOUT_INITIATED',
          paymentType: 'UPI',
          idempotencyKey: `payout_test_${uniqueSuffix}`,
          requiresManualReview: true,
          manualReviewReason: 'Simulated worker crash before gateway dispatch',
          initiatedAt: new Date(),
        },
      });

      // A "not found" gateway lookup is inconclusive, even when a manual-review flag exists.
      // The wallet hold must remain intact until gateway cancellation is positively confirmed.
      jest.spyOn(PayoutService, 'queryGatewayByReference').mockResolvedValueOnce({ found: false });
      try {
        await expect(
          PayoutService.rejectRedemption(
            payout.id,
            opsAdminId,
            'Refund stuck payout to worker wallet'
          )
        ).rejects.toThrow(/gateway lookup did not confirm cancellation/i);

        const afterPayout = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
        expect(afterPayout.status).toBe('PAYOUT_INITIATED');
        expect(afterPayout.requiresManualReview).toBe(true);

        // Funds remain reserved: no refund is permitted without confirmed cancellation.
        const refreshedWallet = await prisma.wallet.findUnique({ where: { id: userAWallet!.id } });
        expect(Number(refreshedWallet!.processingAmount)).toBe(Number(userAWallet!.processingAmount) + payoutAmount);
        expect(Number(refreshedWallet!.availableBalance)).toBe(Number(userAWallet!.availableBalance) - payoutAmount);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe('2b. [CRITICAL] Provider ID means payout may already be in flight', () => {
    it('does not refund an APPROVED payout with a provider ID when cancellation is not confirmed', async () => {
      const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: userAId } });
      const amount = 200;
      await prisma.wallet.update({
        where: { id: walletBefore.id },
        data: {
          availableBalance: { decrement: amount },
          processingAmount: { increment: amount },
        },
      });

      const paymentAccount = await prisma.paymentAccount.findFirstOrThrow({
        where: { userId: userAId },
      });
      const payout = await prisma.payout.create({
        data: {
          userId: userAId,
          walletId: walletBefore.id,
          paymentAccountId: paymentAccount.id,
          amount,
          status: 'APPROVED',
          razorpayPayoutId: `pout_ambiguous_${uniqueSuffix}`,
          paymentType: 'UPI',
          idempotencyKey: `payout_provider_id_hold_${uniqueSuffix}`,
        },
      });

      const cancelSpy = jest.spyOn(PayoutService, 'cancelGatewayPayout').mockResolvedValueOnce({
        success: false,
        message: 'Gateway cancellation not confirmed',
      } as any);
      try {
        await expect(
          PayoutService.rejectRedemption(payout.id, opsAdminId, 'Hold because gateway cancellation is unconfirmed')
        ).rejects.toThrow(/Funds must remain reserved/i);

        expect(cancelSpy).toHaveBeenCalledWith(payout.razorpayPayoutId);
        const afterPayout = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
        expect(afterPayout.status).toBe('APPROVED');
        expect(afterPayout.requiresManualReview).toBe(true);
        const afterWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletBefore.id } });
        expect(Number(afterWallet.availableBalance)).toBe(Number(walletBefore.availableBalance) - amount);
        expect(Number(afterWallet.processingAmount)).toBe(Number(walletBefore.processingAmount) + amount);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  describe('2c. [CRITICAL] Gateway cancellation response must confirm terminal status', () => {
    it('does not refund when the cancellation endpoint returns HTTP success but payout remains processing', async () => {
      const originalFetch = global.fetch;
      const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: userAId } });
      const amount = 125;
      await prisma.wallet.update({
        where: { id: walletBefore.id },
        data: {
          availableBalance: { decrement: amount },
          processingAmount: { increment: amount },
        },
      });
      const paymentAccount = await prisma.paymentAccount.findFirstOrThrow({
        where: { userId: userAId },
      });
      const providerId = `pout_cancel_processing_${uniqueSuffix}`;
      const payout = await prisma.payout.create({
        data: {
          userId: userAId,
          walletId: walletBefore.id,
          paymentAccountId: paymentAccount.id,
          amount,
          status: 'PAYOUT_INITIATED',
          razorpayPayoutId: providerId,
          paymentType: 'UPI',
          idempotencyKey: `cancel_processing_hold_${uniqueSuffix}`,
        },
      });
      config.razorpayx.keyId = 'rzp_test_key';
      config.razorpayx.keySecret = 'rzp_test_secret';
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: providerId, status: 'processing' }),
      }) as any;

      try {
        await expect(
          PayoutService.rejectRedemption(payout.id, opsAdminId, 'Cancellation request accepted but not settled')
        ).rejects.toThrow(/did not confirm a terminal cancelled state|Funds must remain reserved/i);
        const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
        expect(after.status).toBe('PAYOUT_INITIATED');
        expect(after.requiresManualReview).toBe(true);
        const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: walletBefore.id } });
        expect(Number(walletAfter.availableBalance)).toBe(Number(walletBefore.availableBalance) - amount);
        expect(Number(walletAfter.processingAmount)).toBe(Number(walletBefore.processingAmount) + amount);
      } finally {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
      }
    });
  });

  describe('3. [HIGH-03] Refresh Token Strict Replay Attack Fencing', () => {
    it('strictly revokes all active user sessions when an already-rotated refresh token is replayed', async () => {
      const initialRefreshToken = crypto.randomBytes(40).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(initialRefreshToken).digest('hex');
      const sessionId = crypto.randomUUID();

      await prisma.user.update({
        where: { id: userBId },
        data: { activeSessionId: sessionId },
      });

      await prisma.authSession.create({
        data: {
          userId: userBId,
          sessionId,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      });

      // Request 1: First rotation succeeds
      const firstRotation = await AuthService.refreshToken(initialRefreshToken);
      expect(firstRotation.accessToken).toBeDefined();
      expect(firstRotation.refreshToken).toBeDefined();

      // Request 2: Replay of already rotated token must immediately trigger replay attack fence
      await expect(
        AuthService.refreshToken(initialRefreshToken)
      ).rejects.toThrow(/Compromised or reused refresh token/i);

      // Verify user sessions were revoked
      const userBAfter = await prisma.user.findUnique({ where: { id: userBId } });
      expect(userBAfter!.activeSessionId).toBeNull();
    });
  });

  describe('4. [HIGH-07] Account Deletion Financial Fencing on In-Flight Obligations', () => {
    it('rejects account deletion request if user has pending bills under review', async () => {
      const { AccountDeletionService } = await import('../services/account-deletion.service');

      // Create a pending bill for userA
      await prisma.bill.create({
        data: {
          userId: userAId,
          invoiceNumber: `INV-FENCE-${uniqueSuffix}`,
          billAmount: 100,
          grossBillAmount: 100,
          calculatedReward: 10,
          status: 'PENDING',
          fileUrl: 'https://test.storage.com/bill.jpg',
          fileKey: 'bills/fence-test.jpg',
          fileHash: `fence_hash_${uniqueSuffix}`,
          invoiceDate: new Date(),
        },
      });

      await expect(
        AccountDeletionService.requestDeletion(userAId, testPassword, '127.0.0.1')
      ).rejects.toThrow(/bills pending review/i);
    });
  });

  describe('5. [MED-01] Blind Index Key Separation', () => {
    it('uses blindIndexSecret and produces consistent deterministic digests', () => {
      const pan = 'ABCDE1234F';
      const index1 = generateBlindIndex(pan);
      const index2 = generateBlindIndex('abcde1234f'); // normalized to uppercase

      expect(index1).toBe(index2);
      expect(index1.length).toBe(64); // SHA-256 hex string
    });
  });

  describe('6. [MED-04] KYC Identity Immutability', () => {
    it('prevents verified user from overwriting their verified identity with a different PAN', async () => {
      const panA = 'ABCDE1111A';
      const blindA = generateBlindIndex(panA);

      // Seed verified KYC
      await prisma.kycRecord.create({
        data: {
          userId: userBId,
          panBlindIndex: blindA,
          panName: 'Worker User B',
          verifiedName: 'Worker User B',
          panStatus: 'VERIFIED',
          nameMatched: true,
          maskedPan: 'XXXXX1111A',
        },
      });

      // Attempt to verify a different PAN B
      await expect(
        KycService.submitPan(userBId, 'FGHIJ2222B', 'Worker User B', true)
      ).rejects.toThrow(/already verified.*requires administrative review/i);
    });
  });

  describe('7. [SEC-B03] Storage Path Traversal Sanitization', () => {
    it('sanitizes both forward and backslashes and directory traversal sequences', () => {
      const localProvider = new LocalStorageProvider();
      const testKey = 'bills/..\\..\\etc\\passwd';
      const resolved = (localProvider as any).getFullPath(testKey);

      expect(resolved).not.toContain('..');
      expect(resolved.startsWith(path.resolve((localProvider as any).baseDir))).toBe(true);
    });
  });
});
