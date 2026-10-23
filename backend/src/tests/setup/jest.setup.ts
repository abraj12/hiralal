import { resetAllRateLimiters } from '../../middleware/rateLimit.middleware';
import { ensureBaselineAdmins } from '../test_helpers';
import { prisma } from '../../db';

/**
 * TEST-HARNESS-01: Jest global test harness setup and teardown
 * 
 * 1. Resets in-memory Express IP rate limiter cache and Redis rate limit keys before and
 *    after each test file and individual test case, preventing 127.0.0.1 hit accumulation.
 * 2. Automatically restores baseline seeded admin users (BILL_ADMIN, OPERATIONS_ADMIN)
 *    before test suite execution if an earlier test teardown deleted them.
 */

beforeAll(async () => {
  await resetAllRateLimiters();
  try {
    await ensureBaselineAdmins(prisma);
  } catch {
    // Non-fatal if database is unmocked or offline
  }
});

beforeEach(async () => {
  await resetAllRateLimiters();
});

afterEach(async () => {
  await resetAllRateLimiters();
});

afterAll(async () => {
  await resetAllRateLimiters();
  try {
    await prisma.$disconnect();
  } catch {
    // Non-fatal if already disconnected
  }
});
