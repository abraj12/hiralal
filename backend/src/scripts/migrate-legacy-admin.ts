import { PrismaClient, UserRole } from '@prisma/client';
import { config } from '../config';

export interface AdminMigrationSummary {
  totalFound: number;
  migratedToOperations: number;
  migratedToBillAdmin: number;
  failed: number;
  errors: Array<{ userId: string; reason: string }>;
}

export interface AdminMigrationOptions {
  dryRun?: boolean;
}

/**
 * Forward-only, fail-closed migration runner to classify legacy monolithic ADMIN accounts
 * into separated role-based accounts (BILL_ADMIN or OPERATIONS_ADMIN).
 * Only maps to target roles if mobile strictly matches configured admin credentials.
 * Rejects unmapped legacy accounts without modifying database records.
 * Supports --dry-run for pre-flight verification without mutating state.
 */
export async function migrateLegacyAdminAccounts(
  prisma: PrismaClient,
  options: AdminMigrationOptions = {}
): Promise<AdminMigrationSummary> {
  const isDryRun = options.dryRun ?? process.argv.includes('--dry-run');

  const summary: AdminMigrationSummary = {
    totalFound: 0,
    migratedToOperations: 0,
    migratedToBillAdmin: 0,
    failed: 0,
    errors: [],
  };

  const legacyAdmins = await prisma.$queryRawUnsafe<Array<{ id: string; mobile: string; role: string }>>(
    'SELECT id, mobile, "role"::text as role FROM "User" WHERE "role"::text = \'ADMIN\' ORDER BY "createdAt" ASC'
  );

  summary.totalFound = legacyAdmins.length;

  const billMobile = config.admin.billAdminMobile?.replace(/\D/g, '').slice(-10);
  const opsMobile = config.admin.operationsAdminMobile?.replace(/\D/g, '').slice(-10);

  for (const adminUser of legacyAdmins) {
    try {
      const userPhone = adminUser.mobile.replace(/\D/g, '').slice(-10);
      let targetRole: UserRole | null = null;

      if (billMobile && userPhone === billMobile) {
        targetRole = 'BILL_ADMIN';
      } else if (opsMobile && userPhone === opsMobile) {
        targetRole = 'OPERATIONS_ADMIN';
      } else {
        throw new Error(
          `Unmapped legacy admin mobile (${adminUser.mobile}). Mobile does not match configured BILL_ADMIN_MOBILE or OPERATIONS_ADMIN_MOBILE. Migration fails closed without altering role.`
        );
      }

      if (!isDryRun) {
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
      }

      if (targetRole === 'BILL_ADMIN') {
        summary.migratedToBillAdmin++;
      } else {
        summary.migratedToOperations++;
      }

      console.log(
        `${isDryRun ? '[DRY-RUN] Would migrate' : '✅ Migrated'} legacy ADMIN user ${adminUser.id} (${adminUser.mobile}) to ${targetRole}`
      );
    } catch (err: any) {
      summary.failed++;
      summary.errors.push({
        userId: adminUser.id,
        reason: err.message || 'Unknown migration failure',
      });
      console.error(`❌ Failed to migrate legacy ADMIN user ${adminUser.id}:`, err.message);
    }
  }

  return summary;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('🔍 Running legacy admin migration in DRY-RUN mode (no database writes)...');
  }

  migrateLegacyAdminAccounts(prisma, { dryRun: isDryRun })
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
