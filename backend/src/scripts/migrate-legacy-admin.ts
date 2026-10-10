import { PrismaClient, UserRole } from '@prisma/client';
import { config } from '../config';

export interface AdminMigrationSummary {
  totalFound: number;
  migratedToOperations: number;
  migratedToBillAdmin: number;
  failed: number;
  errors: Array<{ userId: string; reason: string }>;
}

/**
 * Forward-only, idempotent migration runner to classify legacy monolithic ADMIN accounts
 * into separated role-based accounts (BILL_ADMIN or OPERATIONS_ADMIN).
 * Creates audit log entries for full compliance and traceability.
 */
export async function migrateLegacyAdminAccounts(prisma: PrismaClient): Promise<AdminMigrationSummary> {
  const summary: AdminMigrationSummary = {
    totalFound: 0,
    migratedToOperations: 0,
    migratedToBillAdmin: 0,
    failed: 0,
    errors: [],
  };

  const legacyAdmins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });

  summary.totalFound = legacyAdmins.length;

  for (const adminUser of legacyAdmins) {
    try {
      let targetRole: UserRole = 'OPERATIONS_ADMIN';

      // Check if mobile matches bill admin mobile
      const billMobile = config.admin.billAdminMobile?.replace(/\D/g, '').slice(-10);
      const userPhone = adminUser.mobile.replace(/\D/g, '').slice(-10);

      if (billMobile && userPhone === billMobile) {
        targetRole = 'BILL_ADMIN';
      } else if (userPhone === '9999999991') {
        targetRole = 'BILL_ADMIN';
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: adminUser.id },
          data: { role: targetRole },
        });

        await tx.auditLog.create({
          data: {
            adminId: adminUser.id,
            action: 'LEGACY_ADMIN_ROLE_MIGRATION',
            entityType: 'User',
            entityId: adminUser.id,
            oldValue: JSON.stringify({ role: 'ADMIN' }),
            newValue: JSON.stringify({ role: targetRole }),
          },
        });
      });

      if (targetRole === 'BILL_ADMIN') {
        summary.migratedToBillAdmin++;
      } else {
        summary.migratedToOperations++;
      }

      console.log(`✅ Migrated legacy ADMIN user ${adminUser.id} (${adminUser.mobile}) to ${targetRole}`);
    } catch (err: any) {
      summary.failed++;
      summary.errors.push({
        userId: adminUser.id,
        reason: err.message || 'Unknown migration failure',
      });
      console.error(`❌ Failed to migrate legacy ADMIN user ${adminUser.id}:`, err);
    }
  }

  return summary;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  migrateLegacyAdminAccounts(prisma)
    .then((summary) => {
      console.log('Migration summary:', JSON.stringify(summary, null, 2));
      process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
