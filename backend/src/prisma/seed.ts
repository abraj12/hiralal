import bcrypt from 'bcryptjs';
import { prisma } from '../db';

async function main() {
  console.log('🌱 Starting database seeding for Hiralal & Sons...');

  try {
    const passwordHash = await bcrypt.hash('Password@123', 10);
    const adminPasswordHash = await bcrypt.hash('Admin@123', 10);

    // 1. Seed Super Admin
    const admin = await prisma.user.upsert({
      where: { mobile: '9999999999' },
      update: {},
      create: {
        mobile: '9999999999',
        fullName: 'Hiralal Admin',
        passwordHash: adminPasswordHash,
        profession: 'NONE',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    console.log(`✅ Admin user seeded: ${admin.fullName} (${admin.mobile})`);

    // 2. Seed Plumber: Raj Kumar
    const raj = await prisma.user.upsert({
      where: { mobile: '9876543210' },
      update: {},
      create: {
        mobile: '9876543210',
        fullName: 'Raj Kumar',
        passwordHash,
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 1600.0,
            processingAmount: 850.0,
            totalRedeemed: 2000.0,
          },
        },
        kycRecords: {
          create: {
            panNumber: 'ABCDE1234F',
            panName: 'RAJ KUMAR',
            panStatus: 'VERIFIED',
            maskedPan: 'ABCDE••••F',
            verifiedAt: new Date(),
          },
        },
        paymentAccounts: {
          create: {
            accountType: 'UPI',
            upiId: 'rajkumar@okhdfcbank',
            maskedInfo: 'raj****@okhdfcbank',
            isVerified: true,
            verifiedAt: new Date(),
            isDefault: true,
          },
        },
      },
    });
    console.log(`✅ Plumber user seeded: ${raj.fullName} (${raj.mobile})`);

    // 3. Seed Tile Installer: Amit Kumar
    const amit = await prisma.user.upsert({
      where: { mobile: '9876543211' },
      update: {},
      create: {
        mobile: '9876543211',
        fullName: 'Amit Kumar',
        passwordHash,
        profession: 'TILE_INSTALLER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        wallet: {
          create: {
            availableBalance: 2170.0,
            processingAmount: 950.0,
            totalRedeemed: 3500.0,
          },
        },
        kycRecords: {
          create: {
            panNumber: 'FGHIJ5678K',
            panName: 'AMIT KUMAR',
            panStatus: 'VERIFIED',
            maskedPan: 'FGHIJ••••K',
            verifiedAt: new Date(),
          },
        },
        paymentAccounts: {
          create: {
            accountType: 'BANK_ACCOUNT',
            bankName: 'HDFC Bank',
            accountHolderName: 'Amit Kumar',
            accountNumber: '50100234569012',
            ifscCode: 'HDFC0001234',
            maskedInfo: 'HDFC Bank ••••••9012',
            isVerified: true,
            verifiedAt: new Date(),
            isDefault: true,
          },
        },
      },
    });
    console.log(`✅ Tile Installer seeded: ${amit.fullName} (${amit.mobile})`);

    // 4. Seed Monthly Reward Pool
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
        usedAmount: 37850.0, // Matching spec: ₹37,850 / ₹50,000 (75.7% Used)
        isCapped: false,
      },
    });
    console.log('✅ Monthly reward pool seeded: ₹37,850 / ₹50,000 (75.7% used)');

    // 5. Seed Reward Rule
    await prisma.rewardRule.create({
      data: {
        profession: 'NONE',
        percentage: 0.5,
        monthlyPoolLimit: 50000.0,
        minRedemptionAmount: 500.0,
        isActive: true,
        updatedAt: new Date(),
      },
    });
    console.log('✅ Default reward rule seeded: 0.5% with ₹50,000 monthly limit');

    console.log('🎉 Seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
