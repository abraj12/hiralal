import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { getOrCreateBillAdmin, getOrCreateOpsAdmin } from './test_helpers';
import bcrypt from 'bcryptjs';

describe('Finding 05 & 07 Regression Suite: Single-Seller Invoice Identity & Ancestor Dual Custody', () => {
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

  describe('Finding 05: Single-Seller Invoice Identity and Month-Scoped Uniqueness', () => {
    const sharedInvoiceNum = 'INV-UNIQ-2026-999';

    it('blocks duplicate invoice number when submitted by another user in the same month', async () => {
      // User 1 submits invoice
      const bill1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: sharedInvoiceNum,
        invoiceDate: '2026-10-01',
        billAmount: 5000,
        fileBuffer: makePdfBuffer('bill1'),
        fileName: 'bill1.pdf',
        mimeType: 'application/pdf',
      });

      // Admin approves bill 1
      const approved1 = await BillService.approveBill(bill1.id, adminId, {
        gstIncluded: false,
        gstOverrideReason: 'Composition dealer invoice',
      });
      expect(approved1.bill.status).toBe('APPROVED');

      // User 2 attempts to submit same invoice number in same month — MUST BE REJECTED
      await expect(
        BillService.submitBill({
          userId: user2Id,
          invoiceNumber: sharedInvoiceNum,
          invoiceDate: '2026-10-15',
          billAmount: 7000,
          fileBuffer: makePdfBuffer('bill2'),
          fileName: 'bill2.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(/already been submitted on the platform/i);
    });

    it('allows identical invoice numbers across different months (monthly serial restart)', async () => {
      const serialInvoiceNum = 'INV-SERIAL-001';

      // User 1 submits in October 2026
      const billOct = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: serialInvoiceNum,
        invoiceDate: '2026-10-01',
        billAmount: 3000,
        fileBuffer: makePdfBuffer('oct_serial'),
        fileName: 'oct.pdf',
        mimeType: 'application/pdf',
      });
      const approvedOct = await BillService.approveBill(billOct.id, adminId, {
        gstIncluded: false,
        gstOverrideReason: 'Composition dealer invoice',
      });
      expect(approvedOct.bill.status).toBe('APPROVED');

      // User 2 submits same serial in November 2026 (distinct invoice period)
      const billNov = await BillService.submitBill({
        userId: user2Id,
        invoiceNumber: serialInvoiceNum,
        invoiceDate: '2026-11-01',
        billAmount: 3500,
        fileBuffer: makePdfBuffer('nov_serial'),
        fileName: 'nov.pdf',
        mimeType: 'application/pdf',
      });
      const approvedNov = await BillService.approveBill(billNov.id, adminId, {
        gstIncluded: false,
        gstOverrideReason: 'Composition dealer invoice',
      });
      expect(approvedNov.bill.status).toBe('APPROVED');
    });

    it('blocks duplicate invoice number with varied punctuation/casing in the same month', async () => {
      const baseInvoice = 'INV-VAR-001';

      const b1 = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: baseInvoice,
        invoiceDate: '2026-10-02',
        billAmount: 3200,
        fileBuffer: makePdfBuffer('base_inv'),
        fileName: 'base.pdf',
        mimeType: 'application/pdf',
      });
      await BillService.approveBill(b1.id, adminId, {
        gstIncluded: false,
        gstOverrideReason: 'Composition dealer invoice',
      });

      // User 2 submits 'inv var/001' in the same month
      await expect(
        BillService.submitBill({
          userId: user2Id,
          invoiceNumber: 'inv var/001',
          invoiceDate: '2026-10-05',
          billAmount: 3200,
          fileBuffer: makePdfBuffer('var_inv'),
          fileName: 'var.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(/already been submitted on the platform/i);
    });

    it('HIR-H-01: blocks duplicate submission regardless of claiming different amounts or re-photographed files', async () => {
      const invoice = 'PHYS-DUP-7781';

      const original = await BillService.submitBill({
        userId: user1Id,
        invoiceNumber: invoice,
        invoiceDate: '2026-10-04',
        billAmount: 2750,
        fileBuffer: makePdfBuffer('phys_dup_original'),
        fileName: 'phys1.pdf',
        mimeType: 'application/pdf',
      });
      await BillService.approveBill(original.id, adminId, {
        gstIncluded: false,
        gstOverrideReason: 'Composition dealer invoice',
      });

      // User 2 submits same invoice with different claimed amount and different photo
      await expect(
        BillService.submitBill({
          userId: user2Id,
          invoiceNumber: 'phys dup/7781',
          invoiceDate: '2026-10-04',
          billAmount: 5000,
          fileBuffer: makePdfBuffer('phys_dup_rephotographed'),
          fileName: 'phys2.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(/already been submitted on the platform/i);
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
