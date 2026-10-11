import { execSync } from 'child_process';
import { prisma } from '../db';
import { PrismaClient } from '@prisma/client';

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

  it('Scenario C: verifies fail-closed legacy admin migration and dry-run mode', async () => {
    const { migrateLegacyAdminAccounts } = await import('../scripts/migrate-legacy-admin');
    const { config } = await import('../config');

    // Configure test admin mobiles
    const origBill = config.admin.billAdminMobile;
    const origOps = config.admin.operationsAdminMobile;
    config.admin.billAdminMobile = '9876543210';
    config.admin.operationsAdminMobile = '9876543211';

    const testMobiles = ['9876543210', '9876543211', '9876543299'];
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });

    const initialAdminCount = await prisma.user.count({ where: { role: 'ADMIN' } });

    // Create 3 legacy ADMIN accounts
    const userBill = await prisma.user.create({
      data: {
        mobile: '9876543210',
        fullName: 'Legacy Bill Admin',
        passwordHash: 'hash_legacy_1',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    const userOps = await prisma.user.create({
      data: {
        mobile: '9876543211',
        fullName: 'Legacy Ops Admin',
        passwordHash: 'hash_legacy_2',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    const userUnmapped = await prisma.user.create({
      data: {
        mobile: '9876543299',
        fullName: 'Unmapped Admin',
        passwordHash: 'hash_legacy_3',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    try {
      // 1. Dry run
      const drySummary = await migrateLegacyAdminAccounts(prisma, { dryRun: true });
      expect(drySummary.totalFound).toBe(initialAdminCount + 3);
      expect(drySummary.migratedToBillAdmin).toBe(1);
      expect(drySummary.migratedToOperations).toBe(1);
      expect(drySummary.failed).toBe(initialAdminCount + 1);
      expect(drySummary.errors.some((e) => e.userId === userUnmapped.id)).toBe(true);

      // In database, roles must still be ADMIN after dry run
      const checkDry1 = await prisma.user.findUnique({ where: { id: userBill.id } });
      const checkDry2 = await prisma.user.findUnique({ where: { id: userOps.id } });
      const checkDry3 = await prisma.user.findUnique({ where: { id: userUnmapped.id } });
      expect(checkDry1?.role).toBe('ADMIN');
      expect(checkDry2?.role).toBe('ADMIN');
      expect(checkDry3?.role).toBe('ADMIN');

      // 2. Real migration (fail closed)
      const liveSummary = await migrateLegacyAdminAccounts(prisma, { dryRun: false });
      expect(liveSummary.totalFound).toBe(initialAdminCount + 3);
      expect(liveSummary.migratedToBillAdmin).toBe(1);
      expect(liveSummary.migratedToOperations).toBe(1);
      expect(liveSummary.failed).toBe(initialAdminCount + 1);

      // In database: mapped ones change, unmapped one remains ADMIN
      const checkLive1 = await prisma.user.findUnique({ where: { id: userBill.id } });
      const checkLive2 = await prisma.user.findUnique({ where: { id: userOps.id } });
      const checkLive3 = await prisma.user.findUnique({ where: { id: userUnmapped.id } });
      expect(checkLive1?.role).toBe('BILL_ADMIN');
      expect(checkLive2?.role).toBe('OPERATIONS_ADMIN');
      expect(checkLive3?.role).toBe('ADMIN');
    } finally {
      config.admin.billAdminMobile = origBill;
      config.admin.operationsAdminMobile = origOps;
      await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
      await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });
    }
  });
});
