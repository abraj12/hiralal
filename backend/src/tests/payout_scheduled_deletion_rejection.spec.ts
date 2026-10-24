import bcrypt from 'bcryptjs';
import { PayoutService } from '../services/payout.service';
import { prisma } from '../db';

describe('Finding 09 Regression Suite: Payout During Account Deletion Grace Period', () => {
  const testMobile = '9800000301';
  let userId: string;

  beforeAll(async () => {
    const existing = await prisma.user.findMany({ where: { mobile: testMobile }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'User', entityId: { in: ids } } });
      await prisma.payout.deleteMany({ where: { userId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }

    const passwordHash = await bcrypt.hash('TestPassword@123', 10);
    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        passwordHash,
        fullName: 'Payout Deletion Test User',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        role: 'USER',
      },
    });
    userId = user.id;

    await prisma.wallet.create({
      data: {
        userId,
        availableBalance: 500.0,
      },
    });
  });

  afterAll(async () => {
    const existing = await prisma.user.findMany({ where: { mobile: testMobile }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'User', entityId: { in: ids } } });
      await prisma.payout.deleteMany({ where: { userId: { in: ids } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it('blocks payout eligibility check if user has requested or scheduled account deletion', async () => {
    // 1. Mark account as scheduled for deletion
    await prisma.user.update({
      where: { id: userId },
      data: { deletionScheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    await expect(PayoutService.checkUserEligibility(userId)).rejects.toThrow(
      /Cannot request rewards payout while account deletion is requested or scheduled/i
    );

    // 2. Mark account as requested deletion (pre-confirmation)
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletionScheduledAt: null,
        deletionRequestedAt: new Date(),
      },
    });

    await expect(PayoutService.checkUserEligibility(userId)).rejects.toThrow(
      /Cannot request rewards payout while account deletion is requested or scheduled/i
    );

    // 3. Verify requestRedemption also rejects
    await expect(
      PayoutService.requestRedemption(userId, 'test-idem-key-123')
    ).rejects.toThrow(/Cannot request rewards payout while account deletion is requested or scheduled/i);
  });
});
