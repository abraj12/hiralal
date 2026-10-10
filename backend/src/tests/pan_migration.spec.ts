import { prisma } from '../db';
import { migrateLegacyPanRecords } from '../scripts/migrate-legacy-pan';
import { decryptSensitive, generateBlindIndex } from '../utils/crypto.utils';

describe('Phase 6 — PAN Data Migration & Blind Index Backfill', () => {
  let user1: any;
  let user2: any;
  let userDuplicate: any;

  beforeAll(async () => {
    // Clean up test records
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { in: ['9666600001', '9666600002', '9666600003'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9666600001', '9666600002', '9666600003'] } },
    });

    user1 = await prisma.user.create({
      data: {
        mobile: '9666600001',
        fullName: 'Legacy User 1',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
      },
    });

    user2 = await prisma.user.create({
      data: {
        mobile: '9666600002',
        fullName: 'Legacy User 2',
        passwordHash: 'hash',
        profession: 'TILE_INSTALLER',
        role: 'USER',
      },
    });

    userDuplicate = await prisma.user.create({
      data: {
        mobile: '9666600003',
        fullName: 'Legacy User Duplicate',
        passwordHash: 'hash',
        profession: 'PLUMBER',
        role: 'USER',
      },
    });
  });

  afterAll(async () => {
    await prisma.kycRecord.deleteMany({
      where: { user: { mobile: { in: ['9666600001', '9666600002', '9666600003'] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9666600001', '9666600002', '9666600003'] } },
    });
  });

  it('migrates legacy plaintext PANs, encrypts at rest, sets blind index, and nulls plaintext', async () => {
    const rawPan1 = 'ABCDE1234F';
    const rawPan2 = 'XYZPQ9876M';

    // Seed legacy records with plaintext panNumber
    const kyc1 = await prisma.kycRecord.create({
      data: {
        userId: user1.id,
        panNumber: rawPan1,
        panName: 'Ramesh Kumar',
        maskedPan: 'ABCDE••••F',
        panStatus: 'VERIFIED',
      },
    });

    const kyc2 = await prisma.kycRecord.create({
      data: {
        userId: user2.id,
        panNumber: rawPan2,
        panName: 'Suresh Verma',
        maskedPan: 'XYZPQ••••M',
        panStatus: 'VERIFIED',
      },
    });

    const summary = await migrateLegacyPanRecords(prisma);

    expect(summary.totalFound).toBeGreaterThanOrEqual(2);
    expect(summary.migrated).toBeGreaterThanOrEqual(2);
    expect(summary.failed).toBe(0);

    // Verify record 1
    const updated1 = await prisma.kycRecord.findUnique({ where: { id: kyc1.id } });
    expect(updated1?.panNumber).toBeNull(); // Plaintext safely cleared
    expect(updated1?.panNumberEncrypted).toBeTruthy();
    expect(updated1?.panBlindIndex).toBe(generateBlindIndex(rawPan1));
    expect(decryptSensitive(updated1!.panNumberEncrypted!)).toBe(rawPan1);

    // Verify record 2
    const updated2 = await prisma.kycRecord.findUnique({ where: { id: kyc2.id } });
    expect(updated2?.panNumber).toBeNull(); // Plaintext safely cleared
    expect(updated2?.panNumberEncrypted).toBeTruthy();
    expect(updated2?.panBlindIndex).toBe(generateBlindIndex(rawPan2));
    expect(decryptSensitive(updated2!.panNumberEncrypted!)).toBe(rawPan2);
  });

  it('is idempotent: running a second time finds 0 legacy plaintext records and changes nothing', async () => {
    const summary = await migrateLegacyPanRecords(prisma);
    expect(summary.totalFound).toBe(0);
    expect(summary.migrated).toBe(0);
  });

  it('detects and isolates malformed legacy PAN without corrupting records', async () => {
    const malformedKyc = await prisma.kycRecord.create({
      data: {
        userId: userDuplicate.id,
        panNumber: 'INVALID_PAN_123',
        panName: 'Corrupt User',
        maskedPan: 'INV••••23',
        panStatus: 'PENDING',
      },
    });

    const summary = await migrateLegacyPanRecords(prisma);
    expect(summary.totalFound).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0].reason).toContain('Malformed legacy PAN format');

    // Plaintext preserved for manual administrative audit
    const check = await prisma.kycRecord.findUnique({ where: { id: malformedKyc.id } });
    expect(check?.panNumber).toBe('INVALID_PAN_123');

    // Clean up
    await prisma.kycRecord.delete({ where: { id: malformedKyc.id } });
  });
});
