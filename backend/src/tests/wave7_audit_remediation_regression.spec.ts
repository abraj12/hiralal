import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { PayoutService } from '../services/payout.service';
import { KycService } from '../services/kyc';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

describe('Wave 7 Audit Remediation Regression Suite', () => {
  const testBillAdminMobile = '9999970001';
  const testOpsAdminMobile = '9999970002';
  const testCraftsmanMobile = '9999970003';

  let billAdmin: any;
  let opsAdmin: any;
  let craftsman: any;
  let craftsmanWallet: any;
  let billAdminToken: string;
  let opsAdminToken: string;
  let craftsmanToken: string;
  let paymentAccount: any;
  let activeGstRule: any;
  let activeRewardRule: any;

  beforeAll(async () => {
    await prisma.bill.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: testCraftsmanMobile } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.user.deleteMany({ where: { mobile: testCraftsmanMobile } });

    billAdmin = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (!billAdmin) {
      billAdmin = await prisma.user.create({
        data: {
          mobile: testBillAdminMobile,
          fullName: 'Wave7 Bill Admin',
          passwordHash: await bcrypt.hash('SecurePass123!', 10),
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    opsAdmin = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (!opsAdmin) {
      opsAdmin = await prisma.user.create({
        data: {
          mobile: testOpsAdminMobile,
          fullName: 'Wave7 Ops Admin',
          passwordHash: await bcrypt.hash('SecurePass123!', 10),
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    craftsman = await prisma.user.create({
      data: {
        mobile: testCraftsmanMobile,
        fullName: 'Wave7Plumber',
        passwordHash: await bcrypt.hash('SecurePass123!', 10),
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });

    craftsmanWallet = await prisma.wallet.create({
      data: {
        userId: craftsman.id,
        availableBalance: 10000,
        processingAmount: 0,
        totalRedeemed: 0,
      },
    });

    await prisma.kycRecord.create({
      data: {
        userId: craftsman.id,
        panNumber: 'ABCDE1234F',
        panName: 'Wave7Plumber',
        verifiedName: 'Wave7Plumber',
        panStatus: 'VERIFIED',
        maskedPan: 'XXXXX1234F',
        nameMatched: true,
        consent: true,
        consentTimestamp: new Date(),
      },
    });

    paymentAccount = await prisma.paymentAccount.create({
      data: {
        userId: craftsman.id,
        accountType: 'UPI',
        maskedInfo: 'wave7@upi',
        accountHolderName: 'Wave7Plumber',
        providerRegisteredName: 'Wave7Plumber',
        providerNameVerified: true,
        isVerified: true,
        isDefault: true,
      },
    });

    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: {
        isEnabled: true,
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 86400000),
        minimumRedemptionAmount: 100,
        maximumRedemptionAmount: 50000,
        message: 'Rewards redemption window is open.',
      },
      create: {
        id: 'default',
        profession: null,
        isEnabled: true,
        startAt: new Date(Date.now() - 3600000),
        endAt: new Date(Date.now() + 86400000),
        minimumRedemptionAmount: 100,
        maximumRedemptionAmount: 50000,
        message: 'Rewards redemption window is open.',
      },
    });

    billAdminToken = jwt.sign(
      { userId: billAdmin.id, role: billAdmin.role },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    opsAdminToken = jwt.sign(
      { userId: opsAdmin.id, role: opsAdmin.role },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    craftsmanToken = jwt.sign(
      { userId: craftsman.id, role: craftsman.role },
      config.jwt.accessSecret,
      { expiresIn: '2h' }
    );

    activeGstRule = await prisma.gstRule.findFirst({
      where: { isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!activeGstRule) {
      activeGstRule = await prisma.gstRule.create({
        data: {
          ratePercentage: 18.0,
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
          description: 'Standard 18% GST',
        },
      });
    }

    activeRewardRule = await prisma.rewardRule.findFirst({
      where: { profession: 'PLUMBER', isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!activeRewardRule) {
      activeRewardRule = await prisma.rewardRule.create({
        data: {
          profession: 'PLUMBER',
          rewardPercentage: 5.0,
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.bill.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.payout.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: testCraftsmanMobile } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: testCraftsmanMobile } } });
    await prisma.user.deleteMany({ where: { mobile: testCraftsmanMobile } });
  });

  describe('FIN-FINDING-01: Full Balance Redemption Clamped to dailyRemaining', () => {
    it('should clamp redemption amount when available balance exceeds dailyRemaining', async () => {
      // Set wallet available balance to 10,000
      await prisma.wallet.update({
        where: { userId: craftsman.id },
        data: { availableBalance: 10000, processingAmount: 0 },
      });

      // Existing successful payout today of 48,000 (daily limit is 50,000 -> dailyRemaining is 2,000)
      const mockPayout = await prisma.payout.create({
        data: {
          userId: craftsman.id,
          walletId: craftsmanWallet.id,
          amount: 48000,
          paymentType: 'UPI',
          status: 'SUCCESS',
          idempotencyKey: `w7-payout-${Date.now()}`,
          paymentAccountId: paymentAccount.id,
        },
      });

      // Calling requestRedemption (defaults to full available balance = 10,000)
      // Must clamp to dailyRemaining = 2,000
      const redemption = await PayoutService.requestRedemption(craftsman.id, `idem-${Date.now()}`);
      expect(Number(redemption.amountDebited)).toBe(2000);

      // Clean up
      await prisma.payout.deleteMany({ where: { userId: craftsman.id } });
      await prisma.wallet.update({
        where: { userId: craftsman.id },
        data: { availableBalance: 10000, processingAmount: 0 },
      });
    });

    it('should throw DAILY_LIMIT_EXCEEDED when dailyRemaining is 0 and full redemption is requested', async () => {
      await prisma.payout.deleteMany({ where: { userId: craftsman.id } });
      await prisma.wallet.update({
        where: { userId: craftsman.id },
        data: { availableBalance: 10000, processingAmount: 0 },
      });

      const mockPayout = await prisma.payout.create({
        data: {
          userId: craftsman.id,
          walletId: craftsmanWallet.id,
          amount: 50000,
          paymentType: 'UPI',
          status: 'SUCCESS',
          idempotencyKey: `w7-payout-full-${Date.now()}`,
          paymentAccountId: paymentAccount.id,
        },
      });

      await expect(
        PayoutService.requestRedemption(craftsman.id, `idem-full-${Date.now()}`)
      ).rejects.toThrow('Daily redemption limit');

      await prisma.payout.deleteMany({ where: { userId: craftsman.id } });
    });
  });

  describe('FIN-FINDING-02 & FIN-FINDING-03: Max Redemption Configuration Hardening', () => {
    it('should reject scientific notation such as "5e4" or "1e2"', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ maximumRedemptionAmount: '5e4' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('₹0 and ₹50,000');
    });

    it('should reject leading plus sign "+5000"', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ maximumRedemptionAmount: '+5000' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('₹0 and ₹50,000');
    });

    it('should normalize null maximumRedemptionAmount to 50000 ceiling', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ maximumRedemptionAmount: null });

      expect(res.status).toBe(200);
      expect(res.body.settings.maximumRedemptionAmount).toBeNull();
    });

    it('should accept and persist valid maximumRedemptionAmount within ceiling', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ maximumRedemptionAmount: 25000 });

      expect(res.status).toBe(200);
      expect(Number(res.body.settings.maximumRedemptionAmount)).toBe(25000);
    });

    it('should reject values exceeding the immutable 50000 ceiling', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({ maximumRedemptionAmount: 50001 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('50,000');
    });
  });

  describe('FIN-FINDING-04: Deficit Liability Offset on Bill Approval', () => {
    it('should automatically offset deficit liability and credit net points on bill approval', async () => {
      // Put craftsman in deficit: availableBalance = 0, deficitLiability = 30
      await prisma.wallet.update({
        where: { userId: craftsman.id },
        data: { availableBalance: 0, processingAmount: 0, deficitLiability: 30 },
      });

      // Submit a bill for 10,000 gross with 5% reward = 50 points
      const bill = await prisma.bill.create({
        data: {
          userId: craftsman.id,
          invoiceNumber: `W7-DEF-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 10000,
          status: 'PENDING',
          gstIncluded: false,
          gstRate: 0,
          eligibleRewardAmount: 10000,
          calculatedReward: 50,
          fileUrl: 'https://r2.storage.example/test.jpg',
          fileKey: 'test.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          rewardPercentage: 5,
          rewardRuleId: activeRewardRule.id,
        },
      });

      // Bill Admin approves the bill
      const result = await BillService.approveBill(bill.id, billAdmin.id);
      expect(result.bill.status).toBe('APPROVED');

      // Check wallet: deficitLiability should be 0, availableBalance should be net of calculatedReward minus deficit (30)
      const updatedWallet = await prisma.wallet.findUnique({ where: { userId: craftsman.id } });
      expect(Number(updatedWallet?.deficitLiability)).toBe(0);
      const expectedBalance = Number(result.bill.calculatedReward) - 30;
      expect(Number(updatedWallet?.availableBalance)).toBe(expectedBalance);

      // Check transaction logs for offset note
      const recoveryTx = await prisma.walletTransaction.findFirst({
        where: { walletId: updatedWallet!.id, type: 'DEFICIT_OFFSET' },
        orderBy: { createdAt: 'desc' },
      });
      expect(recoveryTx).toBeTruthy();
      expect(recoveryTx?.description).toMatch(/deficit liability offset/i);

      // Clean up bill
      await prisma.bill.delete({ where: { id: bill.id } });
    });
  });

  describe('SEC-AUDIT-02: Role Segregation on Bill Document Signed URL', () => {
    it('should forbid OPERATIONS_ADMIN from accessing document URL of standard bills', async () => {
      const standardBill = await prisma.bill.create({
        data: {
          userId: craftsman.id,
          invoiceNumber: `W7-DOC-STD-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 1000,
          status: 'PENDING',
          calculatedReward: 50,
          requiresSecondaryApproval: false,
          fileUrl: 'https://r2.storage.example/doc1.jpg',
          fileKey: 'doc1.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
        },
      });

      const res = await request(app)
        .get(`/api/v1/admin/bills/${standardBill.id}/document-url`)
        .set('Authorization', `Bearer ${opsAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('BILL_ADMIN_ACCESS_REQUIRED');

      // BILL_ADMIN can access it
      const resBillAdmin = await request(app)
        .get(`/api/v1/admin/bills/${standardBill.id}/document-url`)
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(resBillAdmin.status).toBe(200);

      await prisma.bill.delete({ where: { id: standardBill.id } });
    });

    it('should allow OPERATIONS_ADMIN to access document URL of secondary review bills', async () => {
      const escalatedBill = await prisma.bill.create({
        data: {
          userId: craftsman.id,
          invoiceNumber: `W7-DOC-ESC-${Date.now()}`,
          invoiceDate: new Date(),
          billAmount: 5000,
          status: 'UNDER_REVIEW',
          calculatedReward: 250,
          requiresSecondaryApproval: true,
          fileUrl: 'https://r2.storage.example/doc2.jpg',
          fileKey: 'doc2.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
        },
      });

      const res = await request(app)
        .get(`/api/v1/admin/bills/${escalatedBill.id}/document-url`)
        .set('Authorization', `Bearer ${opsAdminToken}`);

      expect(res.status).toBe(200);

      await prisma.bill.delete({ where: { id: escalatedBill.id } });
    });
  });

  describe('SEC-AUDIT-04: Push Token Route Validation', () => {
    it('should reject missing or malformed push token payloads', async () => {
      const res = await request(app)
        .post('/api/v1/push-token/register')
        .set('Authorization', `Bearer ${craftsmanToken}`)
        .send({ token: 'abc', platform: 'INVALID_PLATFORM' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should accept valid android/ios push token payloads', async () => {
      const validToken = 'fcm_sample_token_1234567890_abcdefghij';
      const res = await request(app)
        .post('/api/v1/push-token/register')
        .set('Authorization', `Bearer ${craftsmanToken}`)
        .send({ token: validToken, platform: 'android' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('SEC-AUDIT-05: Duplicate Mononymous KYC Request Prevention', () => {
    it('should prevent creating a new mononymous KYC record if one is already pending', async () => {
      const monoUser = await prisma.user.create({
        data: {
          mobile: '9999970099',
          fullName: 'Suresh',
          passwordHash: 'dummyhash',
          role: 'USER',
          profession: 'PLUMBER',
          status: 'ACTIVE',
          isVerified: true,
        },
      });

      // First mononymous submission
      await expect(
        KycService.submitPan(monoUser.id, 'ABCDE9999F', 'Suresh Kumar', true)
      ).rejects.toThrow(/mononymous/);

      const pendingKyc = await prisma.kycRecord.findFirst({
        where: { userId: monoUser.id, panStatus: 'PENDING' },
      });
      expect(pendingKyc).toBeTruthy();

      // Second attempt while pending must throw the same user-friendly error without crashing or creating duplicate
      await expect(
        KycService.submitPan(monoUser.id, 'ABCDE9999F', 'Suresh Kumar', true)
      ).rejects.toThrow(/mononymous/);

      const totalCount = await prisma.kycRecord.count({ where: { userId: monoUser.id } });
      expect(totalCount).toBe(1);

      // Clean up
      await prisma.kycRecord.deleteMany({ where: { userId: monoUser.id } });
      await prisma.user.delete({ where: { id: monoUser.id } });
    });
  });
});
