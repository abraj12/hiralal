import { assertSafeTestDatabase, getTestDatabaseName } from './setup/test-db-guard';

describe('HIR-M-11 — Test database guard', () => {
  it('extracts the database name from a PostgreSQL URL', () => {
    expect(getTestDatabaseName('postgresql://u:p@localhost:5432/hiralal_rewards_test?schema=public')).toBe(
      'hiralal_rewards_test'
    );
    expect(getTestDatabaseName('not a url')).toBeNull();
    expect(getTestDatabaseName(undefined)).toBeNull();
  });

  it('accepts a *_test database when NODE_ENV is test', () => {
    expect(() =>
      assertSafeTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/hiralal_rewards_test?schema=public',
      })
    ).not.toThrow();
  });

  it('rejects the production database name', () => {
    expect(() =>
      assertSafeTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://u:p@postgres:5432/hiralal_rewards?schema=public',
      })
    ).toThrow(/_test/);
  });

  it('rejects any NODE_ENV other than test', () => {
    expect(() =>
      assertSafeTestDatabase({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/hiralal_rewards_test',
      })
    ).toThrow(/NODE_ENV/);
  });
});
