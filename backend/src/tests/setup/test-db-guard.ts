import dotenv from 'dotenv';

/**
 * HIR-M-11 / T-1: Refuses to let the test suite touch any database that is not
 * explicitly a test database. The suite seeds, mutates and deletes rows, so it
 * must never run against a development, staging or production database.
 */
export function getTestDatabaseName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const parsed = new URL(databaseUrl);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return name || null;
  } catch {
    return null;
  }
}

export function assertSafeTestDatabase(
  env: Record<string, string | undefined> = process.env
): void {
  if (env.NODE_ENV !== 'test') {
    throw new Error(
      `[TEST-DB-GUARD] Refusing to run tests: NODE_ENV must be "test" (received "${env.NODE_ENV ?? ''}").`
    );
  }

  const dbName = getTestDatabaseName(env.DATABASE_URL);
  if (!dbName || !dbName.endsWith('_test')) {
    throw new Error(
      `[TEST-DB-GUARD] Refusing to run tests: DATABASE_URL must point to a database whose name ends with "_test" (received "${dbName ?? 'unparseable'}").`
    );
  }
}

module.exports = async function globalSetup() {
  dotenv.config();
  assertSafeTestDatabase();
};
module.exports.assertSafeTestDatabase = assertSafeTestDatabase;
module.exports.getTestDatabaseName = getTestDatabaseName;
