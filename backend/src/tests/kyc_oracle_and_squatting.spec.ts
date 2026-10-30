import { prisma } from '../db';
import { KycService } from '../services/kyc';
import { MockKycProvider } from '../services/kyc/mock.provider';
import { KycProvider } from '../services/kyc/kyc.interface';

const HOLDER_NAME = 'RAMESH KUMAR VERMA';
const VICTIM_PAN = 'QWERT1234Y';

// Provider stub: every PAN belongs to HOLDER_NAME, as the real tax database would report.
const holderProvider: KycProvider = {
  name: 'TEST_HOLDER_PROVIDER',
  async verifyPan(params) {
    return {
      isValid: true,
      panNumber: params.panNumber.trim().toUpperCase(),
      panName: HOLDER_NAME,
      providerRequestId: `test-${Date.now()}`,
      providerStatus: 'VALID',
    };
  },
};

describe('HIR-M-01 — KYC name disclosure and PAN squatting', () => {
  const mobiles = ['9876500011', '9876500012', '9876500013'];
  let attackerId: string;
  let monoAttackerId: string;
  let victimId: string;

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { mobile: { in: mobiles } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await prisma.kycRecord.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  };

  const createUser = (mobile: string, fullName: string) =>
    prisma.user.create({
      data: { mobile, fullName, passwordHash: 'x', role: 'USER', profession: 'PLUMBER', status: 'ACTIVE', isVerified: true },
    });

  beforeAll(async () => {
    await cleanup();
    attackerId = (await createUser(mobiles[0], 'Mallory Attacker')).id;
    monoAttackerId = (await createUser(mobiles[1], 'Mallory')).id;
    victimId = (await createUser(mobiles[2], HOLDER_NAME)).id;
    KycService.setProvider(holderProvider);
  });

  afterAll(async () => {
    KycService.setProvider(new MockKycProvider());
    await cleanup();
  });

  it('does not reveal the provider-verified holder name on a name mismatch', async () => {
    let message = '';
    try {
      await KycService.submitPan({ userId: attackerId, panNumber: VICTIM_PAN, panName: 'Anything', consent: true });
    } catch (err: any) {
      message = err.message;
    }
    expect(message).toMatch(/Name mismatch/);
    expect(message).not.toContain(HOLDER_NAME);
    expect(message.toUpperCase()).not.toContain('RAMESH');
  });

  it('a mononymous review record does not claim the PAN blind index', async () => {
    await expect(
      KycService.submitPan({ userId: monoAttackerId, panNumber: VICTIM_PAN, panName: 'Mallory', consent: true })
    ).rejects.toThrow(/mononymous/);

    const pending = await prisma.kycRecord.findFirst({ where: { userId: monoAttackerId, panStatus: 'PENDING' } });
    expect(pending).toBeTruthy();
    expect(pending?.panBlindIndex).toBeNull();
  });

  it('the genuine PAN holder can still verify after another account attempted the same PAN', async () => {
    const kyc = await KycService.submitPan({ userId: victimId, panNumber: VICTIM_PAN, panName: HOLDER_NAME, consent: true });
    expect(kyc.panStatus).toBe('VERIFIED');
    expect(kyc.panBlindIndex).toBeTruthy();
  });

  it('a VERIFIED record still blocks other accounts from using the same PAN', async () => {
    await expect(
      KycService.submitPan({ userId: attackerId, panNumber: VICTIM_PAN, panName: HOLDER_NAME, consent: true })
    ).rejects.toThrow(/already verified with another user account/);
  });
});
