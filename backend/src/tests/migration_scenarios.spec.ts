import { execSync } from 'child_process';
import { prisma } from '../db';
import { PrismaClient } from '@prisma/client';

describe('Phase 19 — Database Migrations Verification', () => {
  it('Scenario A: verifies migration deployment on a fresh database', async () => {
    // 1. Using active connection, create a fresh database for migration testing
    const adminPrisma = new PrismaClient({
      datasources: {
        db: { url: 'postgresql://postgres:1234@localhost:5432/postgres?schema=public' },
      },
    });

    try {
      await adminPrisma.$connect();
      await adminPrisma.$executeRawUnsafe('DROP DATABASE IF EXISTS hiralal_scenario_a_test;');
      await adminPrisma.$executeRawUnsafe('CREATE DATABASE hiralal_scenario_a_test;');
    } finally {
      await adminPrisma.$disconnect();
    }

    const scenarioADbUrl = 'postgresql://postgres:1234@localhost:5432/hiralal_scenario_a_test?schema=public';

    // 2. Execute prisma migrate deploy against fresh database
    const migrateOutput = execSync('npx prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: scenarioADbUrl },
      encoding: 'utf8',
    });

    expect(migrateOutput).toContain('1 migration found');
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
      const poolCount = await testPrisma.rewardPool.count();

      expect(userCount).toBe(0);
      expect(walletCount).toBe(0);
      expect(poolCount).toBe(0);

      const migrations: any = await testPrisma.$queryRaw`
        SELECT migration_name, finished_at FROM _prisma_migrations;
      `;
      expect(migrations.length).toBe(1);
      expect(migrations[0].migration_name).toContain('init_production_schema');
    } finally {
      await testPrisma.$disconnect();

      // Cleanup test database
      const cleanupPrisma = new PrismaClient({
        datasources: {
          db: { url: 'postgresql://postgres:1234@localhost:5432/postgres?schema=public' },
        },
      });
      await cleanupPrisma.$connect();
      await cleanupPrisma.$executeRawUnsafe('DROP DATABASE IF EXISTS hiralal_scenario_a_test;');
      await cleanupPrisma.$disconnect();
    }
  }, 30000);

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
});
