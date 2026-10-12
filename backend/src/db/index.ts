import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
  });

if (config.nodeEnv !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Connected to PostgreSQL database successfully.');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to PostgreSQL database:', error);
    return false;
  }
}

/**
 * Enforces Two-Admin system integrity invariants at server startup:
 * 1. Fails fast if any legacy ADMIN records exist in database.
 * 2. Fails fast if more than 1 BILL_ADMIN exists.
 * 3. Fails fast if more than 1 OPERATIONS_ADMIN exists.
 */
export async function checkAdminRoleIntegrity(client: PrismaClient = prisma): Promise<boolean> {
  try {
    const legacyAdminRows: Array<{ count: bigint | number }> = await client.$queryRaw`
      SELECT COUNT(*) as count FROM "User" WHERE "role"::text = 'ADMIN';
    `;
    const legacyAdminCount = Number(legacyAdminRows[0]?.count || 0);
    if (legacyAdminCount > 0) {
      throw new Error(
        `[FATAL] Detected ${legacyAdminCount} unresolved legacy ADMIN account(s). All administrative accounts must be resolved to BILL_ADMIN or OPERATIONS_ADMIN.`
      );
    }

    const billAdmins = await client.user.findMany({
      where: { role: 'BILL_ADMIN' },
      select: { id: true, mobile: true },
    });
    if (billAdmins.length > 1) {
      throw new Error(
        `[FATAL] Multiple BILL_ADMIN identities detected (${billAdmins.length}). Exactly one provisioned BILL_ADMIN is permitted.`
      );
    }

    const opsAdmins = await client.user.findMany({
      where: { role: 'OPERATIONS_ADMIN' },
      select: { id: true, mobile: true },
    });
    if (opsAdmins.length > 1) {
      throw new Error(
        `[FATAL] Multiple OPERATIONS_ADMIN identities detected (${opsAdmins.length}). Exactly one provisioned OPERATIONS_ADMIN is permitted.`
      );
    }

    if (config.isProduction) {
      if (billAdmins.length !== 1) {
        throw new Error(
          `[FATAL] Production startup halted: Exactly one provisioned BILL_ADMIN identity is required, found ${billAdmins.length}.`
        );
      }
      if (opsAdmins.length !== 1) {
        throw new Error(
          `[FATAL] Production startup halted: Exactly one provisioned OPERATIONS_ADMIN identity is required, found ${opsAdmins.length}.`
        );
      }

      if (config.admin.billAdminMobile) {
        const expectedBillMobile = config.admin.billAdminMobile.replace(/\D/g, '').slice(-10);
        if (billAdmins[0].mobile !== expectedBillMobile) {
          throw new Error(
            `[FATAL] Provisioned BILL_ADMIN mobile (${billAdmins[0].mobile}) does not match configured BILL_ADMIN_MOBILE (${expectedBillMobile}).`
          );
        }
      }

      if (config.admin.operationsAdminMobile) {
        const expectedOpsMobile = config.admin.operationsAdminMobile.replace(/\D/g, '').slice(-10);
        if (opsAdmins[0].mobile !== expectedOpsMobile) {
          throw new Error(
            `[FATAL] Provisioned OPERATIONS_ADMIN mobile (${opsAdmins[0].mobile}) does not match configured OPERATIONS_ADMIN_MOBILE (${expectedOpsMobile}).`
          );
        }
      }
    }

    return true;
  } catch (err: any) {
    console.error('❌ Admin role integrity check failed:', err.message);
    throw err;
  }
}

