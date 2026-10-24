import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { getOrCreateBillAdmin, getOrCreateOpsAdmin } from './test_helpers';
import bcrypt from 'bcryptjs';

describe('Finding 05 & 07 Regression Suite: Vendor-Scoped Invoice Uniqueness & Ancestor Dual Custody', () => {
  const user1Mobile = '9800000101';
  const user2Mobile = '9800000102';

  let user1Id: string;
  let user2Id: string;
  let adminId: string;
  let opsAdminId: string;
  let rewardRuleId: string;

  const makePdfBuffer = (seed: string) => Buffer.from(`%PDF-1.4 Invoice file dummy content ${seed} ${Date.now()}`);

  beforeAll(async () => {
    // Obtain baseline single-instance admins
    const billAdmin = await getOrCreateBillAdmin(prisma);
    const opsAdmin = await getOrCreateOpsAdmin(prisma);
    adminId = billAdmin.id;
    opsAdminId = opsAdmin.id;

    // Clean up test users
    const mobiles = [user1Mobile, user2Mobile];
    const existingUsers = await prisma.user.findMany({
      where: { mobile: { in: mobiles } },
      select: { id: true },
    });
    const ids = existingUsers.map((u) => u.id);

    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'Bill' } });
      await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
      await prisma.bill.deleteMany({ where: { userId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    const passwordHash = await bcrypt.hash('TestPassword@123', 10);

    // Create User 1
    const u1 = await prisma.user.create({
      data: {
        mobile: user1Mobile,
        passwordHash,
        fullName: 'Vendor Test User One',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        role: 'USER',
      },
    });
    user1Id = u1.id;

    // Create User 2
    const u2 = await prisma.user.create({
      data: {
        mobile: user2Mobile,
        passwordHash,
        fullName: 'Vendor Test User Two',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        role: 'USER',
      },
    });
    user2Id = u2.id;

    // Ensure active reward rule for PLUMBER
    const existingRule = await prisma.rewardRule.findFirst({
      where: { profession: 'PLUMBER', isActive: true },
    });
    if (existingRule) {
      rewardRuleId = existingRule.id;
    } else {
      const newRule = await prisma.rewardRule.create({
        data: {
          profession: 'PLUMBER',
          rewardPercentage: 5.0,
          effectiveFrom: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
      });
      rewardRuleId = newRule.id;
    }
  });

  afterAll(async () => {
    const mobiles = [user1Mobile, user2Mobile];
    const existingUsers = await prisma.user.findMany({
      where: { mobile: { in: mobiles } },
      select: { id: true },
    });
    const ids = existingUsers.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'Bill' } });
      await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
      await prisma.bill.deleteMany({ where: { userId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  describe('Finding 05: Vendor-Scoped Invoice Uniqueness', () => {
    const sharedInvoiceNum = 'INV-UNIQ-2026-999';
    const vendorGstinA = '08AAAAA0000A1Z5';
    const vendorGstinB = '27BBBBB1111B2Z6';

    it('allows identical invoice numbers from two distinct vendors (distinct GSTINs)', async () => {
      // User 1 submits invoice from Vendor A
      const bill1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: sharedInvoiceNum,
        invoiceDate: '2026-10-01',
        billAmount: 5000,
        fileBuffer: makePdfBuffer('bill1_vendorA'),
        fileName: 'bill1.pdf',
        mimeType: 'application/pdf',
        vendorGstin: vendorGstinA,
      });

      // Admin approves bill 1
      const approved1 = await BillService.approveBill(bill1.id, adminId, {
        gstIncluded: false,
      });
      expect(approved1.bill.status).toBe('APPROVED');
      expect(approved1.bill.vendorGstin).toBe(vendorGstinA);

      // User 2 submits same invoice number from Vendor B (distinct vendor)
      const bill2 = await BillService.submitBill({
        userId: user2Id,
        invoiceNumber: sharedInvoiceNum,
        invoiceDate: '2026-10-01',
        billAmount: 7000,
        fileBuffer: makePdfBuffer('bill2_vendorB'),
        fileName: 'bill2.pdf',
        mimeType: 'application/pdf',
        vendorGstin: vendorGstinB,
      });

      // Admin approves bill 2 - MUST SUCCEED because vendor GSTIN is different
      const approved2 = await BillService.approveBill(bill2.id, adminId, {
        gstIncluded: false,
      });
      expect(approved2.bill.status).toBe('APPROVED');
      expect(approved2.bill.vendorGstin).toBe(vendorGstinB);
    });

    it('blocks duplicate invoice number when submitted for the SAME vendor GSTIN', async () => {
      const dupGstinInvoice = 'INV-DUP-GSTIN-001';
      // User 1 submits and gets approval
      const b1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: dupGstinInvoice,
        invoiceDate: '2026-10-01',
        billAmount: 4000,
        fileBuffer: makePdfBuffer('dup_gstin_1'),
        fileName: 'dup1.pdf',
        mimeType: 'application/pdf',
        vendorGstin: vendorGstinA,
      });
      await BillService.approveBill(b1.id, adminId, { gstIncluded: false });

      // User 2 submits same invoice number for SAME Vendor A
      await expect(
        BillService.submitBill({
          userId: user2Id,
          invoiceNumber: dupGstinInvoice,
          invoiceDate: '2026-10-01',
          billAmount: 4000,
          fileBuffer: makePdfBuffer('dup_gstin_2'),
          fileName: 'dup2.pdf',
          mimeType: 'application/pdf',
          vendorGstin: vendorGstinA,
        })
      ).rejects.toThrow(/from vendor GSTIN.*already been submitted and approved/i);
    });

    it('allows identical invoice numbers for two distinct merchant names without GSTIN', async () => {
      const merchantInvoice = 'INV-LOCAL-777';

      const billM1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: merchantInvoice,
        invoiceDate: '2026-10-02',
        billAmount: 3000,
        fileBuffer: makePdfBuffer('merchant_A'),
        fileName: 'merchant_A.pdf',
        mimeType: 'application/pdf',
        merchantName: 'Shree Ram Hardware',
      });

      const approvedM1 = await BillService.approveBill(billM1.id, adminId, {
        gstIncluded: false,
      });
      expect(approvedM1.bill.status).toBe('APPROVED');

      // User 2 with distinct merchant name
      const billM2 = await BillService.submitBill({
        userId: user2Id,
        invoiceNumber: merchantInvoice,
        invoiceDate: '2026-10-02',
        billAmount: 3500,
        fileBuffer: makePdfBuffer('merchant_B'),
        fileName: 'merchant_B.pdf',
        mimeType: 'application/pdf',
        merchantName: 'Krishna Electricals',
      });

      const approvedM2 = await BillService.approveBill(billM2.id, adminId, {
        gstIncluded: false,
      });
      expect(approvedM2.bill.status).toBe('APPROVED');
    });

    it('blocks duplicate invoice number for the same merchant name', async () => {
      const dupMerchantInvoice = 'INV-DUP-MERCH-001';
      // User 1 submits and gets approval
      const bm1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: dupMerchantInvoice,
        invoiceDate: '2026-10-02',
        billAmount: 3200,
        fileBuffer: makePdfBuffer('dup_merch_1'),
        fileName: 'dup_m1.pdf',
        mimeType: 'application/pdf',
        merchantName: 'Shree Ram Hardware',
      });
      await BillService.approveBill(bm1.id, adminId, { gstIncluded: false });

      // User 2 submits same invoice for same merchant name
      await expect(
        BillService.submitBill({
          userId: user2Id,
          invoiceNumber: dupMerchantInvoice,
          invoiceDate: '2026-10-02',
          billAmount: 3200,
          fileBuffer: makePdfBuffer('dup_merch_2'),
          fileName: 'dup_m2.pdf',
          mimeType: 'application/pdf',
          merchantName: 'Shree Ram Hardware',
        })
      ).rejects.toThrow(/already been submitted and approved/i);
    });

    it('scopes unorganized retail bills without GSTIN or merchant name per user', async () => {
      const unorgInvoice = 'UNORG-101';

      // User 1 unorganized bill
      const billU1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: unorgInvoice,
        invoiceDate: '2026-10-03',
        billAmount: 1200,
        fileBuffer: makePdfBuffer('unorg_user1'),
        fileName: 'unorg1.pdf',
        mimeType: 'application/pdf',
      });

      const approvedU1 = await BillService.approveBill(billU1.id, adminId, {
        gstIncluded: false,
      });
      expect(approvedU1.bill.status).toBe('APPROVED');

      // User 2 unorganized bill with same number succeeds
      const billU2 = await BillService.submitBill({
        userId: user2Id,
        invoiceNumber: unorgInvoice,
        invoiceDate: '2026-10-03',
        billAmount: 1400,
        fileBuffer: makePdfBuffer('unorg_user2'),
        fileName: 'unorg2.pdf',
        mimeType: 'application/pdf',
      });

      const approvedU2 = await BillService.approveBill(billU2.id, adminId, {
        gstIncluded: false,
      });
      expect(approvedU2.bill.status).toBe('APPROVED');
    });
  });

  describe('Finding 07: Dual Custody Revision Ancestor Recursion', () => {
    it('prevents an administrator who verified an ancestor revision from approving a subsequent revision', async () => {
      // 1. User submits Rev 1
      const rev1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: 'REV-CHAIN-100',
        invoiceDate: '2026-10-04',
        billAmount: 1000,
        fileBuffer: makePdfBuffer('rev1'),
        fileName: 'rev1.pdf',
        mimeType: 'application/pdf',
        merchantName: 'Chain Vendor',
      });

      // Operations Admin (opsAdminId) verified and rejected Rev 1 (grandparent)
      await prisma.bill.update({
        where: { id: rev1.id },
        data: {
          status: 'REJECTED',
          rejectionReason: 'Blurry photo',
          verifiedByAdminId: opsAdminId,
        },
      });

      // 2. User submits Rev 2 (resubmission) with upward revision >25% to trigger secondary approval requirement
      const rev2 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: 'REV-CHAIN-100',
        invoiceDate: '2026-10-04',
        billAmount: 2000, // 100% upward revision
        fileBuffer: makePdfBuffer('rev2'),
        fileName: 'rev2.pdf',
        mimeType: 'application/pdf',
        parentBillId: rev1.id,
        merchantName: 'Chain Vendor',
      });

      expect(rev2.requiresSecondaryApproval).toBe(true);

      // Bill Admin (adminId) verified Rev 2 and rejected it
      await prisma.bill.update({
        where: { id: rev2.id },
        data: {
          status: 'REJECTED',
          rejectionReason: 'Wrong total',
          verifiedByAdminId: adminId,
        },
      });

      // 3. User submits Rev 3
      const rev3 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: 'REV-CHAIN-100',
        invoiceDate: '2026-10-04',
        billAmount: 2200,
        fileBuffer: makePdfBuffer('rev3'),
        fileName: 'rev3.pdf',
        mimeType: 'application/pdf',
        parentBillId: rev2.id,
        merchantName: 'Chain Vendor',
      });

      expect(rev3.requiresSecondaryApproval).toBe(true);

      // If Operations Admin (opsAdminId), who verified grandparent Rev 1, attempts secondary approval of Rev 3,
      // it MUST be rejected by the ancestor chain traversal!
      await expect(
        BillService.approveBill(rev3.id, opsAdminId, {
          isOperationsAdminApproved: true,
          gstIncluded: false,
        })
      ).rejects.toThrow(/cannot be the same administrator who performed primary verification.*on any ancestor revision/i);

      // If Bill Admin (adminId), who verified parent Rev 2, attempts secondary approval of Rev 3,
      // it MUST also be rejected!
      await expect(
        BillService.approveBill(rev3.id, adminId, {
          isOperationsAdminApproved: true,
          gstIncluded: false,
        })
      ).rejects.toThrow(/cannot be the same administrator who performed primary verification/i);
    });
  });
});
