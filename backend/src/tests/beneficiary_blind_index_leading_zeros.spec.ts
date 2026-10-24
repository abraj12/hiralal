import { prisma } from '../db';
import { PaymentService } from '../services/payment.service';
import { generateBlindIndex } from '../utils/crypto.utils';
import * as bcrypt from 'bcryptjs';

describe('FINDING-04: Bank Account Blind Index Leading-Zero Canonicalization Suite', () => {
  let userA: any;
  let userB: any;
  const testIfsc = 'HDFC0001234';
  const rawAccountPadded = '00000012345678901';
  const rawAccountUnpadded = '12345678901';

  beforeAll(async () => {
    // Cleanup any existing test records
    await prisma.paymentAccount.deleteMany({
      where: {
        OR: [
          { ifscCode: testIfsc },
          { user: { mobile: { in: ['9999000001', '9999000002'] } } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: ['9999000001', '9999000002'] } },
    });

    const passwordHash = await bcrypt.hash('Password123!', 10);

    userA = await prisma.user.create({
      data: {
        mobile: '9999000001',
        fullName: 'User A Plumber',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });

    userB = await prisma.user.create({
      data: {
        mobile: '9999000002',
        fullName: 'User B Plumber',
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.paymentAccount.deleteMany({
      where: {
        OR: [
          { userId: userA.id },
          { userId: userB.id },
          { ifscCode: testIfsc },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });

  test('1. Blind index is mathematically identical for zero-padded and unpadded representations', () => {
    const canonicalPadded = rawAccountPadded.replace(/^0+/, '');
    const canonicalUnpadded = rawAccountUnpadded.replace(/^0+/, '');
    expect(canonicalPadded).toBe(canonicalUnpadded);

    const indexPadded = generateBlindIndex(`BANK:${testIfsc}:${canonicalPadded}`);
    const indexUnpadded = generateBlindIndex(`BANK:${testIfsc}:${canonicalUnpadded}`);

    expect(indexPadded).toBe(indexUnpadded);
  });

  test('2. Successfully links zero-padded bank account for User A and marks verified', async () => {
    const canonical = rawAccountPadded.replace(/^0+/, '');
    const blindIndex = generateBlindIndex(`BANK:${testIfsc}:${canonical}`);

    const accountA = await prisma.paymentAccount.create({
      data: {
        userId: userA.id,
        accountType: 'BANK_ACCOUNT',
        accountNumber: 'XXXX78901',
        maskedInfo: 'HDFC Bank - XXXX78901',
        accountHolderName: 'User A Plumber',
        ifscCode: testIfsc,
        bankName: 'HDFC Bank',
        isVerified: true,
        isDefault: true,
        beneficiaryBlindIndex: blindIndex,
      },
    });

    expect(accountA).toBeDefined();
    expect(accountA.beneficiaryBlindIndex).toBe(blindIndex);
  });

  test('3. Rejects User B linking equivalent unpadded account number due to duplicate beneficiary blind index', async () => {
    await expect(
      PaymentService.verifyAndAddBankAccount({
        userId: userB.id,
        accountNumber: rawAccountUnpadded,
        ifscCode: testIfsc,
        accountHolderName: 'User B Plumber',
        bankName: 'HDFC Bank',
      })
    ).rejects.toThrow('This bank account is already registered and verified with another user account.');
  });

  test('4. Rejects invalid bank account numbers with too few significant digits', async () => {
    await expect(
      PaymentService.verifyAndAddBankAccount({
        userId: userB.id,
        accountNumber: '000000000001',
        ifscCode: testIfsc,
        accountHolderName: 'User B Plumber',
      })
    ).rejects.toThrow('Please enter a valid bank account number.');
  });

  test('5. Permits User B to link a genuinely distinct bank account number', async () => {
    const distinctAccount = '12345678999';
    const canonicalDistinct = distinctAccount.replace(/^0+/, '');
    const distinctIndex = generateBlindIndex(`BANK:${testIfsc}:${canonicalDistinct}`);

    const accountB = await prisma.paymentAccount.create({
      data: {
        userId: userB.id,
        accountType: 'BANK_ACCOUNT',
        accountNumber: 'XXXX78999',
        maskedInfo: 'HDFC Bank - XXXX78999',
        accountHolderName: 'User B Plumber',
        ifscCode: testIfsc,
        bankName: 'HDFC Bank',
        isVerified: true,
        isDefault: true,
        beneficiaryBlindIndex: distinctIndex,
      },
    });

    expect(accountB).toBeDefined();
    expect(accountB.beneficiaryBlindIndex).toBe(distinctIndex);
  });
});
