import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export function assertDemoSeedAllowed(
  nodeEnv: string = process.env.NODE_ENV || 'development',
  enableDemoSeed: string | undefined = process.env.ENABLE_DEMO_SEED
): void {
  if (nodeEnv === 'production') {
    throw new Error('Demo seed is disabled in production.');
  }

  if (enableDemoSeed !== 'true') {
    throw new Error('Set ENABLE_DEMO_SEED=true to provision demo users.');
  }
}

export interface ProvisionRewardRulesResult {
  provisioned: string[];
  preserved: string[];
  warnings: string[];
}

/**
 * Safely provisions baseline reward rules for worker professions.
 * Invariant:
 * 1. Counts all reward-rule records for the profession, including inactive records.
 * 2. Creates the initial baseline (v1, 0.50%, 2020-01-01 IST) ONLY if the profession has zero historical records.
 * 3. If rows exist but none is active, preserves them and halts baseline provisioning for that profession with an explicit diagnostic.
 * 4. Never silently rewrites an existing row, invents a duplicate version, back-dates history, or reactivates a profession through implicit seed.
 */
export async function provisionRewardRules(
  prismaClient: PrismaClient = prisma
): Promise<ProvisionRewardRulesResult> {
  const result: ProvisionRewardRulesResult = {
    provisioned: [],
    preserved: [],
    warnings: [],
  };

  for (const prof of ['PLUMBER', 'TILE_INSTALLER'] as const) {
    const postCommitLogs: Array<() => void> = [];

    await prismaClient.$transaction(async (trx: any) => {
      // Concurrency lock: acquire transaction-scoped PostgreSQL advisory lock per profession.
      // Prevents race conditions during concurrent seed execution or simultaneous admin operations.
      await trx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reward_rule_' + prof})::bigint)`;

      const totalCount = await trx.rewardRule.count({
        where: { profession: prof },
      });

      if (totalCount === 0) {
        if (process.env.NODE_ENV === 'production') {
          // Requirement: In production, do NOT silently create 0.5% baseline rules. Operations Admin must create the first rule.
          const msg = `ℹ️ [SEED] Production mode: Automatic 0.50% reward rule creation disabled for ${prof}. Operations Admin must configure reward rules via the administration interface before rewards can be calculated.`;
          result.warnings.push(msg);
          postCommitLogs.push(() => {
            console.log(msg);
          });
        } else if (process.env.ENABLE_DEMO_SEED === 'true' || process.env.ENABLE_DEV_REWARD_RULES === 'true') {
          await trx.rewardRule.create({
            data: {
              profession: prof,
              rewardPercentage: 0.50,
              effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
              version: 1,
              isActive: true,
            },
          });
          result.provisioned.push(prof);
          postCommitLogs.push(() => {
            console.log(`✅ [SEED] Initial demo reward rule created for ${prof} (0.50%, v1, 2020-01-01 IST)`);
          });
        } else {
          const msg = `ℹ️ [SEED] Profession ${prof} has zero reward rules. Operations Admin must configure reward rules via the administrative portal before rewards can be calculated.`;
          result.warnings.push(msg);
          postCommitLogs.push(() => {
            console.log(msg);
          });
        }
      } else {
        // Historical records exist: preserve all rows immutable
        const activeRule = await trx.rewardRule.findFirst({
          where: { profession: prof, isActive: true },
          orderBy: { version: 'desc' },
        });

        if (activeRule) {
          result.preserved.push(prof);
          postCommitLogs.push(() => {
            console.log(
              `ℹ️  [SEED] Active ${prof} rule already exists (v${activeRule.version}, effectiveFrom: ${activeRule.effectiveFrom.toISOString()}). Preserving as-is. If effectiveFrom is incorrect, correct it via a separately reviewed migration, not via seed.`
            );
          });
        } else {
          // Historical rows exist but NONE is currently active: halt baseline provisioning
          const warning = `⚠️  [SEED-WARNING] Profession ${prof} has ${totalCount} existing historical reward rule(s), but none is currently active. Preserving existing records without modification. Baseline provisioning halted for ${prof}. An authorized Operations Admin must review history and create a new rule version via administrative workflow if reactivation is required.`;
          result.warnings.push(warning);
          result.preserved.push(prof);
          postCommitLogs.push(() => {
            console.warn(warning);
          });
        }
      }
    });

    // Execute logging after transaction has committed so aborted transactions do not emit misleading logs
    for (const emitLog of postCommitLogs) {
      emitLog();
    }
  }

  return result;
}

