import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

/**
 * HIR-AUD-P2-07: Master 12-Case Invoice Reservation and Lifecycle Regression Suite
 * Documented in Forensic Audit Document 05 (Single-Seller Invoice Integrity).
 */
describe('HIR-AUD-P2-07: Invoice Identity, Reservation & Revision Lifecycle Suite', () => {
  const custAMobile = '9888800001';
  const custBMobile = '9888800002';
  const billAdminMobile = '9888800003';
  const opsAdminMobile = '9888800004';

  let custA: any;
  let custB: any;
  let billAdmin: any;
  let opsAdmin: any;

  let custAToken: string;
  let custBToken: string;
  let billAdminToken: string;
  let opsAdminToken: string;

  const makePdf = (uniqueTag: string) =>
    Buffer.from(`%PDF-1.4\n%${uniqueTag}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF`);

  beforeAll(async () => {
    const mobiles = [custAMobile, custBMobile, billAdminMobile, opsAdminMobile];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });

    const passwordHash = await bcrypt.hash('Password@123', 10);

    // Create Customer A
    custA = await prisma.user.create({
      data: {
        mobile: custAMobile,
        fullName: 'Customer Alpha',
        passwordHash,
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    await prisma.wallet.create({ data: { userId: custA.id, availableBalance: 0 } });

    // Create Customer B
    custB = await prisma.user.create({
      data: {
        mobile: custBMobile,
        fullName: 'Customer Beta',
        passwordHash,
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    await prisma.wallet.create({ data: { userId: custB.id, availableBalance: 0 } });

    // Ensure Bill Admin exists
    billAdmin = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (!billAdmin) {
      billAdmin = await prisma.user.create({
        data: {
          mobile: billAdminMobile,
          fullName: 'Test Bill Admin',
          passwordHash,
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    // Ensure Operations Admin exists
    opsAdmin = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (!opsAdmin) {
      opsAdmin = await prisma.user.create({
        data: {
          mobile: opsAdminMobile,
          fullName: 'Test Ops Admin',
          passwordHash,
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    }

    custAToken = jwt.sign({ userId: custA.id, role: custA.role }, config.jwt.accessSecret, { expiresIn: '2h' });
    custBToken = jwt.sign({ userId: custB.id, role: custB.role }, config.jwt.accessSecret, { expiresIn: '2h' });
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

    // Active GST rule
    let activeGstRule = await prisma.gstRule.findFirst({ where: { isActive: true } });
    if (!activeGstRule) {
      await prisma.gstRule.create({
        data: {
          ratePercentage: 18.0,
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
          description: 'Standard 18% GST',
        },
      });
    }

    // Active Reward rule
    const existingRule = await prisma.rewardRule.findFirst({
      where: { profession: 'PLUMBER' },
      orderBy: { version: 'desc' },
    });
    if (!existingRule) {
      await prisma.rewardRule.create({
        data: {
          profession: 'PLUMBER',
          rewardPercentage: 5.0,
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
          version: 1,
        },
      });
    } else {
      await prisma.rewardRule.update({
        where: { id: existingRule.id },
        data: {
          isActive: true,
          effectiveFrom: new Date(Date.now() - 86400000),
          effectiveUntil: null,
        },
      });
    }
  });

  afterAll(async () => {
    const mobiles = [custAMobile, custBMobile, billAdminMobile, opsAdminMobile];
    await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.paymentAccount.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.kycRecord.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: [custAMobile, custBMobile] } } });
  });

  // Scenario 1: Customer A submits INV-01 in Oct; enters PENDING; Customer B submits INV-01 in Oct.
  // Expected: Customer B rejected with duplicate error.
  it('Scenario 1: Competing submission against PENDING bill in same month is rejected', async () => {
    const invoiceNum = 'SCENARIO-01';
    const invoiceDate = '2026-10-10';

    const billA = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 5000,
      fileBuffer: makePdf('scen1_custA'),
      fileName: 'inv01_custA.pdf',
      mimeType: 'application/pdf',
    });
    expect(billA.status).toBe('PENDING');

    await expect(
      BillService.submitBill({
        userId: custB.id,
        invoiceNumber: invoiceNum,
        invoiceDate,
        billAmount: 5000,
        fileBuffer: makePdf('scen1_custB'),
        fileName: 'inv01_custB.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/has already been submitted|already exists|already submitted/i);
  });

  // Scenario 2: Customer A submits INV-02 in Oct; Customer B submits INV-02 in Nov.
  // Expected: Customer B allowed (monthly serial numbering restart).
  it('Scenario 2: Monthly serial restart allows same invoice number in different months', async () => {
    const invoiceNum = 'SCENARIO-02';

    const billOct = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate: '2026-10-15',
      billAmount: 3000,
      fileBuffer: makePdf('scen2_oct'),
      fileName: 'oct_bill.pdf',
      mimeType: 'application/pdf',
    });
    expect(billOct.invoicePeriod).toBe('2026-10');

    const billNov = await BillService.submitBill({
      userId: custB.id,
      invoiceNumber: invoiceNum,
      invoiceDate: '2026-11-05',
      billAmount: 3000,
      fileBuffer: makePdf('scen2_nov'),
      fileName: 'nov_bill.pdf',
      mimeType: 'application/pdf',
    });
    expect(billNov.invoicePeriod).toBe('2026-11');
    expect(billNov.id).not.toBe(billOct.id);
  });

  // Scenario 3: Customer A submits INV-03; Customer B submits with varying punctuation (inv/03).
  // Expected: Duplicate detected and blocked.
  it('Scenario 3: Normalization blocks duplicate with varying punctuation or whitespace', async () => {
    const billA = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: 'INV-SCEN-03',
      invoiceDate: '2026-10-12',
      billAmount: 4000,
      fileBuffer: makePdf('scen3_custA'),
      fileName: 'custA.pdf',
      mimeType: 'application/pdf',
    });
    expect(billA.invoiceKey).toBe('INVSCEN03');

    await expect(
      BillService.submitBill({
        userId: custB.id,
        invoiceNumber: '  inv / scen . 03  ',
        invoiceDate: '2026-10-12',
        billAmount: 4000,
        fileBuffer: makePdf('scen3_custB'),
        fileName: 'custB.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/has already been submitted|already exists|already submitted/i);
  });

  // Scenario 4: Customer A submits INV-04; Customer B submits INV-04 with different amount and different photo.
  // Expected: Customer B blocked (amount/file hash cannot bypass invoice identity).
  it('Scenario 4: Competing invoice blocked regardless of different amount or photo', async () => {
    await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: 'SCENARIO-04',
      invoiceDate: '2026-10-14',
      billAmount: 1000,
      fileBuffer: makePdf('scen4_custA'),
      fileName: 'custA.pdf',
      mimeType: 'application/pdf',
    });

    await expect(
      BillService.submitBill({
        userId: custB.id,
        invoiceNumber: 'SCENARIO-04',
        invoiceDate: '2026-10-14',
        billAmount: 9999, // Different amount
        fileBuffer: makePdf('scen4_different_photo_custB'), // Different file
        fileName: 'custB_diff.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/has already been submitted|already exists|already submitted/i);
  });

  // Scenario 5: Customer A is REJECTED for blurry photo; Customer B attempts same invoice within 7 days.
  // Expected: Customer B REJECTED (identity reserved for Customer A).
  it('Scenario 5: Competing submission against REJECTED bill within 7 days is rejected as reserved', async () => {
    const invoiceNum = 'SCENARIO-05';
    const invoiceDate = '2026-10-16';

    const billA = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 4500,
      fileBuffer: makePdf('scen5_custA'),
      fileName: 'blurry_invoice.pdf',
      mimeType: 'application/pdf',
    });

    // Bill Admin rejects the bill for blurriness
    const rejectedBill = await BillService.rejectBill(billA.id, billAdmin.id, 'Image is blurry and illegible');
    expect(rejectedBill.status).toBe('REJECTED');
    expect(rejectedBill.reservationExpiresAt).toBeDefined();

    // Customer B attempts to claim the same invoice while Customer A's reservation is active
    await expect(
      BillService.submitBill({
        userId: custB.id,
        invoiceNumber: invoiceNum,
        invoiceDate,
        billAmount: 4500,
        fileBuffer: makePdf('scen5_custB'),
        fileName: 'custB_attempt.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/reserved by another customer/i);
  });

  // Scenario 6: Customer A resubmits corrected revision with parentBillId.
  // Expected: Succeeded as Revision 2.
  it('Scenario 6: Original claimant resubmission of REJECTED bill succeeds as Revision 2', async () => {
    const invoiceNum = 'SCENARIO-06';
    const invoiceDate = '2026-10-18';

    const billRev1 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 5000,
      fileBuffer: makePdf('scen6_rev1'),
      fileName: 'rev1.pdf',
      mimeType: 'application/pdf',
    });

    await BillService.rejectBill(billRev1.id, billAdmin.id, 'Please upload clearer image');

    // Customer A resubmits with parentBillId
    const billRev2 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 5000,
      fileBuffer: makePdf('scen6_rev2_clear'),
      fileName: 'rev2_clear.pdf',
      mimeType: 'application/pdf',
      parentBillId: billRev1.id,
    });

    expect(billRev2.revisionNumber).toBe(2);
    expect(billRev2.parentBillId).toBe(billRev1.id);
    expect(billRev2.status).toBe('PENDING');
  });

  // Scenario 7: Customer A attempts to fork revision chain (resubmit same parent twice).
  // Expected: Database @unique blocks second child.
  it('Scenario 7: Forking revision chain (submitting two revisions from same parent) is blocked', async () => {
    const invoiceNum = 'SCENARIO-07';
    const invoiceDate = '2026-10-19';

    const billRev1 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 2000,
      fileBuffer: makePdf('scen7_rev1'),
      fileName: 'rev1.pdf',
      mimeType: 'application/pdf',
    });

    await BillService.rejectBill(billRev1.id, billAdmin.id, 'Blurry');

    // First child
    await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 2000,
      fileBuffer: makePdf('scen7_rev2_a'),
      fileName: 'rev2_a.pdf',
      mimeType: 'application/pdf',
      parentBillId: billRev1.id,
    });

    // Attempt second child from the same parent
    await expect(
      BillService.submitBill({
        userId: custA.id,
        invoiceNumber: invoiceNum,
        invoiceDate,
        billAmount: 2000,
        fileBuffer: makePdf('scen7_rev2_b'),
        fileName: 'rev2_b.pdf',
        mimeType: 'application/pdf',
        parentBillId: billRev1.id,
      })
    ).rejects.toThrow(/undergoing review|already superseded|already exists/i);
  });

  // Scenario 8: Revision 2 has >25% higher gross amount than Revision 1.
  // Expected: Flagged for secondary approval (requiresSecondaryApproval = true, status = UNDER_REVIEW).
  it('Scenario 8: Revision exceeding 25% upward deviation triggers secondary approval requirement', async () => {
    const invoiceNum = 'SCENARIO-08';
    const invoiceDate = '2026-10-20';

    const billRev1 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 4000,
      fileBuffer: makePdf('scen8_rev1'),
      fileName: 'rev1.pdf',
      mimeType: 'application/pdf',
    });

    await BillService.rejectBill(billRev1.id, billAdmin.id, 'Wrong amount entered');

    // Resubmit at 5,500 (>37.5% increase)
    const billRev2 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 5500,
      fileBuffer: makePdf('scen8_rev2'),
      fileName: 'rev2.pdf',
      mimeType: 'application/pdf',
      parentBillId: billRev1.id,
    });

    expect(billRev2.requiresSecondaryApproval).toBe(true);
    expect(billRev2.status).toBe('UNDER_REVIEW');
  });

  // Scenario 9: Verifier of Revision 1 attempts secondary approval on Revision 2.
  // Expected: Blocked with dual-custody error.
  it('Scenario 9: Verifier of high-deviation bill cannot act as secondary approver (dual control)', async () => {
    const invoiceNum = 'SCENARIO-09';
    const invoiceDate = '2026-10-21';

    const billRev1 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 1000,
      fileBuffer: makePdf('scen9_rev1'),
      fileName: 'rev1.pdf',
      mimeType: 'application/pdf',
    });

    await BillService.rejectBill(billRev1.id, billAdmin.id, 'Illegible');

    // Upward deviation revision (>50% increase)
    const billRev2 = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 2000,
      fileBuffer: makePdf('scen9_rev2'),
      fileName: 'rev2.pdf',
      mimeType: 'application/pdf',
      parentBillId: billRev1.id,
    });

    // Primary verification by Bill Admin
    await BillService.recordPrimaryVerification(billRev2.id, billAdmin.id, { remarks: 'Primary verified' });

    // Bill Admin tries to perform secondary approval
    await expect(
      BillService.approveBill(billRev2.id, billAdmin.id, {
        gstIncluded: false,
        gstRate: 0,
        isOperationsAdminApproved: true,
      })
    ).rejects.toThrow(/cannot be the same administrator|dual-control|dual control/i);
  });

  // Scenario 10: Customer A bill is marked CANCELLED for fraud; Customer B attempts same invoice.
  // Expected: Customer B permanently blocked (disqualified).
  it('Scenario 10: CANCELLED fraudulent bill permanently disqualifies invoice identity', async () => {
    const invoiceNum = 'SCENARIO-10';
    const invoiceDate = '2026-10-22';

    const billA = await BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 12000,
      fileBuffer: makePdf('scen10_custA'),
      fileName: 'forged_bill.pdf',
      mimeType: 'application/pdf',
    });

    // Operations Admin cancels the bill as confirmed fraud
    const cancelledBill = await BillService.cancelBill(billA.id, opsAdmin.id, 'Confirmed forged invoice document');
    expect(cancelledBill.status).toBe('CANCELLED');
    expect(cancelledBill.isDisqualified).toBe(true);

    // Customer B tries to submit the disqualified invoice in the same month
    await expect(
      BillService.submitBill({
        userId: custB.id,
        invoiceNumber: invoiceNum,
        invoiceDate,
        billAmount: 12000,
        fileBuffer: makePdf('scen10_custB'),
        fileName: 'custB_attempt.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/disqualified|permanently blocked/i);

    // Even Customer A cannot resubmit a disqualified invoice
    await expect(
      BillService.submitBill({
        userId: custA.id,
        invoiceNumber: invoiceNum,
        invoiceDate,
        billAmount: 12000,
        fileBuffer: makePdf('scen10_custA_retry'),
        fileName: 'custA_retry.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/disqualified|permanently blocked/i);
  });

  // Scenario 11: Concurrent submissions of identical invoice by two customers.
  // Expected: Advisory lock / transaction serializes; one succeeds, second rejected cleanly.
  it('Scenario 11: Concurrent submissions of identical invoice are safely serialized', async () => {
    const invoiceNum = 'SCENARIO-11';
    const invoiceDate = '2026-10-23';

    const p1 = BillService.submitBill({
      userId: custA.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 3500,
      fileBuffer: makePdf('scen11_p1'),
      fileName: 'p1.pdf',
      mimeType: 'application/pdf',
    });

    const p2 = BillService.submitBill({
      userId: custB.id,
      invoiceNumber: invoiceNum,
      invoiceDate,
      billAmount: 3500,
      fileBuffer: makePdf('scen11_p2'),
      fileName: 'p2.pdf',
      mimeType: 'application/pdf',
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  // Scenario 12: Customer attempts invoice submission with non-alphanumeric string.
  // Expected: Backend/trigger reject with clear validation error.
  it('Scenario 12: Invoice submission with non-alphanumeric string is rejected', async () => {
    await expect(
      BillService.submitBill({
        userId: custA.id,
        invoiceNumber: '###---***',
        invoiceDate: '2026-10-24',
        billAmount: 1000,
        fileBuffer: makePdf('scen12_invalid'),
        fileName: 'invalid.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toThrow(/letter or digit|alphanumeric|valid invoice number/i);
  });
});
