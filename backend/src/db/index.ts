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

    const billAdminCount = await client.user.count({
      where: { role: 'BILL_ADMIN' },
    });
    if (billAdminCount > 1) {
      throw new Error(
        `[FATAL] Multiple BILL_ADMIN identities detected (${billAdminCount}). Exactly one provisioned BILL_ADMIN is permitted.`
      );
    }

    const opsAdminCount = await client.user.count({
      where: { role: 'OPERATIONS_ADMIN' },
    });
    if (opsAdminCount > 1) {
      throw new Error(
        `[FATAL] Multiple OPERATIONS_ADMIN identities detected (${opsAdminCount}). Exactly one provisioned OPERATIONS_ADMIN is permitted.`
      );
    }

    return true;
  } catch (err: any) {
    console.error('❌ Admin role integrity check failed:', err.message);
    throw err;
  }
}

