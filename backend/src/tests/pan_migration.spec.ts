import { prisma } from '../db';
import { migrateLegacyPanRecords } from '../scripts/migrate-legacy-pan';
import { encryptSensitive, decryptSensitive, generateBlindIndex } from '../utils/crypto.utils';

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

  it('detects and isolates colliding legacy PAN even if existing record has non-VERIFIED status', async () => {
    const rawPan = 'DEFGH5678J';
    const blindIndex = generateBlindIndex(rawPan);

    // Existing record in REJECTED state with blind index
    const existing = await prisma.kycRecord.create({
      data: {
        userId: user1.id,
        panBlindIndex: blindIndex,
        panStatus: 'REJECTED',
        panName: 'Existing Rejected',
        maskedPan: 'DEFGH••••J',
      },
    });

    // Incoming legacy unmigrated record with same PAN
    const duplicate = await prisma.kycRecord.create({
      data: {
        userId: userDuplicate.id,
        panNumber: rawPan,
        panStatus: 'PENDING',
        panName: 'Duplicate User',
        maskedPan: 'DEFGH••••J',
      },
    });

    const summary = await migrateLegacyPanRecords(prisma);
    expect(summary.totalFound).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0].reason).toContain('Duplicate PAN blind index detected');

    // Clean up
    await prisma.kycRecord.delete({ where: { id: duplicate.id } });
    await prisma.kycRecord.delete({ where: { id: existing.id } });
  });

  describe('Versioned Crypto Envelope & Legacy Backward Compatibility', () => {
    it('encrypts with v1 envelope prefix and decrypts successfully', () => {
      const plaintext = 'ABCDE1234F';
      const ciphertext = encryptSensitive(plaintext);
      expect(ciphertext.startsWith('v1:')).toBe(true);
      expect(ciphertext.split(':').length).toBe(4);
      expect(decryptSensitive(ciphertext)).toBe(plaintext);
    });

    it('decrypts legacy unversioned 3-part ciphertext (iv:tag:ct)', () => {
      const plaintext = 'XYZAB5678C';
      const v1Cipher = encryptSensitive(plaintext);
      // Strip v1: prefix to simulate unversioned legacy database record
      const legacyCipher = v1Cipher.slice(3);
      expect(legacyCipher.split(':').length).toBe(3);
      expect(decryptSensitive(legacyCipher)).toBe(plaintext);
    });

    it('handles empty inputs and malformed ciphertext safely', () => {
      expect(encryptSensitive('')).toBe('');
      expect(decryptSensitive('')).toBe('');
      expect(() => decryptSensitive('malformed')).toThrow('Invalid encrypted data format.');
      expect(() => decryptSensitive('v1:only_two:parts')).toThrow('Invalid versioned encrypted data format.');
    });

    it('rejects malformed IV and authentication tag lengths (CRYPTO-AUDIT-01)', () => {
      const plaintext = 'ABCDE1234F';
      const ciphertext = encryptSensitive(plaintext);
      const [, ivHex, tagHex, ct] = ciphertext.split(':');

      // Test truncated IV (less than 12 bytes / 24 hex chars)
      const truncatedIv = ivHex.slice(0, 16); // 8 bytes
      expect(() => decryptSensitive(`v1:${truncatedIv}:${tagHex}:${ct}`)).toThrow(
        /Invalid initialization vector length: expected 12 bytes, received 8/
      );

      // Test expanded IV (more than 12 bytes)
      const longIv = ivHex + 'abcd'; // 14 bytes
      expect(() => decryptSensitive(`v1:${longIv}:${tagHex}:${ct}`)).toThrow(
        /Invalid initialization vector length: expected 12 bytes, received 14/
      );

      // Test truncated Tag (less than 16 bytes / 32 hex chars)
      const truncatedTag = tagHex.slice(0, 20); // 10 bytes
      expect(() => decryptSensitive(`v1:${ivHex}:${truncatedTag}:${ct}`)).toThrow(
        /Invalid authentication tag length: expected 16 bytes, received 10/
      );

      // Test expanded Tag (more than 16 bytes)
      const longTag = tagHex + '1234'; // 18 bytes
      expect(() => decryptSensitive(`v1:${ivHex}:${longTag}:${ct}`)).toThrow(
        /Invalid authentication tag length: expected 16 bytes, received 18/
      );

      // Test unversioned legacy with malformed IV and tag lengths
      expect(() => decryptSensitive(`${truncatedIv}:${tagHex}:${ct}`)).toThrow(
        /Invalid initialization vector length: expected 12 bytes, received 8/
      );
      expect(() => decryptSensitive(`${ivHex}:${truncatedTag}:${ct}`)).toThrow(
        /Invalid authentication tag length: expected 16 bytes, received 10/
      );
    });
  });
});

