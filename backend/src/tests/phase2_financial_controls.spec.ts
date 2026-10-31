import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { ReconciliationWorker } from '../worker/reconciliation.worker';
import { getOrCreateBillAdmin, getOrCreateOpsAdmin } from './test_helpers';

describe('Phase 2 — financial controls (HIR-M-03, M-04, M-05, L-02)', () => {
  const workerMobile = '9876500031';
  let workerId: string;
  let walletId: string;
  let paymentAccountId: string;
  let billAdminToken: string;
  let opsAdminToken: string;

  const adminToken = (id: string, role: string) =>
    jwt.sign({ userId: id, role }, config.admin.accessSecret || config.jwt.accessSecret, { expiresIn: '1h' });

  const cleanup = async () => {
    const user = await prisma.user.findUnique({ where: { mobile: workerMobile } });
    if (!user) return;
    await prisma.payout.deleteMany({ where: { userId: user.id } });
    await prisma.paymentAccount.deleteMany({ where: { userId: user.id } });
    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.bill.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  };

  beforeAll(async () => {
    await cleanup();
    const billAdmin = await getOrCreateBillAdmin(prisma);
    const opsAdmin = await getOrCreateOpsAdmin(prisma);
    billAdminToken = adminToken(billAdmin.id, 'BILL_ADMIN');
    opsAdminToken = adminToken(opsAdmin.id, 'OPERATIONS_ADMIN');

    const worker = await prisma.user.create({
      data: {
        mobile: workerMobile,
        fullName: 'Phase Two Worker',
        passwordHash: 'x',
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: { create: { availableBalance: 0, processingAmount: 1000, totalRedeemed: 0 } },
      },
      include: { wallet: true },
    });
    workerId = worker.id;
    walletId = worker.wallet!.id;
    const account = await prisma.paymentAccount.create({
      data: { userId: workerId, accountType: 'UPI', maskedInfo: 'pha****@upi', isVerified: true, isDefault: true },
    });
    paymentAccountId = account.id;
  });

  afterAll(cleanup);

  describe('HIR-M-03 reward rule guardrails', () => {
    it('rejects a back-dated rule once the profession already has a rule', async () => {
      const existing = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(existing).toBeGreaterThan(0);

      const res = await request(app)
        .post('/api/v1/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'PLUMBER', rewardPercentage: 1.5, effectiveFrom: '2026-01-01' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('REWARD_RULE_GUARDRAIL');
    });

    it('rejects a rate above the configured maximum', async () => {
      const res = await request(app)
        .post('/api/v1/admin/settings/reward-rules')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ profession: 'PLUMBER', rewardPercentage: 90, effectiveFrom: '2029-01-01' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/platform maximum/);
    });
  });

  describe('HIR-M-04 GST exclusion reason', () => {
    it('requires a reason when a GST-registered vendor invoice is approved as GST-exclusive', async () => {
      const bill = await prisma.bill.create({
        data: {
          userId: workerId,
          invoiceNumber: `GSTREASON-${Date.now()}`,
          invoiceDate: new Date('2026-10-20'),
          billAmount: 1180,
          grossBillAmount: 1180,
          calculatedReward: 0,
          status: 'PENDING',
          fileUrl: 'x',
          fileKey: `bills/${workerId}/gst-reason.pdf`,
          fileHash: `gst-reason-${Date.now()}`,
        },
      });

      const res = await request(app)
        .post(`/api/v1/admin/bills/${bill.id}/verify`)
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({ action: 'APPROVE', gstIncluded: false, vendorGstin: '08AAAAA0000A1Z5' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('GST_EXCLUSION_REASON_REQUIRED');
      const after = await prisma.bill.findUnique({ where: { id: bill.id } });
      expect(after?.status).toBe('PENDING');
    });
  });

  describe('HIR-M-05 manual settlement', () => {
    const createInFlightPayout = (providerId: string | null) =>
      prisma.payout.create({
        data: {
          userId: workerId,
          walletId,
          amount: 1000,
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `m05-${Date.now()}-${Math.random()}`,
          status: 'PROCESSING',
          razorpayPayoutId: providerId,
        },
      });

    it('refuses settlement without a reason', async () => {
      const payout = await createInFlightPayout('pout_m05reason');
      const res = await request(app)
        .post(`/api/v1/admin/payouts/${payout.id}/action`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ action: 'FINALIZE_SUCCESS' });
      expect(res.status).toBe(400);
    });

    it('refuses settlement when RazorpayX does not report the payout as processed', async () => {
      const payout = await createInFlightPayout('pout_m05queued');
      const originalFetch = globalThis.fetch;
      const originalKey = config.razorpayx.keyId;
      const originalSecret = config.razorpayx.keySecret;
      config.razorpayx.keyId = 'rzp_test_m05';
      config.razorpayx.keySecret = 'rzp_secret_m05';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'pout_m05queued', status: 'queued', amount: 100000, currency: 'INR', reference_id: payout.id }),
      } as any);

      try {
        const res = await request(app)
          .post(`/api/v1/admin/payouts/${payout.id}/action`)
          .set('Authorization', `Bearer ${opsAdminToken}`)
          .send({ action: 'FINALIZE_SUCCESS', reason: 'Bank statement shows credit to beneficiary' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('PROVIDER_NOT_PROCESSED');
        const after = await prisma.payout.findUnique({ where: { id: payout.id } });
        expect(after?.status).toBe('PROCESSING');
      } finally {
        globalThis.fetch = originalFetch;
        config.razorpayx.keyId = originalKey;
        config.razorpayx.keySecret = originalSecret;
      }
    });
  });

  describe('HIR-L-02 stalled approved payouts', () => {
    it('flags an APPROVED payout with no live dispatch event for manual review', async () => {
      const payout = await prisma.payout.create({
        data: {
          userId: workerId,
          walletId,
          amount: 500,
          paymentAccountId,
          paymentType: 'UPI',
          idempotencyKey: `l02-${Date.now()}`,
          status: 'APPROVED',
        },
      });
      await prisma.$executeRaw`UPDATE "Payout" SET "updatedAt" = NOW() - INTERVAL '1 day' WHERE "id" = ${payout.id}`;

      const flagged = await ReconciliationWorker.flagStalledApprovedPayouts();

      const after = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(after?.requiresManualReview).toBe(true);
      expect(after?.status).toBe('APPROVED');
    });
  });
});
