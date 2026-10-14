import {
  UserRole as PrismaUserRole,
  OtpPurpose as PrismaOtpPurpose,
  BillStatus as PrismaBillStatus,
  PayoutStatus as PrismaPayoutStatus,
  Profession as PrismaProfession,
  TransactionType as PrismaTransactionType,
  KycStatus as PrismaKycStatus,
  PaymentType as PrismaPaymentType,
} from '@prisma/client';

import fs from 'fs';
import path from 'path';

function extractSharedEnum(enumName: string): string[] {
  const filePath = path.resolve(__dirname, '../../../shared/types/index.ts');
  const content = fs.readFileSync(filePath, 'utf-8');
  const enumRegex = new RegExp(`export\\s+enum\\s+${enumName}\\s*\\{([^\\}]+)\\}`, 'm');
  const match = content.match(enumRegex);
  if (!match) {
    throw new Error(`Enum ${enumName} not found in shared/types/index.ts`);
  }
  const body = match[1];
  const values: string[] = [];
  const valueRegex = /=\s*['"]([^'"]+)['"]/g;
  let valMatch;
  while ((valMatch = valueRegex.exec(body)) !== null) {
    values.push(valMatch[1]);
  }
  return values.sort();
}

describe('Shared Contract Parity & Enum Invariants', () => {
  it('UserRole enum strictly matches @prisma/client byte-for-byte and contains NO legacy ADMIN', () => {
    const prismaRoles = Object.values(PrismaUserRole).sort();
    const sharedRoles = extractSharedEnum('UserRole');

    expect(sharedRoles).toEqual(prismaRoles);
    expect(sharedRoles).toEqual(['BILL_ADMIN', 'OPERATIONS_ADMIN', 'USER']);
    expect(sharedRoles).not.toContain('ADMIN');
  });

  it('OtpPurpose enum strictly matches @prisma/client and includes all approved flow purposes', () => {
    const prismaPurposes = Object.values(PrismaOtpPurpose).sort();
    const sharedPurposes = extractSharedEnum('OtpPurpose');

    expect(sharedPurposes).toEqual(prismaPurposes);
    expect(sharedPurposes).toEqual([
      'ACCOUNT_DELETION',
      'ADMIN_LOGIN',
      'FORGOT_PASSWORD',
      'LOGIN',
      'REGISTRATION',
    ]);
  });

  it('BillStatus enum strictly matches @prisma/client', () => {
    const prismaStatuses = Object.values(PrismaBillStatus).sort();
    const sharedStatuses = extractSharedEnum('BillStatus');

    // Verify all shared statuses are valid Prisma statuses
    expect(sharedStatuses).toEqual(
      expect.arrayContaining(['APPROVED', 'DUPLICATE', 'PENDING', 'REJECTED', 'UNDER_REVIEW'])
    );
    sharedStatuses.forEach((status) => {
      expect(prismaStatuses).toContain(status);
    });
  });

  it('PayoutStatus enum strictly matches @prisma/client', () => {
    const prismaStatuses = Object.values(PrismaPayoutStatus).sort();
    const sharedStatuses = extractSharedEnum('PayoutStatus');

    expect(sharedStatuses).toEqual(prismaStatuses);
    expect(sharedStatuses).toEqual([
      'APPROVED',
      'FAILED',
      'PAYOUT_INITIATED',
      'PENDING',
      'PROCESSING',
      'REVERSED',
      'SUCCESS',
    ]);
  });

  it('Profession enum strictly matches @prisma/client', () => {
    const prismaProfessions = Object.values(PrismaProfession).sort();
    const sharedProfessions = extractSharedEnum('Profession');

    expect(sharedProfessions).toEqual(prismaProfessions);
    expect(sharedProfessions).toEqual(['PLUMBER', 'TILE_INSTALLER']);
  });

  it('PaymentType and KycStatus enums match @prisma/client', () => {
    expect(extractSharedEnum('PaymentType')).toEqual(Object.values(PrismaPaymentType).sort());
    expect(extractSharedEnum('KycStatus')).toEqual(Object.values(PrismaKycStatus).sort());
  });
});
