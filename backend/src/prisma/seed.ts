import bcrypt from 'bcryptjs';
import { prisma } from '../db';

async function main() {
  console.log('🌱 Starting database seeding for Hiralal & Sons...');

  try {
    const adminPasswordHash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'Admin@123', 10);

    // 1. Provision Secure Company Administrator
    const admin = await prisma.user.upsert({
      where: { mobile: '9999999999' },
      update: {
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      create: {
        mobile: '9999999999',
        fullName: 'Hiralal Admin',
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    console.log(`✅ Company Admin provisioned: ${admin.fullName} (${admin.mobile})`);

    // 2. Provision Initial Monthly Reward Pool
    const now = new Date();
    await prisma.rewardPool.upsert({
      where: {
        pool_year_month_unique: {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      },
      update: {},
      create: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        totalPoolCap: 50000.0,
        usedAmount: 0.0,
        isCapped: false,
      },
    });
    console.log('✅ Monthly reward pool provisioned: ₹50,000 monthly ceiling');

    // 3. Provision Reward Rules for Plumber & Tile Installer
    const existingRules = await prisma.rewardRule.findMany();
    if (existingRules.length === 0) {
      await prisma.rewardRule.createMany({
        data: [
          {
            profession: 'PLUMBER',
            percentage: 0.5,
            monthlyPoolLimit: 50000.0,
            minRedemptionAmount: 500.0,
            isActive: true,
          },
          {
            profession: 'TILE_INSTALLER',
            percentage: 0.5,
            monthlyPoolLimit: 50000.0,
            minRedemptionAmount: 500.0,
            isActive: true,
          },
        ],
      });
      console.log('✅ Profession reward rules provisioned: 0.5% (Plumber & Tile Installer)');
    }

    // 4. Provision Initial Redemption Settings
    await prisma.redemptionSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        isEnabled: true,
        startAt: new Date(Date.now() - 24 * 3600 * 1000), // Active by default
        endAt: new Date(Date.now() + 60 * 24 * 3600 * 1000), // 60 days window
        minimumAmount: 500.0,
        maximumAmount: 10000.0,
        message: 'Rewards redemption window is open for eligible verified craftsmen.',
        updatedByAdminId: admin.id,
      },
    });
    console.log('✅ Redemption settings provisioned (Admin-controlled window)');

    console.log('🎉 Production database initialization complete!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
