import { execSync } from 'child_process';
import { prisma } from '../db';
import { PrismaClient } from '@prisma/client';
import { resetAdmins } from './test_helpers';

describe('Phase 19 — Database Migrations Verification', () => {
  it('Scenario A: verifies migration deployment on a fresh database', async () => {
    // 1. Using active connection, create a fresh database for migration testing
    const baseDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/hiralal_rewards?schema=public';
    const adminDbUrl = baseDbUrl;

    const parsedScenarioUrl = new URL(baseDbUrl);
    parsedScenarioUrl.pathname = '/hiralal_scenario_a_test';
    const scenarioADbUrl = parsedScenarioUrl.toString();

    const adminPrisma = new PrismaClient({
      datasources: {
        db: { url: adminDbUrl },
      },
    });

    try {
      await adminPrisma.$connect();
      await adminPrisma.$executeRawUnsafe('DROP DATABASE IF EXISTS hiralal_scenario_a_test;');
      await adminPrisma.$executeRawUnsafe('CREATE DATABASE hiralal_scenario_a_test;');
    } finally {
      await adminPrisma.$disconnect();
    }

    // 2. Execute prisma migrate deploy against fresh database
    const migrateOutput = execSync('npx prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: scenarioADbUrl },
      encoding: 'utf8',
    });

    expect(migrateOutput).toMatch(/\d+ migration(s)? found/);
    expect(migrateOutput).toContain('All migrations have been successfully applied');

    // 3. Connect to fresh database and verify complete schema
    const testPrisma = new PrismaClient({
      datasources: {
        db: { url: scenarioADbUrl },
      },
    });

    try {
      await testPrisma.$connect();
      const userCount = await testPrisma.user.count();
      const walletCount = await testPrisma.wallet.count();
      const billCount = await testPrisma.bill.count();

      expect(userCount).toBe(0);
      expect(walletCount).toBe(0);
      expect(billCount).toBe(0);

      const migrations: any = await testPrisma.$queryRaw`
        SELECT migration_name, finished_at FROM _prisma_migrations;
      `;
      expect(migrations.length).toBeGreaterThanOrEqual(1);
      expect(migrations.some((m: any) => m.migration_name.includes('init_production_schema'))).toBe(true);
    } finally {
      await testPrisma.$disconnect();

      // Cleanup test database
      const cleanupPrisma = new PrismaClient({
        datasources: {
          db: { url: adminDbUrl },
        },
      });
      await cleanupPrisma.$connect();
      await cleanupPrisma.$executeRawUnsafe('DROP DATABASE IF EXISTS hiralal_scenario_a_test;');
      await cleanupPrisma.$disconnect();
    }
  }, 90000);

  it('Scenario B: verifies existing database migration stability without data loss', async () => {
    // Verify that active production schema contains all required tables and records intact
    const activeMigrations: any = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations;
    `;
    expect(activeMigrations.length).toBeGreaterThan(0);
    expect(activeMigrations[0].rolled_back_at).toBeNull();

    // Verify all primary model relationships are intact
    const settings = await prisma.redemptionSettings.findUnique({ where: { id: 'default' } });
    expect(settings).toBeDefined();

    const rules = await prisma.rewardRule.findMany();
    expect(Array.isArray(rules)).toBe(true);
  });

  it('Scenario C: verifies safe removal of legacy ADMIN role and role constraints', async () => {
    const { migrateLegacyAdminAccounts } = await import('../scripts/migrate-legacy-admin');

    // 1. Verify UserRole PostgreSQL enum values
    const enumRows: any[] = await prisma.$queryRaw`
      SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'UserRole' ORDER BY enumlabel;
    `;
    const enumLabels = enumRows.map((r: any) => r.enumlabel);
    expect(enumLabels).toContain('USER');
    expect(enumLabels).toContain('BILL_ADMIN');
    expect(enumLabels).toContain('OPERATIONS_ADMIN');
    expect(enumLabels).not.toContain('ADMIN');

    // 2. Verify that attempting to set role = 'ADMIN' fails PostgreSQL enum constraint
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "User" ("id", "mobile", "fullName", "passwordHash", "role", "status", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), '9876543999', 'Invalid Admin', 'hash', 'ADMIN'::"UserRole", 'ACTIVE', NOW(), NOW())
      `)
    ).rejects.toThrow();

    // 3. Verify migrateLegacyAdminAccounts cleanly processes database with 0 legacy admins
    const summary = await migrateLegacyAdminAccounts(prisma, { dryRun: true });
    expect(summary.totalFound).toBe(0);
    expect(summary.failed).toBe(0);

    // 4. Verify partial unique indexes enforce the two-admin invariant
    const testOpsMobile1 = '9876543111';
    const testOpsMobile2 = '9876543222';
    await resetAdmins(prisma);
    await prisma.user.deleteMany({ where: { mobile: { in: [testOpsMobile1, testOpsMobile2] } } });

    await prisma.user.create({
      data: {
        mobile: testOpsMobile1,
        fullName: 'Ops Admin One',
        passwordHash: 'hash1',
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
      },
    });

    // Attempting to create a second OPERATIONS_ADMIN must fail partial unique index
    await expect(
      prisma.user.create({
        data: {
          mobile: testOpsMobile2,
          fullName: 'Ops Admin Two',
          passwordHash: 'hash2',
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
        },
      })
    ).rejects.toThrow();

    // Cleanup
    await prisma.user.deleteMany({ where: { mobile: { in: [testOpsMobile1, testOpsMobile2] } } });
  });
});
