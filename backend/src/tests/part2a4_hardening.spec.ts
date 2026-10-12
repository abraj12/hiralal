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
import { provisionRewardRules } from '../prisma/seed';

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

    const existingOpsAdmin = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (existingOpsAdmin) {
      opsAdmin = existingOpsAdmin;
    } else {
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
    }
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
  describe('Task 2 — Safe Baseline Seeding for All Historical States (Actual Implementation)', () => {
    let origEnv: string | undefined;
    beforeAll(() => {
      origEnv = process.env.ENABLE_DEV_REWARD_RULES;
      process.env.ENABLE_DEV_REWARD_RULES = 'true';
    });

    afterAll(() => {
      if (origEnv !== undefined) {
        process.env.ENABLE_DEV_REWARD_RULES = origEnv;
      } else {
        delete process.env.ENABLE_DEV_REWARD_RULES;
      }
    });

    test('1. Completely empty profession: one initial baseline is created', async () => {
      // Remove all PLUMBER rules to simulate a fresh database with 0 historical rows
      await prisma.rewardRule.deleteMany({ where: { profession: 'PLUMBER' } });
      const countBefore = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(countBefore).toBe(0);

      // Execute actual provisioning function
      const result = await provisionRewardRules(prisma);
      expect(result.provisioned).toContain('PLUMBER');

      // Verify exactly one baseline row was created
      const countAfter = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(countAfter).toBe(1);

      const created = await prisma.rewardRule.findFirst({ where: { profession: 'PLUMBER', isActive: true } });
      expect(created).not.toBeNull();
      expect(created!.effectiveFrom.toISOString()).toBe(new Date('2020-01-01T00:00:00+05:30').toISOString());
      expect(Number(created!.rewardPercentage)).toBe(0.50);
      expect(created!.version).toBe(1);
      expect(created!.isActive).toBe(true);
    });

    test('2. Existing active rule: all rows remain unchanged', async () => {
      // Ensure PLUMBER has an existing active rule
      const activeBefore = await prisma.rewardRule.findFirst({
        where: { profession: 'PLUMBER', isActive: true },
        orderBy: { version: 'desc' },
      });
      expect(activeBefore).not.toBeNull();
      const initialUpdatedAt = activeBefore!.updatedAt.getTime();
      const initialEffectiveFrom = activeBefore!.effectiveFrom.getTime();

      // Execute actual provisioning function
      const result = await provisionRewardRules(prisma);
      expect(result.preserved).toContain('PLUMBER');

      // Verify no new rows created and existing row completely untouched
      const count = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      expect(count).toBe(1);

      const reloaded = await prisma.rewardRule.findUnique({ where: { id: activeBefore!.id } });
      expect(reloaded!.updatedAt.getTime()).toBe(initialUpdatedAt);
      expect(reloaded!.effectiveFrom.getTime()).toBe(initialEffectiveFrom);
      expect(Number(reloaded!.rewardPercentage)).toBe(Number(activeBefore!.rewardPercentage));
      expect(reloaded!.isActive).toBe(true);
      expect(reloaded!.version).toBe(activeBefore!.version);
    });

    test('3. Existing inactive history with no active rule: no baseline created and no historical fields change', async () => {
      // Clear TILE_INSTALLER rules, then insert an INACTIVE historical rule
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });
      const inactiveHistory = await prisma.rewardRule.create({
        data: {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.65,
          effectiveFrom: new Date('2024-01-01T00:00:00+05:30'),
          isActive: false,
          version: 2,
        },
      });

      const countBefore = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countBefore).toBe(1);

      // Execute actual provisioning function
      const result = await provisionRewardRules(prisma);

      // Must be preserved without provisioning a new baseline
      expect(result.preserved).toContain('TILE_INSTALLER');
      expect(result.provisioned).not.toContain('TILE_INSTALLER');
      expect(result.warnings.some((w) => w.includes('TILE_INSTALLER') && w.includes('none is currently active'))).toBe(true);

      // Row count must NOT increase (no baseline created!)
      const countAfter = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countAfter).toBe(1);

      // The historical inactive row must be completely unchanged (no reactivation, no field changes)
      const reloaded = await prisma.rewardRule.findUnique({ where: { id: inactiveHistory.id } });
      expect(reloaded!.isActive).toBe(false); // NEVER implicitly resurrected
      expect(reloaded!.version).toBe(2); // NEVER rewritten to 1
      expect(Number(reloaded!.rewardPercentage)).toBe(0.65);
      expect(reloaded!.effectiveFrom.getTime()).toBe(inactiveHistory.effectiveFrom.getTime());
      expect(reloaded!.updatedAt.getTime()).toBe(inactiveHistory.updatedAt.getTime());
    });

    test('4. Multiple existing versions: seed neither creates duplicate versions nor modifies prior records', async () => {
      // Setup TILE_INSTALLER with two versions: v1 (inactive) and v2 (active)
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });
      const v1 = await prisma.rewardRule.create({
        data: {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.50,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
          isActive: false,
          version: 1,
        },
      });
      const v2 = await prisma.rewardRule.create({
        data: {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.75,
          effectiveFrom: new Date('2024-06-01T00:00:00+05:30'),
          isActive: true,
          version: 2,
        },
      });

      const countBefore = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countBefore).toBe(2);

      // Execute actual provisioning function
      const result = await provisionRewardRules(prisma);
      expect(result.preserved).toContain('TILE_INSTALLER');

      // Count remains 2: no duplicate v1, no duplicate v3 created
      const countAfter = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countAfter).toBe(2);

      // Verify neither v1 nor v2 was mutated
      const reloadedV1 = await prisma.rewardRule.findUnique({ where: { id: v1.id } });
      const reloadedV2 = await prisma.rewardRule.findUnique({ where: { id: v2.id } });
      expect(reloadedV1!.updatedAt.getTime()).toBe(v1.updatedAt.getTime());
      expect(reloadedV1!.isActive).toBe(false);
      expect(reloadedV2!.updatedAt.getTime()).toBe(v2.updatedAt.getTime());
      expect(reloadedV2!.isActive).toBe(true);
    });

    test('5. Concurrent seed execution: Promise.all creates exactly 1 baseline per profession without duplicate versions', async () => {
      // Clean slate for both professions
      await prisma.rewardRule.deleteMany({
        where: { profession: { in: ['PLUMBER', 'TILE_INSTALLER'] } },
      });
      const countPlumberBefore = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      const countTileBefore = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countPlumberBefore).toBe(0);
      expect(countTileBefore).toBe(0);

      // Concurrently invoke provisionRewardRules 3 times simultaneously
      const results = await Promise.all([
        provisionRewardRules(prisma),
        provisionRewardRules(prisma),
        provisionRewardRules(prisma),
      ]);

      // Exactly one baseline created per profession
      const countPlumberAfter = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      const countTileAfter = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countPlumberAfter).toBe(1);
      expect(countTileAfter).toBe(1);

      // Across the 3 results, exactly 1 must have provisioned PLUMBER, and 2 must have preserved it
      const plumberProvisionedCount = results.filter((r) => r.provisioned.includes('PLUMBER')).length;
      const plumberPreservedCount = results.filter((r) => r.preserved.includes('PLUMBER')).length;
      expect(plumberProvisionedCount).toBe(1);
      expect(plumberPreservedCount).toBe(2);

      const tileProvisionedCount = results.filter((r) => r.provisioned.includes('TILE_INSTALLER')).length;
      const tilePreservedCount = results.filter((r) => r.preserved.includes('TILE_INSTALLER')).length;
      expect(tileProvisionedCount).toBe(1);
      expect(tilePreservedCount).toBe(2);

      // Both created rules must be version 1 and active
      const plumberRule = await prisma.rewardRule.findFirst({ where: { profession: 'PLUMBER' } });
      const tileRule = await prisma.rewardRule.findFirst({ where: { profession: 'TILE_INSTALLER' } });
      expect(plumberRule!.version).toBe(1);
      expect(plumberRule!.isActive).toBe(true);
      expect(tileRule!.version).toBe(1);
      expect(tileRule!.isActive).toBe(true);

      // Assert zero duplicate (profession, version) records in the database
      const duplicates = await prisma.$queryRaw<Array<{ profession: string; version: number; count: bigint }>>`
        SELECT profession, version, COUNT(*) as count
        FROM "RewardRule"
        GROUP BY profession, version
        HAVING COUNT(*) > 1
      `;
      expect(duplicates.length).toBe(0);

      // Subsequent sequential invocation still preserves rules and creates 0 additional records
      const sequentialResult = await provisionRewardRules(prisma);
      expect(sequentialResult.provisioned).toHaveLength(0);
      expect(sequentialResult.preserved).toContain('PLUMBER');
      expect(sequentialResult.preserved).toContain('TILE_INSTALLER');

      const countPlumberFinal = await prisma.rewardRule.count({ where: { profession: 'PLUMBER' } });
      const countTileFinal = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countPlumberFinal).toBe(1);
      expect(countTileFinal).toBe(1);
    });

    test('6. Concurrent seed execution with existing inactive history preserves records without reactivation', async () => {
      // Clear TILE_INSTALLER and set up inactive historical version
      await prisma.rewardRule.deleteMany({ where: { profession: 'TILE_INSTALLER' } });
      const inactiveRule = await prisma.rewardRule.create({
        data: {
          profession: 'TILE_INSTALLER',
          rewardPercentage: 0.70,
          effectiveFrom: new Date('2025-01-01T00:00:00+05:30'),
          isActive: false,
          version: 3,
        },
      });

      // Concurrently invoke 3 times
      const results = await Promise.all([
        provisionRewardRules(prisma),
        provisionRewardRules(prisma),
        provisionRewardRules(prisma),
      ]);

      // All 3 executions must preserve TILE_INSTALLER and issue warnings; none should provision
      for (const res of results) {
        expect(res.provisioned).not.toContain('TILE_INSTALLER');
        expect(res.preserved).toContain('TILE_INSTALLER');
        expect(res.warnings.some((w) => w.includes('TILE_INSTALLER') && w.includes('none is currently active'))).toBe(true);
      }

      // Total count remains 1
      const countTile = await prisma.rewardRule.count({ where: { profession: 'TILE_INSTALLER' } });
      expect(countTile).toBe(1);

      // Record remains inactive and version unchanged
      const reloaded = await prisma.rewardRule.findUnique({ where: { id: inactiveRule.id } });
      expect(reloaded!.isActive).toBe(false);
      expect(reloaded!.version).toBe(3);
    });

    test('7. DB unique constraint defense-in-depth: inserting duplicate (profession, version) rejects at DB level', async () => {
      // PLUMBER already has version 1 from test 5
      const existing = await prisma.rewardRule.findFirst({ where: { profession: 'PLUMBER', version: 1 } });
      expect(existing).not.toBeNull();

      // Attempting to directly insert another PLUMBER version 1 must reject with unique constraint violation
      await expect(
        prisma.rewardRule.create({
          data: {
            profession: 'PLUMBER',
            rewardPercentage: 0.99,
            effectiveFrom: new Date('2026-05-01T00:00:00+05:30'),
            isActive: true,
            version: 1, // Duplicate version for PLUMBER
          },
        })
      ).rejects.toThrow();
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

  // ---------------------------------------------------------------
  // Task 2 (Part 2A.5) — Admin Helper Calendar Date & Time Validation
  // ---------------------------------------------------------------
  describe('Task 2 — Actual Admin Helper Calendar Date & Time Validation (admin/src/lib/date-utils.ts)', () => {
    const path = require('path');
    const adminDateUtilsPath = path.resolve(__dirname, '../../../admin/src/lib/date-utils.ts');
    const { parseIndiaIsoDateTime: adminParseIso } = require(adminDateUtilsPath);

    test('2026-02-31 rejected', () => {
      expect(() => adminParseIso('2026-02-31', '10:00')).toThrow(/Invalid calendar date: "2026-02-31"/);
    });

    test('2025-02-29 rejected (non-leap year)', () => {
      expect(() => adminParseIso('2025-02-29', '10:00')).toThrow(/Month 2 in year 2025 has only 28 days/);
    });

    test('2024-02-29 accepted (leap year)', () => {
      const result = adminParseIso('2024-02-29', '10:00');
      expect(result).toBe(new Date('2024-02-29T10:00:00+05:30').toISOString());
    });

    test('2026-04-31 rejected (30-day month)', () => {
      expect(() => adminParseIso('2026-04-31', '10:00')).toThrow(/Month 4 in year 2026 has only 30 days/);
    });

    test('2026-10-15 23:59 accepted', () => {
      const result = adminParseIso('2026-10-15', '23:59');
      expect(result).toBe(new Date('2026-10-15T23:59:00+05:30').toISOString());
    });

    test('invalid times such as 25:00 and 10:60 rejected', () => {
      expect(() => adminParseIso('2026-10-15', '25:00')).toThrow(/Invalid hour 25/);
      expect(() => adminParseIso('2026-10-15', '10:60')).toThrow(/Invalid minute 60/);
    });

    test('verify that invalid admin input cannot be transformed into an apparently valid different date before API submission', () => {
      // Native JS Date parsing silently shifts Feb 31 -> March 3.
      // The admin helper must throw and prevent any shifted ISO string from being submitted to the backend.
      expect(() => adminParseIso('2026-02-31', '12:00')).toThrow();
      expect(() => adminParseIso('2026-04-31', '12:00')).toThrow();
      expect(() => adminParseIso('2026-06-31', '12:00')).toThrow();
      expect(() => adminParseIso('2026-09-31', '12:00')).toThrow();
      expect(() => adminParseIso('2026-11-31', '12:00')).toThrow();
    });
  });
});

