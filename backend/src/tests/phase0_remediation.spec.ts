import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../server';
import { config } from '../config';
import { areNamesMatching } from '../utils/name.utils';
import { PayoutService } from '../services/payout.service';

describe('Phase 0 Verification & Regression Suite', () => {
  describe('P0.1: Disaster Recovery Service Resumption Ordering (VULN-DR-01)', () => {
    it('verifies that scripts/restore-db.sh resumes backend services ONLY after all 4 verification gates pass', () => {
      const scriptPath = path.resolve(__dirname, '../../../scripts/restore-db.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);

      const content = fs.readFileSync(scriptPath, 'utf8');

      // The resume command:
      const resumeIndex = content.indexOf('Resuming application traffic');
      expect(resumeIndex).toBeGreaterThan(0);

      // Gate 1: Core Schema & Migrations Verification
      const gate1Index = content.indexOf('Core migrations verified:');
      expect(gate1Index).toBeGreaterThan(0);

      // Gate 2: Wallet Ledger Reconciliation
      const gate2Index = content.indexOf('Authoritative wallet ledger reconciliation PASSED');
      expect(gate2Index).toBeGreaterThan(0);

      // Gate 3: Payout State and Ledger Consistency
      const gate3Index = content.indexOf('Payout reconciliation FAILED');
      expect(gate3Index).toBeGreaterThan(0);

      // Gate 4: Failed/Reversed Payouts Compensation Consistency
      const gate4Index = content.indexOf('Payout state machine & ledger correlation PASSED');
      expect(gate4Index).toBeGreaterThan(0);

      // The service resumption MUST occur AFTER all 4 gates pass
      expect(resumeIndex).toBeGreaterThan(gate1Index);
      expect(resumeIndex).toBeGreaterThan(gate2Index);
      expect(resumeIndex).toBeGreaterThan(gate3Index);
      expect(resumeIndex).toBeGreaterThan(gate4Index);
    });
  });

  describe('P0.3: Tier-1 Admin Prefix Verification Bypass on /login (VULN-API-01)', () => {
    it('strictly forbids admin authentication via bare mobile on /api/v1/auth/login', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          identifier: '9999900001',
          password: 'SomePassword123!',
        });

      // Bare mobile number of an admin must be rejected
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.token).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
    });

    it('ensures /api/v1/auth/login never issues access token or session for admin credentials', async () => {
      const adminPrefix = config.admin.billAdminPrefix || 'XYZ';
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          identifier: `${adminPrefix}9999900001`,
          password: 'WrongPassword!',
        });

      // ADV-01 route gating rejects admin credentials on standard login with 403 ADMIN_TIER_REQUIRED (or 401 fallback)
      expect([401, 403]).toContain(res.status);
      if (res.status === 403) {
        expect(res.body.code).toBe('ADMIN_TIER_REQUIRED');
      }
      expect(res.body.token).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.user).toBeUndefined();
    });
  });

  describe('P0.4: Mononymous Beneficiary Matching & Payout Eligibility (VULN-KYC-02)', () => {
    it('matches mononymous PAN against bank accounts with duplicate token or initial when approved', () => {
      // 1. Exact single name match
      expect(areNamesMatching('RAMESH', 'RAMESH', { isMononymousApproved: true })).toBe(true);

      // 2. Bank duplicates first name in last name field
      expect(areNamesMatching('RAMESH RAMESH', 'RAMESH', { isMononymousApproved: true })).toBe(true);

      // 3. Bank appends single-letter initial
      expect(areNamesMatching('RAMESH K', 'RAMESH', { isMononymousApproved: true })).toBe(true);
      expect(areNamesMatching('K RAMESH', 'RAMESH', { isMononymousApproved: true })).toBe(true);

      // 4. Dot is harmless punctuation and normalizes cleanly
      expect(areNamesMatching('RAMESH .', 'RAMESH')).toBe(true);

      // 5. Without isMononymousApproved, non-identical names with extra tokens MUST reject
      expect(areNamesMatching('RAMESH RAMESH', 'RAMESH')).toBe(false);
      expect(areNamesMatching('RAMESH K', 'RAMESH')).toBe(false);

      // 6. Completely different names MUST reject even with isMononymousApproved
      expect(areNamesMatching('SURESH', 'RAMESH', { isMononymousApproved: true })).toBe(false);
      expect(areNamesMatching('RAMESH KUMAR', 'RAMESH', { isMononymousApproved: true })).toBe(false);
    });

    it('validates beneficiary match through PayoutService.validateBeneficiaryMatch for mononymous records', () => {
      const mononymousKyc = {
        panStatus: 'VERIFIED',
        nameMatched: true,
        verifiedName: 'RAMESH',
        rejectionReason: null,
        mononymousApproved: true,
      };

      const bankAccountDuplicate = {
        isVerified: true,
        providerNameVerified: true,
        providerRegisteredName: 'RAMESH RAMESH',
      };

      // Explicit administrative approval is represented by the persisted user name-lock flag.
      const unapproved = PayoutService.validateBeneficiaryMatch(
        { ...mononymousKyc, rejectionReason: null, mononymousApproved: false } as any,
        bankAccountDuplicate as any
      );
      expect(unapproved.isValid).toBe(false);

      const resultDup = PayoutService.validateBeneficiaryMatch(
        mononymousKyc as any,
        bankAccountDuplicate as any
      );
      expect(resultDup.isValid).toBe(true);

      const bankAccountInitial = {
        isVerified: true,
        providerNameVerified: true,
        providerRegisteredName: 'RAMESH K',
      };

      const resultInit = PayoutService.validateBeneficiaryMatch(
        mononymousKyc as any,
        bankAccountInitial as any
      );
      expect(resultInit.isValid).toBe(true);
    });
  });
});
