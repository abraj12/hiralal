import bcrypt from 'bcryptjs';
import { AccountDeletionService } from '../services/account-deletion.service';
import { prisma } from '../db';
import { hmacHashOtp } from '../utils/crypto.utils';

describe('Finding 06 Regression Suite: Deletion Worker Respects Suspension During Grace Period', () => {
  const testMobile = '9800000201';
  const testPassword = 'Password@123';
  const testOtp = '123456';
  const testOtpHmac = hmacHashOtp(testOtp);

  let userId: string;

  beforeAll(async () => {
    const existingUsers = await prisma.user.findMany({
      where: { mobile: testMobile },
      select: { id: true },
    });
    const ids = existingUsers.map((u) => u.id);

    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityType: 'User', entityId: { in: ids } },
      });
      await prisma.accountDeletionOperation.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.wallet.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: ids } },
      });
    }

    await prisma.verificationToken.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.otpRequest.deleteMany({
      where: { mobile: testMobile },
    });

    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        passwordHash,
        fullName: 'Suspension Test User',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        role: 'USER',
      },
    });
    userId = user.id;

    await prisma.wallet.create({
      data: {
        userId,
        availableBalance: 0.0,
        deficitLiability: 0.0,
      },
    });
  });

  afterAll(async () => {
    const existingUsers = await prisma.user.findMany({
      where: { mobile: testMobile },
      select: { id: true },
    });
    const ids = existingUsers.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityType: 'User', entityId: { in: ids } },
      });
      await prisma.accountDeletionOperation.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.wallet.deleteMany({
        where: { userId: { in: ids } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: ids } },
      });
    }
    await prisma.verificationToken.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.otpRequest.deleteMany({
      where: { mobile: testMobile },
    });
    await prisma.$disconnect();
  });

  it('aborts anonymization and cancels deletion operation if user is suspended during grace period', async () => {
    // 1. Request deletion
    const reqRes = await AccountDeletionService.requestDeletion(userId, testPassword);
    expect(reqRes.success).toBe(true);

    // Seed OTP request record
    await prisma.otpRequest.create({
      data: {
        mobile: testMobile,
        otpHash: testOtpHmac,
        purpose: 'ACCOUNT_DELETION',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // 2. Confirm deletion
    const confirmRes = await AccountDeletionService.confirmDeletion(userId, testOtp);
    expect(confirmRes.success).toBe(true);

    // 3. User enters grace period. Now simulate an administrator suspending the account
    // and warp database clock past the grace period
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'SUSPENDED',
        deletionScheduledAt: new Date(Date.now() - 1000), // Due for deletion
      },
    });

    // 4. Run periodic deletion worker
    const workerResult = await AccountDeletionService.processScheduledDeletions();
    expect(workerResult.errors).toHaveLength(0);

    // 5. Verify user was NOT anonymized
    const lockedUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(lockedUser?.status).toBe('SUSPENDED');
    expect(lockedUser?.mobile).toBe(testMobile);
    expect(lockedUser?.mobile.startsWith('DEL_')).toBe(false);

    // 6. Verify AccountDeletionOperation was marked CANCELLED
    const ops = await prisma.accountDeletionOperation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].status).toBe('CANCELLED');
  });
});
