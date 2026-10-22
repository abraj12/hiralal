import { PrismaClient, User } from '@prisma/client';
import bcrypt from 'bcryptjs';

export async function resetAdmins(prisma: PrismaClient) {
  try {
    await prisma.authSession.deleteMany({
      where: { user: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] } } },
    });
    await prisma.auditLog.deleteMany({
      where: { admin: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] } } },
    });
    await prisma.notificationCampaign.deleteMany({
      where: { createdByAdmin: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] } } },
    });
    await prisma.user.deleteMany({
      where: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] } },
    });
  } catch (err: any) {
    console.warn('[RESET-ADMINS-WARN]', err.message);
  }
}

export async function getOrCreateOpsAdmin(prisma: PrismaClient, mobile = '9999999999'): Promise<User> {
  const existing = await prisma.user.findFirst({
    where: { role: 'OPERATIONS_ADMIN' },
  });
  if (existing) {
    return existing;
  }
  return await prisma.user.create({
    data: {
      mobile,
      fullName: 'Operations Admin',
      passwordHash: 'adminhash',
      role: 'OPERATIONS_ADMIN',
      status: 'ACTIVE',
      isVerified: true,
    },
  });
}

export async function getOrCreateBillAdmin(prisma: PrismaClient, mobile = '9999999998'): Promise<User> {
  const existing = await prisma.user.findFirst({
    where: { role: 'BILL_ADMIN' },
  });
  if (existing) {
    return existing;
  }
  return await prisma.user.create({
    data: {
      mobile,
      fullName: 'Bill Admin',
      passwordHash: 'adminhash',
      role: 'BILL_ADMIN',
      status: 'ACTIVE',
      isVerified: true,
    },
  });
}

export const DEFAULT_BILL_ADMIN_MOBILE = '9999900001';
export const DEFAULT_OPS_ADMIN_MOBILE = '9999900002';
export const DEFAULT_ADMIN_PASSWORD = 'AdminPassword@2026';

/**
 * TEST-HARNESS-01: Ensures baseline seeded admin users exist in the database.
 * If previous test suites called resetAdmins or deleted admins in afterAll,
 * this function restores the baseline seeded admins so subsequent suites execute in isolation.
 */
export async function ensureBaselineAdmins(prisma: PrismaClient): Promise<{
  billAdmin: User;
  opsAdmin: User;
}> {
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

  let billAdmin = await prisma.user.findFirst({
    where: { role: 'BILL_ADMIN' },
  });
  if (!billAdmin) {
    await prisma.user.deleteMany({ where: { mobile: DEFAULT_BILL_ADMIN_MOBILE } });
    billAdmin = await prisma.user.create({
      data: {
        mobile: DEFAULT_BILL_ADMIN_MOBILE,
        fullName: 'Baseline Bill Admin',
        passwordHash,
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
  } else if (billAdmin.status !== 'ACTIVE' || (billAdmin.failedPasswordAttempts ?? 0) > 0 || billAdmin.lockedUntil) {
    billAdmin = await prisma.user.update({
      where: { id: billAdmin.id },
      data: {
        status: 'ACTIVE',
        failedPasswordAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  let opsAdmin = await prisma.user.findFirst({
    where: { role: 'OPERATIONS_ADMIN' },
  });
  if (!opsAdmin) {
    await prisma.user.deleteMany({ where: { mobile: DEFAULT_OPS_ADMIN_MOBILE } });
    opsAdmin = await prisma.user.create({
      data: {
        mobile: DEFAULT_OPS_ADMIN_MOBILE,
        fullName: 'Baseline Operations Admin',
        passwordHash,
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
  } else if (opsAdmin.status !== 'ACTIVE' || (opsAdmin.failedPasswordAttempts ?? 0) > 0 || opsAdmin.lockedUntil) {
    opsAdmin = await prisma.user.update({
      where: { id: opsAdmin.id },
      data: {
        status: 'ACTIVE',
        failedPasswordAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  return { billAdmin, opsAdmin };
}