async function main() {
  console.log('🌱 Starting Hiralal & Sons Production Database Seeding...');

  try {
    // 1. Provision Bill Review Administrator (BILL_ADMIN)
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.BILL_ADMIN_MOBILE) {
        throw new Error('BILL_ADMIN_MOBILE is required in production.');
      }
      const cleanBill = process.env.BILL_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      if (cleanBill === '9999999991') {
        throw new Error('Default mobile 9999999991 is not permitted for BILL_ADMIN in production.');
      }
      if (!process.env.BILL_ADMIN_INITIAL_PASSWORD) {
        throw new Error('BILL_ADMIN_INITIAL_PASSWORD is required to provision Bill Admin in production.');
      }
    }

    // Pre-check for multiple admin identities to enforce the Two-Admin invariant
    const existingBillAdmins = await prisma.user.findMany({
      where: { role: 'BILL_ADMIN' },
    });
    if (existingBillAdmins.length > 1) {
      throw new Error(
        `[FATAL] Multiple BILL_ADMIN identities detected (${existingBillAdmins.length}). Exactly one provisioned BILL_ADMIN is permitted.`
      );
    }

    const existingOpsAdmins = await prisma.user.findMany({
      where: { role: 'OPERATIONS_ADMIN' },
    });
    if (existingOpsAdmins.length > 1) {
      throw new Error(
        `[FATAL] Multiple OPERATIONS_ADMIN identities detected (${existingOpsAdmins.length}). Exactly one provisioned OPERATIONS_ADMIN is permitted.`
      );
    }

    const legacyAdminRows: Array<{ count: bigint | number }> = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM "User" WHERE "role"::text = 'ADMIN';
    `;
    const legacyAdminCount = Number(legacyAdminRows[0]?.count || 0);
    if (legacyAdminCount > 0) {
      throw new Error(
        `[FATAL] Detected ${legacyAdminCount} unresolved legacy ADMIN account(s). All administrative accounts must be resolved to BILL_ADMIN or OPERATIONS_ADMIN.`
      );
    }

    const billAdminMobile = process.env.BILL_ADMIN_MOBILE || '9999999991';
    const billAdminPassword =
      process.env.BILL_ADMIN_INITIAL_PASSWORD ||
      (process.env.NODE_ENV === 'production' ? '' : 'BillAdmin@123');

    let billAdmin = existingBillAdmins[0] || null;

    if (!billAdmin) {
      if (!billAdminPassword) {
        throw new Error(
          'BILL_ADMIN_INITIAL_PASSWORD is required to provision Bill Admin in production.'
        );
      }
      const billAdminHash = await bcrypt.hash(billAdminPassword, 10);
      billAdmin = await prisma.user.create({
        data: {
          mobile: billAdminMobile,
          fullName: 'Hiralal & Sons Bill Review Administrator',
          passwordHash: billAdminHash,
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
      console.log(`✅ Bill Admin provisioned: ${billAdmin.fullName} (${billAdmin.mobile})`);
    } else {
      console.log(`ℹ️ Existing Bill Admin detected (${billAdmin.mobile}). Preserving existing credentials.`);
    }

    // 2. Provision Operations Administrator (OPERATIONS_ADMIN)
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.OPERATIONS_ADMIN_MOBILE) {
        throw new Error('OPERATIONS_ADMIN_MOBILE is required in production.');
      }
      const cleanOps = process.env.OPERATIONS_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      if (cleanOps === '9999999992') {
        throw new Error('Default mobile 9999999992 is not permitted for OPERATIONS_ADMIN in production.');
      }
      const cleanBill = (process.env.BILL_ADMIN_MOBILE || '').replace(/\D/g, '').slice(-10);
      if (cleanBill && cleanOps === cleanBill) {
        throw new Error('BILL_ADMIN_MOBILE and OPERATIONS_ADMIN_MOBILE must be distinct in production.');
      }
      if (!process.env.OPERATIONS_ADMIN_INITIAL_PASSWORD) {
        throw new Error('OPERATIONS_ADMIN_INITIAL_PASSWORD is required to provision Operations Admin in production.');
      }
      if (process.env.BILL_ADMIN_INITIAL_PASSWORD === process.env.OPERATIONS_ADMIN_INITIAL_PASSWORD) {
        throw new Error('BILL_ADMIN_INITIAL_PASSWORD and OPERATIONS_ADMIN_INITIAL_PASSWORD must be distinct.');
      }
    }

    const opsAdminMobile = process.env.OPERATIONS_ADMIN_MOBILE || '9999999992';
    const opsAdminPassword =
      process.env.OPERATIONS_ADMIN_INITIAL_PASSWORD ||
      (process.env.NODE_ENV === 'production' ? '' : 'OpsAdmin@123');

    let opsAdmin = existingOpsAdmins[0] || null;

    if (!opsAdmin) {
      if (!opsAdminPassword) {
        throw new Error(
          'OPERATIONS_ADMIN_INITIAL_PASSWORD is required to provision Operations Admin in production.'
        );
      }
      const opsAdminHash = await bcrypt.hash(opsAdminPassword, 10);
      opsAdmin = await prisma.user.create({
        data: {
          mobile: opsAdminMobile,
          fullName: 'Hiralal & Sons Operations Administrator',
          passwordHash: opsAdminHash,
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
      console.log(`✅ Operations Admin provisioned: ${opsAdmin.fullName} (${opsAdmin.mobile})`);
    } else {
      console.log(`ℹ️ Existing Operations Admin detected (${opsAdmin.mobile}). Preserving existing credentials.`);
    }

    // 2. Provision Reward Rules for Plumber & Tile Installer
    await provisionRewardRules(prisma);
    console.log('✅ Profession reward rules initialization verified.');

    // 4. Provision GST Tax Rules
    const existingGstRules = await prisma.gstRule.findMany();
    if (existingGstRules.length === 0) {
      await prisma.gstRule.createMany({
        data: [
          {
            ratePercentage: 18.0,
            description: 'Standard 18% GST (Plumbing & Tile Hardware)',
            isDefault: true,
            isActive: true,
            createdByAdminId: opsAdmin.id,
          },
          {
            ratePercentage: 12.0,
            description: 'Concessional 12% GST',
            isDefault: false,
            isActive: true,
            createdByAdminId: opsAdmin.id,
          },
          {
            ratePercentage: 0.0,
            description: 'Tax Exempt (0% GST)',
            isDefault: false,
            isActive: true,
            createdByAdminId: opsAdmin.id,
          },
        ],
      });
      console.log('✅ GST tax rules provisioned: 18% (default), 12%, 0%');
    }

    // 5. Provision Initial Redemption Settings (CLOSED BY DEFAULT in production)
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        isEnabled: false, // Default CLOSED until administration explicitly opens the window
        startAt: null,
        endAt: null,
        message: 'Rewards redemption is currently unavailable.',
        updatedByAdminId: opsAdmin.id,
      },
    });

    // 6. Provision Demo Plumber & Tile Worker for Non-Production Testing
    if (process.env.ENABLE_DEMO_SEED === 'true' || process.env.NODE_ENV === 'test') {
      assertDemoSeedAllowed();

      const userPasswordHash = await bcrypt.hash('User@123', 10);

      // Demo Plumber
      let demoPlumber = await prisma.user.findUnique({
        where: { mobile: '9876543210' },
      });

      if (!demoPlumber) {
        demoPlumber = await prisma.user.create({
          data: {
            mobile: '9876543210',
            fullName: 'Ramesh Kumar (Plumber)',
            passwordHash: userPasswordHash,
            profession: 'PLUMBER',
            role: 'USER',
            status: 'ACTIVE',
            isVerified: true,
          },
        });

        const wallet = await prisma.wallet.create({
          data: {
            userId: demoPlumber.id,
            availableBalance: 2500.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        });

        // Auditable opening balance ledger transaction
        await prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: demoPlumber.id,
            amount: 2500.0,
            type: 'MANUAL_ADJUSTMENT',
            balanceAfter: 2500.0,
            referenceType: 'ADMIN',
            referenceId: 'DEMO_SEED_OPENING_BALANCE',
            description: 'Demo initial opening balance',
          },
        });
        console.log(`✅ Demo Plumber provisioned: ${demoPlumber.fullName} (${demoPlumber.mobile}) | Balance: ₹2,500`);
      } else {
        console.log(`ℹ️ Existing Demo Plumber detected (${demoPlumber.mobile}). Preserving existing account credentials and status.`);
      }

      // Demo Tile Installer
      let demoTile = await prisma.user.findUnique({
        where: { mobile: '9876543211' },
      });

      if (!demoTile) {
        demoTile = await prisma.user.create({
          data: {
            mobile: '9876543211',
            fullName: 'Suresh Verma (Tile Worker)',
            passwordHash: userPasswordHash,
            profession: 'TILE_INSTALLER',
            role: 'USER',
            status: 'ACTIVE',
            isVerified: true,
          },
        });

        const wallet = await prisma.wallet.create({
          data: {
            userId: demoTile.id,
            availableBalance: 3200.0,
            processingAmount: 0.0,
            totalRedeemed: 0.0,
          },
        });

        // Auditable opening balance ledger transaction
        await prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: demoTile.id,
            amount: 3200.0,
            type: 'MANUAL_ADJUSTMENT',
            balanceAfter: 3200.0,
            referenceType: 'ADMIN',
            referenceId: 'DEMO_SEED_OPENING_BALANCE',
            description: 'Demo initial opening balance',
          },
        });
        console.log(`✅ Demo Tile Worker provisioned: ${demoTile.fullName} (${demoTile.mobile}) | Balance: ₹3,200`);
      } else {
        console.log(`ℹ️ Existing Demo Tile Worker detected (${demoTile.mobile}). Preserving existing account credentials and status.`);
      }
    } else {
      console.log('ℹ️ Demo user provisioning skipped (set ENABLE_DEMO_SEED=true in non-production to provision demo accounts).');
    }

    console.log('🎉 Production database initialization complete!');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

export { main };

if (require.main === module) {
  main();
}
