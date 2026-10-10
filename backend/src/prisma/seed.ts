import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Hiralal & Sons Production Database Seeding...');

  try {
    // 1. Provision Company Executive Admin
    const initialAdminMobile = process.env.ADMIN_INITIAL_MOBILE || '9999999999';
    const initialAdminPassword =
      process.env.ADMIN_INITIAL_PASSWORD ||
      (process.env.NODE_ENV === 'production' ? '' : 'Admin@123');

    let admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    if (!admin) {
      if (!initialAdminPassword) {
        throw new Error(
          'ADMIN_INITIAL_PASSWORD environment variable is required to provision initial administrator in production.'
        );
      }
      const adminPasswordHash = await bcrypt.hash(initialAdminPassword, 10);
      admin = await prisma.user.create({
        data: {
          mobile: initialAdminMobile,
          fullName: 'Hiralal & Sons Executive Administrator',
          passwordHash: adminPasswordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
          isVerified: true,
        },
      });
      console.log(`✅ Company Admin provisioned: ${admin.fullName} (${admin.mobile})`);
    } else {
      console.log(`ℹ️ Existing Admin detected (${admin.mobile}). Preserving existing credentials.`);
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
            createdByAdminId: admin.id,
          },
          {
            ratePercentage: 12.0,
            description: 'Concessional 12% GST',
            isDefault: false,
            isActive: true,
            createdByAdminId: admin.id,
          },
          {
            ratePercentage: 0.0,
            description: 'Tax Exempt (0% GST)',
            isDefault: false,
            isActive: true,
            createdByAdminId: admin.id,
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
        updatedByAdminId: admin.id,
      },
    });
    // 6. Provision Demo Plumber & Tile Worker for Testing
    const userPasswordHash = await bcrypt.hash('User@123', 10);
    
    // Demo Plumber
    const demoPlumber = await prisma.user.upsert({
      where: { mobile: '9876543210' },
      update: {
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        passwordHash: userPasswordHash,
        profession: 'PLUMBER',
      },
      create: {
        mobile: '9876543210',
        fullName: 'Ramesh Kumar (Plumber)',
        passwordHash: userPasswordHash,
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 2500.0,
            processingAmount: 0.0,
            totalRedeemed: 1000.0,
          },
        },
      },
    });

    // Ensure wallet exists for demo plumber
    await prisma.wallet.upsert({
      where: { userId: demoPlumber.id },
      update: {},
      create: {
        userId: demoPlumber.id,
        availableBalance: 2500.0,
        processingAmount: 0.0,
        totalRedeemed: 1000.0,
      },
    });
    console.log(`✅ Demo Plumber provisioned: ${demoPlumber.fullName} (${demoPlumber.mobile}) | Balance: ₹2,500`);

    // Demo Tile Installer
    const demoTile = await prisma.user.upsert({
      where: { mobile: '9876543211' },
      update: {
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        passwordHash: userPasswordHash,
        profession: 'TILE_INSTALLER',
      },
      create: {
        mobile: '9876543211',
        fullName: 'Suresh Verma (Tile Worker)',
        passwordHash: userPasswordHash,
        profession: 'TILE_INSTALLER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 3200.0,
            processingAmount: 0.0,
            totalRedeemed: 500.0,
          },
        },
      },
    });

    // Ensure wallet exists for demo tile worker
    await prisma.wallet.upsert({
      where: { userId: demoTile.id },
      update: {},
      create: {
        userId: demoTile.id,
        availableBalance: 3200.0,
        processingAmount: 0.0,
        totalRedeemed: 500.0,
      },
    });
    console.log(`✅ Demo Tile Worker provisioned: ${demoTile.fullName} (${demoTile.mobile}) | Balance: ₹3,200`);

    console.log('🎉 Production database initialization complete!');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
