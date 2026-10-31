import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

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
  const envTestPath = path.resolve(process.cwd(), '.env.test');
  if (fs.existsSync(envTestPath)) {
    dotenv.config({ path: envTestPath, override: true });
  } else {
    dotenv.config();
  }
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('_test')) {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/(\/hiralal_rewards)(\?|$)/, '$1_test$2');
  }
  assertSafeTestDatabase();

  const dbName = getTestDatabaseName(process.env.DATABASE_URL);
  if (dbName && dbName.endsWith('_test')) {
    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      await client.query(`ALTER DATABASE "${dbName}" SET app.allow_audit_log_cleanup = 'on'`);
      await client.end();
    } catch {
      // Non-fatal if pg driver or permissions unavailable
    }
  }
};
module.exports.assertSafeTestDatabase = assertSafeTestDatabase;
module.exports.getTestDatabaseName = getTestDatabaseName;
