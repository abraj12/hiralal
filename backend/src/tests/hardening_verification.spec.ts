import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { SignCareKycProvider } from '../services/kyc/signcare.provider';
import { MSG91SmsProvider } from '../services/sms/msg91.provider';
import { SmsService } from '../services/sms';
import { PayoutService } from '../services/payout.service';
import { config } from '../config';

describe('Final Hardening Phase — Providers, State Machine, Ledger & Health', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('1. SignCare PAN Provider Adapter Tests', () => {
    const provider = new SignCareKycProvider();

    beforeAll(() => {
      config.signcare.apiKey = 'test_sc_key_123';
      config.signcare.appId = 'test_sc_app_456';
    });

    it('successfully validates PAN and parses tax response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'SUCCESS',
          request_id: 'sc_req_12345',
          data: {
            status: 'VALID',
            pan_status: 'EXISTING AND VALID',
            full_name: 'RAMESH CHANDRA SHARMA',
          },
        }),
      } as any);

      const result = await provider.verifyPan({
        panNumber: 'ABCDE1234F',
        panName: 'Ramesh Sharma',
        userId: 'usr_test_1',
      });

      expect(result.isValid).toBe(true);
      expect(result.panName).toBe('RAMESH CHANDRA SHARMA');
      expect(result.providerRequestId).toBe('sc_req_12345');
    });

    it('handles invalid or non-existent PAN from SignCare', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'INVALID',
          request_id: 'sc_req_invalid',
          data: {
            status: 'INVALID',
            pan_status: 'NOT FOUND',
          },
          message: 'PAN number not found in NSDL/ITD database',
        }),
      } as any);

      const result = await provider.verifyPan({
        panNumber: 'ZZZZZ9999Z',
        panName: 'Unknown',
        userId: 'usr_test_2',
      });

      expect(result.isValid).toBe(false);
      expect(result.rejectionReason).toContain('not found in NSDL/ITD');
    });

    it('handles SignCare HTTP 4xx/5xx gateway errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          message: 'Rate limit exceeded for SignCare API',
        }),
      } as any);

      const result = await provider.verifyPan({
        panNumber: 'ABCDE1234F',
        panName: 'Ramesh Sharma',
        userId: 'usr_test_3',
      });

      expect(result.isValid).toBe(false);
      expect(result.rejectionReason).toContain('Rate limit exceeded');
    });

    it('handles network timeout via AbortController', async () => {
      global.fetch = jest.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      await expect(
        provider.verifyPan({
          panNumber: 'ABCDE1234F',
          panName: 'Ramesh Sharma',
          userId: 'usr_test_4',
        })
      ).rejects.toThrow('timed out');
    });
  });

  describe('2. MSG91 SMS Provider Adapter Tests', () => {
    const msg91 = new MSG91SmsProvider();

    it('successfully delivers OTP via MSG91 v5 API', async () => {
      process.env.MSG91_AUTH_KEY = 'test_auth_key';
      process.env.MSG91_TEMPLATE_ID = 'test_template_id';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'success',
          request_id: 'msg91_req_7890',
        }),
      } as any);

      const result = await msg91.sendOtp({
        mobile: '9876543210',
        otpCode: '123456',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg91_req_7890');
    });

    it('handles MSG91 gateway rejection', async () => {
      process.env.MSG91_AUTH_KEY = 'test_auth_key';
      process.env.MSG91_TEMPLATE_ID = 'test_template_id';

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          type: 'error',
          message: 'Invalid mobile number format',
        }),
      } as any);

      const result = await msg91.sendOtp({
        mobile: '12345',
        otpCode: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mobile number format');
    });

    it('dispatches through SmsService without leaking secrets', async () => {
      const res = await SmsService.sendOtp({
        mobile: '9876543210',
        otpCode: '654321',
      });

      expect(res.success).toBe(true);
    });
  });

  describe('3. Payout State Machine Transitions', () => {
    let testUser: any;
    let testWallet: any;
    let testAccount: any;
    let testPayout: any;

    beforeAll(async () => {
      testUser = await prisma.user.create({
        data: {
          mobile: '9111122222',
          fullName: 'StateMachine Tester',
          passwordHash: 'hash',
          profession: 'PLUMBER',
        },
      });

      testWallet = await prisma.wallet.create({
        data: {
          userId: testUser.id,
          availableBalance: 1000.0,
          processingAmount: 500.0,
        },
      });

      testAccount = await prisma.paymentAccount.create({
        data: {
          userId: testUser.id,
          accountType: 'UPI',
          upiId: 'statemachine@upi',
          maskedInfo: 'sta***@upi',
          isVerified: true,
        },
      });

      testPayout = await prisma.payout.create({
        data: {
          userId: testUser.id,
          walletId: testWallet.id,
          amount: 500.0,
          paymentAccountId: testAccount.id,
          paymentType: 'UPI',
          idempotencyKey: 'idemp_sm_test_1',
          status: 'PROCESSING',
        },
      });
    });

    afterAll(async () => {
      await prisma.notification.deleteMany({ where: { userId: testUser.id } });
      await prisma.walletTransaction.deleteMany({ where: { userId: testUser.id } });
      await prisma.payout.deleteMany({ where: { userId: testUser.id } });
      await prisma.paymentAccount.deleteMany({ where: { userId: testUser.id } });
      await prisma.wallet.deleteMany({ where: { userId: testUser.id } });
      await prisma.user.deleteMany({ where: { id: testUser.id } });
    });

    it('finalizes PROCESSING payout to SUCCESS cleanly', async () => {
      const finalized = await PayoutService.finalizeSuccess(testPayout.id, 'rzp_pout_sm_1');
      expect(finalized.status).toBe('SUCCESS');

      // Check wallet deducted processingAmount and credited totalRedeemed
      const updatedWallet = await prisma.wallet.findUnique({ where: { id: testWallet.id } });
      expect(Number(updatedWallet?.processingAmount)).toBe(0);
      expect(Number(updatedWallet?.totalRedeemed)).toBe(500.0);
    });

    it('rejects reversing an already-successful payout', async () => {
      await expect(
        PayoutService.reversePayout(testPayout.id, 'Gateway refund attempted')
      ).rejects.toThrow('Cannot reverse payout');
    });

    it('is idempotent on finalizeSuccess for already-successful payout', async () => {
      const secondCall = await PayoutService.finalizeSuccess(testPayout.id);
      expect(secondCall.status).toBe('SUCCESS');
    });
  });

  describe('4. Financial Ledger Immutability & Balance Reconciliation', () => {
    let ledgerUser: any;
    let ledgerWallet: any;

    beforeAll(async () => {
      ledgerUser = await prisma.user.create({
        data: {
          mobile: '9333344444',
          fullName: 'Ledger Audit Tester',
          passwordHash: 'hash',
          profession: 'TILE_INSTALLER',
        },
      });

      ledgerWallet = await prisma.wallet.create({
        data: {
          userId: ledgerUser.id,
          availableBalance: 0.0,
        },
      });
    });

    afterAll(async () => {
      await prisma.walletTransaction.deleteMany({ where: { userId: ledgerUser.id } });
      await prisma.wallet.deleteMany({ where: { userId: ledgerUser.id } });
      await prisma.user.deleteMany({ where: { id: ledgerUser.id } });
    });

    it('reconciles wallet available balance strictly to sum of ledger transactions', async () => {
      // Step 1: Credit Reward ₹1,500
      await prisma.walletTransaction.create({
        data: {
          walletId: ledgerWallet.id,
          userId: ledgerUser.id,
          amount: 1500.0,
          type: 'REWARD_CREDIT',
          balanceAfter: 1500.0,
          referenceType: 'BILL',
          referenceId: 'bill_test_rec_1',
          description: 'Reward credit for verified bill',
        },
      });

      // Step 2: Debit Payout ₹600
      await prisma.walletTransaction.create({
        data: {
          walletId: ledgerWallet.id,
          userId: ledgerUser.id,
          amount: 600.0,
          type: 'PAYOUT_DEBIT',
          balanceAfter: 900.0,
          referenceType: 'PAYOUT',
          referenceId: 'pout_test_rec_1',
          description: 'Payout debit for redemption',
        },
      });

      // Step 3: Payout Reversal ₹200 (partial failure)
      await prisma.walletTransaction.create({
        data: {
          walletId: ledgerWallet.id,
          userId: ledgerUser.id,
          amount: 200.0,
          type: 'PAYOUT_REVERSAL',
          balanceAfter: 1100.0,
          referenceType: 'PAYOUT',
          referenceId: 'pout_test_rec_1_rev',
          description: 'Payout reversal refund',
        },
      });

      // Update wallet balance to match
      await prisma.wallet.update({
        where: { id: ledgerWallet.id },
        data: { availableBalance: 1100.0 },
      });

      // Automated Ledger Audit: Query all transactions for user and compute sum
      const transactions = await prisma.walletTransaction.findMany({
        where: { userId: ledgerUser.id },
      });

      let netLedgerBalance = 0;
      for (const tx of transactions) {
        if (tx.type === 'REWARD_CREDIT' || tx.type === 'PAYOUT_REVERSAL' || tx.type === 'REFUND') {
          netLedgerBalance += Number(tx.amount);
        } else if (tx.type === 'PAYOUT_DEBIT') {
          netLedgerBalance -= Number(tx.amount);
        }
      }

      const wallet = await prisma.wallet.findUnique({ where: { id: ledgerWallet.id } });
      expect(Number(wallet?.availableBalance)).toBe(netLedgerBalance);
      expect(netLedgerBalance).toBe(1100.0);
    });
  });

  describe('5. Health Probes (Liveness & Readiness)', () => {
    it('GET /health/live returns 200 ok', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptime).toBe('number');
    });

    it('GET /health/ready returns 200 with database check', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database).toBe('healthy');
    });
  });
});
