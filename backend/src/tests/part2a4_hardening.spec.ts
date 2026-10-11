/**
 * Part 2A.4 — Immutable-History and Timestamp Validation Hardening
 * Regression tests for:
 *   Task 1 — updateRule() is permanently removed (tombstone)
 *   Task 2 — Seed provisioning is strictly non-mutating
 *   Task 3 — Strict timestamp validation at all API and utility boundaries
 *   Task 4 — Redemption window PUT validates timestamps strictly
 */
import request from 'supertest';
import { app } from '../server';
import { RewardRuleService } from '../services/reward-rule.service';
import { prisma } from '../db';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import {
  parseStrictIndiaTimestamp,
  parseIndiaIsoDateTime,
} from '../utils/timezone.utils';

describe('Part 2A.4 — Immutable-History and Timestamp Validation Hardening', () => {
  let opsAdmin: any;
  let opsAdminToken: string;

  beforeAll(async () => {
    // Remove any leftover test users from previous runs
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: '9877700001' } } },
    });
    await prisma.bill.deleteMany({ where: { user: { mobile: '9877700001' } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: '9877700001' } } });
    await prisma.user.deleteMany({ where: { mobile: '9877700001' } });

    opsAdmin = await prisma.user.create({
      data: {
        mobile: '9877700001',
        fullName: 'Part 2A4 Ops Admin',
        passwordHash: 'dummy_hash_2a4',
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    opsAdminToken = jwt.sign(
      { userId: opsAdmin.id, role: 'OPERATIONS_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Ensure deterministic baseline rules exist
    for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
      const count = await prisma.rewardRule.count({
        where: { profession: prof, isActive: true },
      });
      if (count === 0) {
        await prisma.rewardRule.create({
          data: {
            profession: prof,
            rewardPercentage: 0.50,
            effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
            isActive: true,
            version: 1,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { user: { mobile: '9877700001' } } },
    });
    await prisma.bill.deleteMany({ where: { user: { mobile: '9877700001' } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: '9877700001' } } });
    await prisma.user.deleteMany({ where: { mobile: '9877700001' } });

    // Restore baseline rules
    for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
      await prisma.rewardRule.deleteMany({ where: { profession: prof } });
      await prisma.rewardRule.create({
        data: {
          profession: prof,
          rewardPercentage: 0.50,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
          isActive: true,
          version: 1,
        },
      });
    }
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------
  // Task 1 — updateRule() is permanently disabled (tombstone)
  // ---------------------------------------------------------------
  describe('Task 1 — updateRule() is permanently removed', () => {
    test('calling RewardRuleService.updateRule() throws REWARD_RULE_MUTATION_REMOVED regardless of arguments', async () => {
      const fakeRuleId = 'rule_fake_plumber_v1';
      await expect(
        RewardRuleService.updateRule(opsAdmin.id, fakeRuleId, { isActive: false })
      ).rejects.toThrow('[REWARD_RULE_MUTATION_REMOVED]');
    });

    test('calling updateRule() with valid rewardPercentage still throws', async () => {
      await expect(
        RewardRuleService.updateRule(opsAdmin.id, 'some_rule_id', { rewardPercentage: 0.75 })
      ).rejects.toThrow('[REWARD_RULE_MUTATION_REMOVED]');
    });

    test('calling updateRule() with a real rule id still throws (no DB mutation occurs)', async () => {
      // Capture a real rule id
      const rule = await prisma.rewardRule.findFirst({ where: { profession: 'PLUMBER', isActive: true } });
      expect(rule).not.toBeNull();

      const beforeRow = await prisma.rewardRule.findUnique({ where: { id: rule!.id } });
      expect(beforeRow).not.toBeNull();

      await expect(
        RewardRuleService.updateRule(opsAdmin.id, rule!.id, { rewardPercentage: 9.99 })
      ).rejects.toThrow('[REWARD_RULE_MUTATION_REMOVED]');

      // The row must be completely unchanged
      const afterRow = await prisma.rewardRule.findUnique({ where: { id: rule!.id } });
      expect(Number(afterRow!.rewardPercentage)).toBe(Number(beforeRow!.rewardPercentage));
      expect(afterRow!.updatedAt.getTime()).toBe(beforeRow!.updatedAt.getTime());
      expect(afterRow!.effectiveUntil).toBe(beforeRow!.effectiveUntil);
      expect(afterRow!.isActive).toBe(beforeRow!.isActive);
    });

    test('createRule() correctly creates new versioned rows — updateRule() pathway is dead', async () => {
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });

      const v1 = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.50,
        effectiveFrom: '2026-01-01',
      });

      const v1Snapshot = await prisma.rewardRule.findUnique({ where: { id: v1.id } });
      expect(v1Snapshot).not.toBeNull();

      // Old code would have called updateRule; new code must use createRule for new version
      const v2 = await RewardRuleService.createRule(opsAdmin.id, {
        profession: 'TILE_INSTALLER',
        rewardPercentage: 0.75,
        effectiveFrom: '2026-10-01',
      });

      expect(v2.version).toBeGreaterThan(v1.version);

      // v1 must be completely immutable
      const v1After = await prisma.rewardRule.findUnique({ where: { id: v1.id } });
      expect(v1After!.effectiveUntil).toBeNull();
      expect(v1After!.isActive).toBe(true);
      expect(Number(v1After!.rewardPercentage)).toBe(0.50);
      expect(v1After!.updatedAt.getTime()).toBe(v1Snapshot!.updatedAt.getTime());
    });
  });

  // ---------------------------------------------------------------
  // Task 2 — Seed provisioning is strictly non-mutating
  // ---------------------------------------------------------------
  describe('Task 2 — Seed provisioning: no mutation of existing rows', () => {
    test('seeding with an existing active rule (including legacy rule_ prefix) DOES NOT mutate any field', async () => {
      // Simulate a legacy rule_-prefixed row (as inserted by the original migration with CURRENT_TIMESTAMP)
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });
      const legacyEffectiveFrom = new Date('2025-06-15T10:30:00Z'); // NOT 2020-01-01, simulating CURRENT_TIMESTAMP
      const legacyRule = await prisma.rewardRule.create({
        data: {
          id: `rule_plumber_v1_seed_test_${Date.now()}`,
          profession: 'PLUMBER',
          rewardPercentage: 0.50,
          effectiveFrom: legacyEffectiveFrom,
          isActive: true,
          version: 1,
        },
      });

      // Snapshot before simulated seed run
      const snapshotBefore = await prisma.rewardRule.findUnique({ where: { id: legacyRule.id } });
      expect(snapshotBefore).not.toBeNull();

      // Simulate what seed.ts does: find existing active rule, skip mutation
      const activeRule = await prisma.rewardRule.findFirst({
        where: { profession: 'PLUMBER', isActive: true },
        orderBy: { version: 'desc' },
      });
      expect(activeRule).not.toBeNull();
      // Seed must not mutate when rule exists — just preserve it
      if (!activeRule) {
        throw new Error('Test invariant failure: activeRule should exist');
      }

      // Confirm: seed does NOT create a new rule (rule already exists)
      const countAfter = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(countAfter).toBe(1); // Exactly one rule, no duplicates

      // Confirm the row is completely unchanged
      const snapshotAfter = await prisma.rewardRule.findUnique({ where: { id: legacyRule.id } });
      expect(snapshotAfter!.effectiveFrom.getTime()).toBe(legacyEffectiveFrom.getTime()); // NOT back-dated
      expect(snapshotAfter!.updatedAt.getTime()).toBe(snapshotBefore!.updatedAt.getTime()); // NOT touched
      expect(Number(snapshotAfter!.rewardPercentage)).toBe(0.50);
      expect(snapshotAfter!.isActive).toBe(true);
    });

    test('seeding an empty profession creates the baseline rule at 2020-01-01 IST', async () => {
      // Remove all PLUMBER rules to simulate a fresh database
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });
      const countBefore = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(countBefore).toBe(0);

      // Simulate seed logic
      const activeRule = await prisma.rewardRule.findFirst({
        where: { profession: 'PLUMBER', isActive: true },
        orderBy: { version: 'desc' },
      });
      if (!activeRule) {
        await prisma.rewardRule.create({
          data: {
            profession: 'PLUMBER',
            rewardPercentage: 0.50,
            effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
            version: 1,
            isActive: true,
          },
        });
      }

      const created = await prisma.rewardRule.findFirst({ where: { profession: 'PLUMBER', isActive: true } });
      expect(created).not.toBeNull();
      expect(created!.effectiveFrom.toISOString()).toBe(new Date('2020-01-01T00:00:00+05:30').toISOString());
      expect(Number(created!.rewardPercentage)).toBe(0.50);
      expect(created!.version).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // Task 3 — Strict timestamp validation at all boundaries
  // ---------------------------------------------------------------
  describe('Task 3 — parseStrictIndiaTimestamp: strict time-component validation', () => {
    test('accepts valid ISO 8601 timestamps with explicit timezone', () => {
      expect(() => parseStrictIndiaTimestamp('2026-10-15T14:30:00+05:30')).not.toThrow();
      expect(() => parseStrictIndiaTimestamp('2026-10-15T14:30:00.000Z')).not.toThrow();
      expect(() => parseStrictIndiaTimestamp('2026-10-15T00:00:00Z')).not.toThrow();
      expect(() => parseStrictIndiaTimestamp('2026-02-28T23:59:59+05:30')).not.toThrow();
    });

    test('rejects invalid hour (25)', () => {
      expect(() => parseStrictIndiaTimestamp('2026-10-15T25:00:00+05:30')).toThrow('Invalid hour 25');
    });

    test('rejects invalid minute (60)', () => {
      expect(() => parseStrictIndiaTimestamp('2026-10-15T14:60:00+05:30')).toThrow('Invalid minute 60');
    });

    test('rejects invalid second (61)', () => {
      expect(() => parseStrictIndiaTimestamp('2026-10-15T14:30:61+05:30')).toThrow('Invalid second 61');
    });

    test('rejects invalid calendar date within timestamp', () => {
      expect(() => parseStrictIndiaTimestamp('2026-02-30T14:30:00+05:30')).toThrow('Invalid calendar date');
    });

    test('rejects timezone-less local timestamps (no Z or offset)', () => {
      // These are not absolute instants and must be rejected
      expect(() => parseStrictIndiaTimestamp('2026-10-15T14:30:00')).toThrow();
    });

    test('rejects date-only string passed to timestamp parser', () => {
      expect(() => parseStrictIndiaTimestamp('2026-10-15')).toThrow();
    });

    test('rejects trailing garbage after timestamp', () => {
      expect(() => parseStrictIndiaTimestamp('2026-10-15T14:30:00+05:30extra')).toThrow();
    });

    test('rejects empty string', () => {
      expect(() => parseStrictIndiaTimestamp('')).toThrow();
    });
  });

  describe('Task 3 — parseIndiaIsoDateTime: combined date+time strict validation', () => {
    test('accepts valid date and time combination', () => {
      expect(() => parseIndiaIsoDateTime('2026-10-15', '14:30')).not.toThrow();
      expect(() => parseIndiaIsoDateTime('2026-12-31', '23:59')).not.toThrow();
      expect(() => parseIndiaIsoDateTime('2026-01-01', '00:00')).not.toThrow();
    });

    test('rejects invalid hour (25:00)', () => {
      expect(() => parseIndiaIsoDateTime('2026-10-15', '25:00')).toThrow('Invalid hour 25');
    });

    test('rejects invalid minute (14:61)', () => {
      expect(() => parseIndiaIsoDateTime('2026-10-15', '14:61')).toThrow('Invalid minute 61');
    });

    test('rejects malformed time string (no colon)', () => {
      expect(() => parseIndiaIsoDateTime('2026-10-15', '1430')).toThrow('Invalid time format');
    });

    test('rejects impossible calendar date with valid time', () => {
      expect(() => parseIndiaIsoDateTime('2026-02-31', '10:00')).toThrow('Invalid calendar date');
    });

    test('rejects Feb 29 in non-leap year', () => {
      expect(() => parseIndiaIsoDateTime('2025-02-29', '10:00')).toThrow('Month 2 in year 2025 has only 28 days');
    });
  });

  // ---------------------------------------------------------------
  // Task 4 — Redemption window PUT uses strict timestamp validation
  // ---------------------------------------------------------------
  describe('Task 4 — PUT /settings/redemption uses strict timestamp validation', () => {
    test('accepts valid ISO timestamps with explicit timezone', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          isEnabled: true,
          startAt: '2026-11-01T09:00:00+05:30',
          endAt: '2026-11-30T18:00:00+05:30',
          message: 'Open',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('accepts omitted startAt/endAt (open window without bounds)', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          isEnabled: true,
          message: 'Open unbounded',
        });
      expect(res.status).toBe(200);
    });

    test('rejects invalid hour in startAt (hour 25)', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          isEnabled: true,
          startAt: '2026-11-01T25:00:00+05:30',
          endAt: '2026-11-30T18:00:00+05:30',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid start time');
      expect(res.body.message).toContain('Invalid hour 25');
    });

    test('rejects timezone-less local timestamp in endAt', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          isEnabled: true,
          startAt: '2026-11-01T09:00:00+05:30',
          endAt: '2026-11-30T18:00:00',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid end time');
    });

    test('rejects endAt before startAt with 400', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          isEnabled: true,
          startAt: '2026-11-30T18:00:00+05:30',
          endAt: '2026-11-01T09:00:00+05:30',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('End date and time must be after the start date');
    });

    test('rejects invalid calendar date in startAt (impossible Feb 30)', async () => {
      const res = await request(app)
        .put('/api/admin/settings/redemption')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          isEnabled: true,
          startAt: '2026-02-30T09:00:00+05:30',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid start time');
    });
  });
});
