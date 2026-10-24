import { GstService } from '../services/gst.service';
import { prisma } from '../db';
import { getOrCreateOpsAdmin } from './test_helpers';

describe('Finding 14 Regression Suite: GST Rule Effective Date IST Timezone Parsing', () => {
  let opsAdminId: string;
  const createdRuleIds: string[] = [];

  beforeAll(async () => {
    const opsAdmin = await getOrCreateOpsAdmin(prisma);
    opsAdminId = opsAdmin.id;
  });

  afterAll(async () => {
    if (createdRuleIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityType: 'GstRule', entityId: { in: createdRuleIds } },
      });
      await prisma.gstRule.deleteMany({
        where: { id: { in: createdRuleIds } },
      });
    }
    await prisma.$disconnect();
  });

  it('normalizes date-only effectiveFrom string to Asia/Kolkata midnight (+05:30)', async () => {
    const rule = await GstService.createGstRule(opsAdminId, {
      ratePercentage: 18.0,
      description: 'IST Midnight Test Rate',
      isDefault: false,
      effectiveFrom: '2026-11-01',
    });
    createdRuleIds.push(rule.id);

    // 2026-11-01 00:00:00 in Asia/Kolkata (+05:30) is 2026-10-31 18:30:00.000Z
    expect(rule.effectiveFrom.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('preserves exact hours and minutes for IST timestamp string', async () => {
    const rule = await GstService.createGstRule(opsAdminId, {
      ratePercentage: 12.0,
      description: 'IST 10:30 AM Test Rate',
      isDefault: false,
      effectiveFrom: '2026-11-01T10:30:00+05:30',
    });
    createdRuleIds.push(rule.id);

    // 2026-11-01 10:30:00 in Asia/Kolkata (+05:30) is 2026-11-01 05:00:00.000Z
    expect(rule.effectiveFrom.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('rejects invalid or impossible calendar date in effectiveFrom', async () => {
    await expect(
      GstService.createGstRule(opsAdminId, {
        ratePercentage: 5.0,
        description: 'Invalid Date Test',
        effectiveFrom: '2026-02-31',
      })
    ).rejects.toThrow(/invalid/i);
  });

  it('rejects when effectiveUntil is earlier than or equal to effectiveFrom', async () => {
    await expect(
      GstService.createGstRule(opsAdminId, {
        ratePercentage: 5.0,
        description: 'Inverted Bounds Test',
        effectiveFrom: '2026-11-01',
        effectiveUntil: '2026-10-15',
      })
    ).rejects.toThrow(/effectiveUntil must be strictly after effectiveFrom/i);
  });
});
