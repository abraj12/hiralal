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

import { PrismaClient, UserRole } from '@prisma/client';

const TEST_ADMIN_MOBILE_PATTERNS = [
  '9999900001', // bill-admin seed
  '9999900002', // operations-admin seed
  '9999900003', // extra admin seed
];

module.exports = async function globalTeardown() {
  const prisma = new PrismaClient();
  try {
    const deleted = await prisma.user.deleteMany({
      where: {
        role: { in: [UserRole.BILL_ADMIN, UserRole.OPERATIONS_ADMIN] },
        mobile: { in: TEST_ADMIN_MOBILE_PATTERNS },
      },
    });
    if (deleted.count > 0) {
      console.log(`[GlobalTeardown] Cleaned up ${deleted.count} seeded test admin user(s).`);
    }
  } catch (err: any) {
    // Non-fatal — test results should not be masked by teardown errors
    console.warn('[GlobalTeardown] Warning: could not clean test admin users:', err?.message || err);
  } finally {
    await prisma.$disconnect();
  }
};
