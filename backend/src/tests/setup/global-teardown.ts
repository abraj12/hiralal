/**
 * Jest Global Teardown — F-01
 *
 * Runs once after ALL test suites complete. Cleans up any admin users seeded
 * during the test run to prevent test data from persisting across runs and
 * polluting production-mirror databases.
 *
 * Safe to run even when the database is unavailable (errors are swallowed so
 * they do not mask test failures).
 */

import dotenv from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';
import { assertSafeTestDatabase } from './test-db-guard';

const TEST_ADMIN_MOBILE_PATTERNS = [
  '9999900001', // bill-admin seed
  '9999900002', // operations-admin seed
  '9999900003', // extra admin seed
];

module.exports = async function globalTeardown() {
  // HIR-M-11: Never run destructive cleanup against a non-test database
  dotenv.config();
  assertSafeTestDatabase();
  const prisma = new PrismaClient();
  try {
    const adminUsers = await prisma.user.findMany({
      where: {
        role: { in: [UserRole.BILL_ADMIN, UserRole.OPERATIONS_ADMIN] },
        mobile: { in: TEST_ADMIN_MOBILE_PATTERNS },
      },
      select: { id: true },
    });

    const adminUserIds = adminUsers.map((u) => u.id);
    if (adminUserIds.length > 0) {
      // AUDIT-RED-03: Delete child records to satisfy RESTRICT foreign keys
      await prisma.authSession.deleteMany({ where: { userId: { in: adminUserIds } } });
      await prisma.auditLog.deleteMany({ where: { adminId: { in: adminUserIds } } });
      await prisma.notificationCampaign.deleteMany({ where: { createdByAdminId: { in: adminUserIds } } });
      await prisma.bill.deleteMany({ where: { userId: { in: adminUserIds } } });

      const deleted = await prisma.user.deleteMany({
        where: { id: { in: adminUserIds } },
      });
      if (deleted.count > 0) {
        console.log(`[GlobalTeardown] Cleaned up ${deleted.count} seeded test admin user(s).`);
      }
    }
  } catch (err: any) {
    // Non-fatal — test results should not be masked by teardown errors
    console.warn('[GlobalTeardown] Warning: could not clean test admin users:', err?.message || err);
  } finally {
    await prisma.$disconnect();
  }
};
