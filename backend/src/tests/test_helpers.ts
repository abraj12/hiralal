import { PrismaClient, User } from '@prisma/client';

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
