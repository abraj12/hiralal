import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { GstService } from '../services/gst.service';
import { AuthService } from '../services/auth.service';
import { RewardService } from '../services/reward.service';
import { calculateRewardAmount } from '../utils/money.utils';
import { parseIndiaEffectiveDateTime } from '../utils/timezone.utils';
import { getAdminApiBase } from '../utils/adminApi.utils';
import { getOrCreateBillAdmin, getOrCreateOpsAdmin, resetAdmins } from './test_helpers';

describe('Master Remediation & Requirements Compliance Test Suite', () => {
  beforeAll(async () => {
    await resetAdmins(prisma);
  });

  afterAll(async () => {
    await resetAdmins(prisma);
    await prisma.$disconnect();
  });

  describe('1. Strict Reverse GST Calculation & Fail-Closed Errors', () => {
    it('calculates exact reverse GST for 18% standard rate', () => {
      const result = GstService.calculateReverseGst(11800, true, 18);
      expect(result.eligibleRewardAmount).toBe(10000);
      expect(result.gstAmount).toBe(1800);
      expect(result.gstRate).toBe(18);
    });

    it('calculates exact reverse GST for 12% concessional rate', () => {
      const result = GstService.calculateReverseGst(11200, true, 12);
      expect(result.eligibleRewardAmount).toBe(10000);
      expect(result.gstAmount).toBe(1200);
      expect(result.gstRate).toBe(12);
    });

    it('returns full amount as eligible when GST is not included', () => {
      const result = GstService.calculateReverseGst(10000, false, null);
      expect(result.eligibleRewardAmount).toBe(10000);
      expect(result.gstAmount).toBe(0);
      expect(result.gstRate).toBeNull();
    });

    it('fails closed with [NO_APPLICABLE_GST_RULE] when GST is included but rate is missing or null', () => {
      expect(() => GstService.calculateReverseGst(10000, true, null)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
      expect(() => GstService.calculateReverseGst(10000, true, undefined as any)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
    });

    it('fails closed with [NO_APPLICABLE_GST_RULE] when GST is included but rate is zero or negative', () => {
      expect(() => GstService.calculateReverseGst(10000, true, 0)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
      expect(() => GstService.calculateReverseGst(10000, true, -5)).toThrow(/\[NO_APPLICABLE_GST_RULE\]/);
    });
  });

  describe('2. Reward Rate Parameter Enforcement (No Default 0.50% Fallbacks)', () => {
    it('calculates reward given explicit positive percentage', () => {
      const reward = calculateRewardAmount(10000, 0.75);
      expect(reward).toBe(75);
    });

    it('fails closed when reward percentage is not provided or invalid', () => {
      expect(() => (calculateRewardAmount as any)(10000)).toThrow(/Reward rate percentage is required/);
      expect(() => calculateRewardAmount(10000, 0)).toThrow(/finite positive number/);
      expect(() => calculateRewardAmount(10000, -1)).toThrow(/finite positive number/);
      expect(() => calculateRewardAmount(10000, NaN)).toThrow(/finite positive number/);
    });
  });

  describe('3. Timezone & Effective Date/Time Preservation (Asia/Kolkata)', () => {
    it('preserves exact hours, minutes, and seconds in Asia/Kolkata without midnight truncation', () => {
      const dt = parseIndiaEffectiveDateTime('2026-10-15T14:30:45+05:30');
      // 14:30:45 IST is 09:00:45 UTC
      expect(dt.getUTCHours()).toBe(9);
      expect(dt.getUTCMinutes()).toBe(0);
      expect(dt.getUTCSeconds()).toBe(45);
    });

    it('handles ISO timestamp preserving exact time', () => {
      const dt = parseIndiaEffectiveDateTime('2026-10-15T18:00:00+05:30');
      expect(dt.getUTCHours()).toBe(12);
      expect(dt.getUTCMinutes()).toBe(30);
    });
  });

  describe('4. Persistent Account Lockout After 10 Failed Password Attempts', () => {
    const testUserMobile = '9876540001';
    const rawPassword = 'ValidPassword123!';

    beforeAll(async () => {
      const passwordHash = await bcrypt.hash(rawPassword, 10);
      await prisma.user.upsert({
        where: { mobile: testUserMobile },
        update: {
          passwordHash,
          failedPasswordAttempts: 0,
          lockedUntil: null,
          status: 'ACTIVE',
        },
        create: {
          mobile: testUserMobile,
          fullName: 'Test Lockout User',
          passwordHash,
          profession: 'PLUMBER',
          role: 'USER',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
    });

    it('increments failedPasswordAttempts on incorrect password', async () => {
      await expect(AuthService.login(testUserMobile, 'WrongPassword1')).rejects.toThrow('Invalid mobile number or password.');
      const user = await prisma.user.findUnique({ where: { mobile: testUserMobile } });
      expect(user?.failedPasswordAttempts).toBe(1);
      expect(user?.lockedUntil).toBeNull();
    });

    it('locks out account after 10 failed password attempts', async () => {
      // Execute 8 more failed attempts (reaching 9)
      for (let i = 2; i <= 9; i++) {
        await expect(AuthService.login(testUserMobile, `WrongPassword${i}`)).rejects.toThrow();
      }

      const userAt9 = await prisma.user.findUnique({ where: { mobile: testUserMobile } });
      expect(userAt9?.failedPasswordAttempts).toBe(9);

      // The 10th failed attempt triggers the lockout
      await expect(AuthService.login(testUserMobile, 'WrongPassword10')).rejects.toThrow(
        /Account is temporarily locked due to too many failed login attempts/
      );

      const userLocked = await prisma.user.findUnique({ where: { mobile: testUserMobile } });
      expect(userLocked?.failedPasswordAttempts).toBe(10);
      expect(userLocked?.lockedUntil).not.toBeNull();
      expect(userLocked?.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects even correct password while account is locked', async () => {
      await expect(AuthService.login(testUserMobile, rawPassword)).rejects.toThrow(
        /Account is temporarily locked due to too many failed login attempts/
      );
    });

    it('resets failedPasswordAttempts and lockedUntil to 0 upon successful login after lockout expires', async () => {
      // Clear lockout timestamp
      await prisma.user.update({
        where: { mobile: testUserMobile },
        data: { lockedUntil: null },
      });

      const session = await AuthService.login(testUserMobile, rawPassword);
      expect(session).toBeDefined();

      const userClean = await prisma.user.findUnique({ where: { mobile: testUserMobile } });
      expect(userClean?.failedPasswordAttempts).toBe(0);
      expect(userClean?.lockedUntil).toBeNull();
    });
  });

  describe('5. Role Separation on /api/v1/admin/dashboard Endpoint', () => {
    let billAdminToken: string;
    let opsAdminToken: string;

    beforeAll(async () => {
      const billAdmin = await getOrCreateBillAdmin(prisma, '9876540008');
      const opsAdmin = await getOrCreateOpsAdmin(prisma, '9876540009');

      billAdminToken = jwt.sign(
        { userId: billAdmin.id, role: 'BILL_ADMIN', mobile: billAdmin.mobile },
        config.admin.accessSecret,
        { expiresIn: '1d' }
      );
      opsAdminToken = jwt.sign(
        { userId: opsAdmin.id, role: 'OPERATIONS_ADMIN', mobile: opsAdmin.mobile },
        config.admin.accessSecret,
        { expiresIn: '1d' }
      );
    });

    it('returns only bill review stats and recent bills for BILL_ADMIN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${billAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
      expect(res.body.recentBills).toBeDefined();

      // Bill admin stats must be present
      expect(res.body.stats.pendingBills).toBeDefined();
      expect(res.body.stats.approvedBillsCount).toBeDefined();
      expect(res.body.stats.rejectedBillsCount).toBeDefined();
      expect(res.body.stats.rewardsThisMonth).toBeDefined();

      // Operational metrics must NOT be present for BILL_ADMIN
      expect(res.body.stats.totalUsers).toBeUndefined();
      expect(res.body.stats.plumbersCount).toBeUndefined();
      expect(res.body.stats.tilesCount).toBeUndefined();
      expect(res.body.stats.totalRewardsCredited).toBeUndefined();
      expect(res.body.stats.availableWalletLiability).toBeUndefined();
      expect(res.body.stats.reservedWalletLiability).toBeUndefined();
      expect(res.body.stats.pendingPayouts).toBeUndefined();
      expect(res.body.stats.programTotals).toBeUndefined();
    });

    it('returns full operational metrics for OPERATIONS_ADMIN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${opsAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats).toBeDefined();
      expect(res.body.recentBills).toBeDefined();

      // Operational metrics must be present for OPERATIONS_ADMIN
      expect(res.body.stats.totalUsers).toBeDefined();
      expect(res.body.stats.plumbersCount).toBeDefined();
      expect(res.body.stats.tilesCount).toBeDefined();
      expect(res.body.stats.pendingBills).toBeDefined();
      expect(res.body.stats.totalRewardsCredited).toBeDefined();
      expect(res.body.stats.availableWalletLiability).toBeDefined();
      expect(res.body.stats.reservedWalletLiability).toBeDefined();
      expect(res.body.stats.pendingPayouts).toBeDefined();
      expect(res.body.stats.programTotals).toBeDefined();
    });
  });

  describe('6. Canonical /api/v1 and Compatibility /api Routing', () => {
    it('serves canonical /api/v1 route', async () => {
      const res = await request(app).get('/api/v1/auth/admin-prefixes');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('serves backwards-compatible /api alias route', async () => {
      const res = await request(app).get('/api/auth/admin-prefixes');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('7. Production API URL Validation', () => {
    it('getAdminApiBase defaults to /api/v1 when NEXT_PUBLIC_API_URL is unset', () => {
      expect(getAdminApiBase(undefined, 'production')).toBe('/api/v1');
    });

    it('getAdminApiBase rejects insecure HTTP in production and falls back to /api/v1', () => {
      expect(getAdminApiBase('http://insecure-host.com/api', 'production')).toBe('/api/v1');
    });

    it('getAdminApiBase accepts secure HTTPS URL in production', () => {
      expect(getAdminApiBase('https://hsspl.algions.in/api/v1', 'production')).toBe('https://hsspl.algions.in/api/v1');
    });
  });
});
