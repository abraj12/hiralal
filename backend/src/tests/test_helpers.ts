import { PrismaClient } from '@prisma/client';

export async function resetAdmins(prisma: PrismaClient) {
  try {
    await prisma.authSession.deleteMany({
      where: { user: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'] } } },
    });
    await prisma.auditLog.deleteMany({
      where: { admin: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'] } } },
    });
    await prisma.notificationCampaign.deleteMany({
      where: { createdByAdmin: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'] } } },
    });
    await prisma.user.deleteMany({
      where: { role: { in: ['BILL_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'] } },
    });
  } catch (err: any) {
    console.warn('[RESET-ADMINS-WARN]', err.message);
  }
}
