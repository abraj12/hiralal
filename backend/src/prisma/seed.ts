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

async function main() {
  console.log('🌱 Starting Hiralal & Sons Production Database Seeding...');

  try {
    // 1. Provision Bill Review Administrator (BILL_ADMIN)
    const billAdminMobile = process.env.BILL_ADMIN_MOBILE || '9999999991';
    const billAdminPassword =
      process.env.BILL_ADMIN_INITIAL_PASSWORD ||
      process.env.ADMIN_INITIAL_PASSWORD ||
      (process.env.NODE_ENV === 'production' ? '' : 'BillAdmin@123');

    let billAdmin = await prisma.user.findFirst({
      where: { role: 'BILL_ADMIN' },
    });

    if (!billAdmin) {
      if (!billAdminPassword) {
        throw new Error(
          'BILL_ADMIN_INITIAL_PASSWORD or ADMIN_INITIAL_PASSWORD is required to provision Bill Admin in production.'
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
    const opsAdminMobile = process.env.OPERATIONS_ADMIN_MOBILE || '9999999992';
    const opsAdminPassword =
      process.env.OPERATIONS_ADMIN_INITIAL_PASSWORD ||
      process.env.ADMIN_INITIAL_PASSWORD ||
      (process.env.NODE_ENV === 'production' ? '' : 'OpsAdmin@123');

    let opsAdmin = await prisma.user.findFirst({
      where: { role: 'OPERATIONS_ADMIN' },
    });

    if (!opsAdmin) {
      if (!opsAdminPassword) {
        throw new Error(
          'OPERATIONS_ADMIN_INITIAL_PASSWORD or ADMIN_INITIAL_PASSWORD is required to provision Operations Admin in production.'
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

    // 2. Provision Initial Monthly Reward Pools per Profession
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    await prisma.rewardPool.upsert({
      where: {
        pool_profession_year_month_unique: {
          profession: 'PLUMBER',
          year,
          month,
        },
      },
      update: {},
      create: {
        profession: 'PLUMBER',
        year,
        month,
        totalPoolCap: 50000.0,
        usedAmount: 0.0,
        isCapped: false,
      },
    });

    await prisma.rewardPool.upsert({
      where: {
        pool_profession_year_month_unique: {
          profession: 'TILE_INSTALLER',
          year,
          month,
        },
      },
      update: {},
      create: {
        profession: 'TILE_INSTALLER',
        year,
        month,
        totalPoolCap: 50000.0,
        usedAmount: 0.0,
        isCapped: false,
      },
    });
    console.log('✅ Monthly reward pools provisioned: ₹50,000 Plumbers, ₹50,000 Tile Installers');

    // 3. Provision Reward Rules for Plumber & Tile Installer
    const existingRules = await prisma.rewardRule.findMany();
    if (existingRules.length === 0) {
      await prisma.rewardRule.createMany({
        data: [
          {
            profession: 'PLUMBER',
            rewardPercentage: 0.50,
            monthlyPoolLimit: 50000.0,
            minRedemptionAmount: 500.0,
            maxRedemptionAmount: 10000.0,
            effectiveFrom: new Date('2020-01-01'),
            version: 1,
            isActive: true,
          },
          {
            profession: 'TILE_INSTALLER',
            rewardPercentage: 0.75,
            monthlyPoolLimit: 50000.0,
            minRedemptionAmount: 500.0,
            maxRedemptionAmount: 10000.0,
            effectiveFrom: new Date('2020-01-01'),
            version: 1,
            isActive: true,
          },
        ],
      });
      console.log('✅ Profession reward rules provisioned: 0.50% Plumber, 0.75% Tile Installer');
    }

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
        minimumAmount: 500.0,
        maximumAmount: 10000.0,
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
