import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { config } from '../config';
import { AuthService } from '../services/auth.service';
import { resetAdmins } from './test_helpers';

function sha256Hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('HIR-V4-02 & HIR-V4.1-01: Concurrency-Safe Password Lockout & Verification Test Suite', () => {
  const workerMobileA = '9876599001';
  const workerPasswordA = 'WorkerPassA@123';

  const adminMobileB = '9876599002';
  const adminPasswordB = 'AdminPassB@123';

  const workerMobileC = '9876599003';
  const workerPasswordC = 'WorkerPassC@123';

  const workerMobileD = '9876599004';
  const workerPasswordD = 'WorkerPassD@123';

  const adminMobileE = '9876599005';
  const adminPasswordE = 'AdminPassE@123';

  let workerIdA: string;
  let adminIdB: string;
  let workerIdC: string;
  let workerIdD: string;
  let adminIdE: string;

  beforeAll(async () => {
    await resetAdmins(prisma);

    const testMobiles = [workerMobileA, adminMobileB, workerMobileC, workerMobileD, adminMobileE];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.auditLog.deleteMany({ where: { admin: { mobile: { in: testMobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });

    const workerHashA = await bcrypt.hash(workerPasswordA, 10);
    const adminHashB = await bcrypt.hash(adminPasswordB, 10);
    const workerHashC = await bcrypt.hash(workerPasswordC, 10);
    const workerHashD = await bcrypt.hash(workerPasswordD, 10);
    const adminHashE = await bcrypt.hash(adminPasswordE, 10);

    const uA = await prisma.user.create({
      data: {
        mobile: workerMobileA,
        fullName: 'Worker Race User',
        passwordHash: workerHashA,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });
    workerIdA = uA.id;
    await prisma.wallet.create({ data: { userId: uA.id, availableBalance: 100 } });

    const uB = await prisma.user.create({
      data: {
        mobile: adminMobileB,
        fullName: 'Admin Race Lead',
        passwordHash: adminHashB,
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    adminIdB = uB.id;

    const uC = await prisma.user.create({
      data: {
        mobile: workerMobileC,
        fullName: 'Worker Serialization User',
        passwordHash: workerHashC,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'TILE_INSTALLER',
        isVerified: true,
      },
    });
    workerIdC = uC.id;
    await prisma.wallet.create({ data: { userId: uC.id, availableBalance: 100 } });

    const uD = await prisma.user.create({
      data: {
        mobile: workerMobileD,
        fullName: 'Worker Expiry User',
        passwordHash: workerHashD,
        role: 'USER',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });
    workerIdD = uD.id;
    await prisma.wallet.create({ data: { userId: uD.id, availableBalance: 100 } });

    const uE = await prisma.user.create({
      data: {
        mobile: adminMobileE,
        fullName: 'Admin Lockout Verification Lead',
        passwordHash: adminHashE,
        role: 'OPERATIONS_ADMIN',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    adminIdE = uE.id;
  });

  afterAll(async () => {
    const testMobiles = [workerMobileA, adminMobileB, workerMobileC, workerMobileD, adminMobileE];
    await prisma.authSession.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.wallet.deleteMany({ where: { user: { mobile: { in: testMobiles } } } });
    await prisma.verificationToken.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.otpRequest.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.user.deleteMany({ where: { mobile: { in: testMobiles } } });
    await prisma.$disconnect();
  });

  // Test A — Worker race:
  // Successful-password request pauses after preliminary check; concurrent failed requests establish lockout.
  // Resumed successful request MUST fail closed, preserving lockout without creating a session.
  test('Test A — Worker race: concurrent failed requests establish lockout before transaction commits', async () => {
    // Reset state for worker A
    await prisma.user.update({
      where: { id: workerIdA },
      data: { failedPasswordAttempts: 0, lockedUntil: null, activeSessionId: null },
    });
    await prisma.authSession.deleteMany({ where: { userId: workerIdA } });

    const originalCompare = bcrypt.compare;
    let barrierFired = false;

    // Spy on bcrypt.compare to trigger the concurrent failed attempts right before row lock check
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementation(async (data: any, encrypted: string) => {
      const match = await originalCompare(data as string, encrypted);
      if (match && data === workerPasswordA && !barrierFired) {
        barrierFired = true;
        // Deterministic barrier: execute 10 failed login requests while successful login is paused
        const failedAttempts = Array.from({ length: 10 }).map((_, i) =>
          AuthService.login(workerMobileA, `IncorrectPass_${i}`).catch((err) => err)
        );
        await Promise.all(failedAttempts);

        // Verify that lockout is established in database before the racing successful request continues
        const userDuring = await prisma.user.findUnique({ where: { id: workerIdA } });
        expect(userDuring?.failedPasswordAttempts).toBe(10);
        expect(userDuring?.lockedUntil).not.toBeNull();
      }
      return match;
    });

    try {
      // Execute the racing successful login attempt
      await expect(
        AuthService.login(workerMobileA, workerPasswordA)
      ).rejects.toThrow(/Account is temporarily locked due to too many failed login attempts/i);

      // Verify invariant: newly established lockout was PRESERVED and not wiped out by racing request
      const userAfter = await prisma.user.findUnique({ where: { id: workerIdA } });
      expect(userAfter?.failedPasswordAttempts).toBe(10);
      expect(userAfter?.lockedUntil).not.toBeNull();
      expect(userAfter!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(userAfter?.activeSessionId).toBeNull();

      // Verify zero sessions created
      const sessions = await prisma.authSession.findMany({ where: { userId: workerIdA } });
      expect(sessions).toHaveLength(0);
    } finally {
      compareSpy.mockRestore();
    }
  });

  // Test B — Administrator race:
  // Correct-password admin OTP request pauses; concurrent failed-password requests establish lockout.
  // Resumed admin request MUST fail closed, issuing NO OTP and NO challenge token.
  test('Test B — Administrator race: concurrent failed attempts block OTP & challenge issuance', async () => {
    await prisma.user.update({
      where: { id: adminIdB },
      data: { failedPasswordAttempts: 0, lockedUntil: null, activeSessionId: null },
    });
    await prisma.verificationToken.deleteMany({ where: { mobile: adminMobileB } });
    await prisma.otpRequest.deleteMany({ where: { mobile: adminMobileB } });

    const adminIdentifier = `${config.admin.billAdminPrefix}${adminMobileB}`;
    const originalCompare = bcrypt.compare;
    let barrierFired = false;

    const compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementation(async (data: any, encrypted: string) => {
      const match = await originalCompare(data as string, encrypted);
      if (match && data === adminPasswordB && !barrierFired) {
        barrierFired = true;
        // Deterministic barrier: fire 10 failed admin OTP requests
        const failedAttempts = Array.from({ length: 10 }).map((_, i) =>
          AuthService.requestAdminOtp({
            identifier: adminIdentifier,
            password: `BadAdminPass_${i}`,
          }).catch((err) => err)
        );
        await Promise.all(failedAttempts);

        const adminDuring = await prisma.user.findUnique({ where: { id: adminIdB } });
        expect(adminDuring?.failedPasswordAttempts).toBe(10);
        expect(adminDuring?.lockedUntil).not.toBeNull();
      }
      return match;
    });

    try {
      // Execute the racing correct-password admin OTP request
      await expect(
        AuthService.requestAdminOtp({
          identifier: adminIdentifier,
          password: adminPasswordB,
        })
      ).rejects.toThrow(/Account is temporarily locked due to too many failed login attempts/i);

      // Verify invariant: admin lockout is preserved
      const adminAfter = await prisma.user.findUnique({ where: { id: adminIdB } });
      expect(adminAfter?.failedPasswordAttempts).toBe(10);
      expect(adminAfter?.lockedUntil).not.toBeNull();
      expect(adminAfter!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // Verify NO OTP and NO verification/challenge token were written for the racing request
      const tokens = await prisma.verificationToken.findMany({ where: { mobile: adminMobileB } });
      expect(tokens).toHaveLength(0);

      const otpRequests = await prisma.otpRequest.findMany({ where: { mobile: adminMobileB } });
      expect(otpRequests).toHaveLength(0);
    } finally {
      compareSpy.mockRestore();
    }
  });

  // Test C — Serialization in the opposite order:
  // If legitimate successful login obtains account row lock first, subsequent failed attempts are
  // serialized against that new state and counted correctly from 1.
  test('Test C — Serialization in opposite order: successful login resets counters, subsequent failures counted from 1', async () => {
    // Set initial failed attempts to 4
    await prisma.user.update({
      where: { id: workerIdC },
      data: { failedPasswordAttempts: 4, lockedUntil: null, activeSessionId: null },
    });

    // Legitimate successful login executes
    const sessionResult = await AuthService.login(workerMobileC, workerPasswordC);
    expect(sessionResult).toBeDefined();
    expect(sessionResult.sessionId).toBeDefined();

    // Verify counter reset to 0
    const userClean = await prisma.user.findUnique({ where: { id: workerIdC } });
    expect(userClean?.failedPasswordAttempts).toBe(0);
    expect(userClean?.lockedUntil).toBeNull();
    expect(userClean?.activeSessionId).toBe(sessionResult.sessionId);

    // Subsequent failed login attempt occurs
    await expect(
      AuthService.login(workerMobileC, 'SubsequentWrongPass!')
    ).rejects.toThrow(/Invalid mobile number or password/i);

    // Counter must be exactly 1 (not 5)
    const userAfterOneFail = await prisma.user.findUnique({ where: { id: workerIdC } });
    expect(userAfterOneFail?.failedPasswordAttempts).toBe(1);
    expect(userAfterOneFail?.lockedUntil).toBeNull();
  });

  // Test D — Lockout expiry:
  // When lockedUntil is in the past, legitimate login succeeds, resetting counters to 0 and clearing lock.
  test('Test D — Lockout expiry: expired lockout allows legitimate login and resets state', async () => {
    // Set user as locked in the past (expired 60 seconds ago)
    const pastLockedUntil = new Date(Date.now() - 60000);
    await prisma.user.update({
      where: { id: workerIdD },
      data: {
        failedPasswordAttempts: 10,
        lockedUntil: pastLockedUntil,
        activeSessionId: null,
      },
    });

    // Login with correct password after expiry
    const loginResult = await AuthService.login(workerMobileD, workerPasswordD);
    expect(loginResult).toBeDefined();
    expect(loginResult.accessToken).toBeDefined();

    // Verify state was reset upon successful authentication
    const userClean = await prisma.user.findUnique({ where: { id: workerIdD } });
    expect(userClean?.failedPasswordAttempts).toBe(0);
    expect(userClean?.lockedUntil).toBeNull();
    expect(userClean?.activeSessionId).toBe(loginResult.sessionId);
  });

  // Test E — Lockout after challenge:
  // Admin receives valid challenge & OTP, then concurrent/subsequent failed password attempts establish lockout.
  // When admin attempts verifyAdminOtp, it MUST be rejected under row lock, issuing NO session and preserving lockout.
  // Replaying the same challenge or OTP MUST fail.
  test('Test E — Lockout after challenge: subsequent failed password attempts block OTP verification and session issuance', async () => {
    // 1. Ensure test admin E is clean, active, unlocked
    await prisma.user.update({
      where: { id: adminIdE },
      data: { failedPasswordAttempts: 0, lockedUntil: null, activeSessionId: null, status: 'ACTIVE' },
    });
    await prisma.verificationToken.deleteMany({ where: { mobile: adminMobileE } });
    await prisma.otpRequest.deleteMany({ where: { mobile: adminMobileE } });
    await prisma.authSession.deleteMany({ where: { userId: adminIdE } });

    const adminIdentifier = `${config.admin.operationsAdminPrefix}${adminMobileE}`;

    // 2. Request administrator OTP with correct password
    const otpReq = await AuthService.requestAdminOtp({
      identifier: adminIdentifier,
      password: adminPasswordE,
    });
    expect(otpReq.challengeToken).toBeDefined();

    // 3. Harness setup: update OTP hash to deterministically known OTP
    const testOtp = '771122';
    const latestOtp = await prisma.otpRequest.findFirst({
      where: { mobile: adminMobileE, purpose: 'ADMIN_LOGIN', isUsed: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(latestOtp).not.toBeNull();
    await prisma.otpRequest.update({
      where: { id: latestOtp!.id },
      data: { otpHash: sha256Hash(testOtp) },
    });

    // 4. Before OTP verification, execute 10 failed password attempts to cross lockout threshold
    for (let i = 0; i < 10; i++) {
      await expect(
        AuthService.requestAdminOtp({
          identifier: adminIdentifier,
          password: `WrongPassword_${i}`,
        })
      ).rejects.toThrow();
    }

    // 5. Assert persisted account has expected failed attempts and active lockout
    const adminLocked = await prisma.user.findUnique({ where: { id: adminIdE } });
    expect(adminLocked?.failedPasswordAttempts).toBe(10);
    expect(adminLocked?.lockedUntil).not.toBeNull();
    expect(adminLocked!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // 6. Submit the previously valid OTP and challenge to verifyAdminOtp
    await expect(
      AuthService.verifyAdminOtp({
        identifier: adminIdentifier,
        otpCode: testOtp,
        challengeToken: otpReq.challengeToken,
      })
    ).rejects.toThrow(/Account is temporarily locked due to too many failed login attempts/i);

    // 7. Assert no session was created, no activeSessionId was issued
    const sessions = await prisma.authSession.findMany({ where: { userId: adminIdE } });
    expect(sessions).toHaveLength(0);

    const adminCheck = await prisma.user.findUnique({ where: { id: adminIdE } });
    expect(adminCheck?.activeSessionId).toBeNull();

    // 8. Assert lockout remains set and failed-attempt counter is NOT reset
    expect(adminCheck?.failedPasswordAttempts).toBe(10);
    expect(adminCheck?.lockedUntil).not.toBeNull();

    // 9. Assert the challenge and OTP cannot be replayed later to bypass rejection
    await expect(
      AuthService.verifyAdminOtp({
        identifier: adminIdentifier,
        otpCode: testOtp,
        challengeToken: otpReq.challengeToken,
      })
    ).rejects.toThrow();
  });

  // Test F — Opposite serialization order on verifyAdminOtp:
  test('Test F — Opposite serialization on verifyAdminOtp: successful verification resets counter, subsequent failure counted from 1', async () => {
    // 1. Reset Admin E with 4 failed attempts
    await prisma.user.update({
      where: { id: adminIdE },
      data: { failedPasswordAttempts: 4, lockedUntil: null, activeSessionId: null },
    });
    await prisma.verificationToken.deleteMany({ where: { mobile: adminMobileE } });
    await prisma.otpRequest.deleteMany({ where: { mobile: adminMobileE } });
    await prisma.authSession.deleteMany({ where: { userId: adminIdE } });

    const adminIdentifier = `${config.admin.operationsAdminPrefix}${adminMobileE}`;

    const otpReq = await AuthService.requestAdminOtp({
      identifier: adminIdentifier,
      password: adminPasswordE,
    });
    const testOtp = '882233';
    const latestOtp = await prisma.otpRequest.findFirst({
      where: { mobile: adminMobileE, purpose: 'ADMIN_LOGIN', isUsed: false },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.otpRequest.update({
      where: { id: latestOtp!.id },
      data: { otpHash: sha256Hash(testOtp) },
    });

    // Legitimate verification executes and succeeds
    const verifyRes = await AuthService.verifyAdminOtp({
      identifier: adminIdentifier,
      otpCode: testOtp,
      challengeToken: otpReq.challengeToken,
    });
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.accessToken).toBeDefined();

    // Verify counter reset to 0
    const adminClean = await prisma.user.findUnique({ where: { id: adminIdE } });
    expect(adminClean?.failedPasswordAttempts).toBe(0);
    expect(adminClean?.lockedUntil).toBeNull();
    expect(adminClean?.activeSessionId).toBe(verifyRes.sessionId);

    // Subsequent failed password attempt occurs
    await expect(
      AuthService.requestAdminOtp({
        identifier: adminIdentifier,
        password: 'SubsequentBadPassword',
      })
    ).rejects.toThrow(/Invalid login credentials/i);

    // Counter must be exactly 1
    const adminAfterOne = await prisma.user.findUnique({ where: { id: adminIdE } });
    expect(adminAfterOne?.failedPasswordAttempts).toBe(1);
    expect(adminAfterOne?.lockedUntil).toBeNull();
  });

  // Test G — Inactive / Suspended administrator account rejected:
  test('Test G — Inactive or suspended administrator rejected at verifyAdminOtp without issuing session', async () => {
    await prisma.user.update({
      where: { id: adminIdE },
      data: { failedPasswordAttempts: 0, lockedUntil: null, status: 'SUSPENDED', activeSessionId: null },
    });
    await prisma.authSession.deleteMany({ where: { userId: adminIdE } });

    const adminIdentifier = `${config.admin.operationsAdminPrefix}${adminMobileE}`;

    await expect(
      AuthService.verifyAdminOtp({
        identifier: adminIdentifier,
        otpCode: '123456',
        challengeToken: 'dummychallengetokentesting1234567890',
      })
    ).rejects.toThrow(/Administrator account is unavailable|suspended/i);

    const sessions = await prisma.authSession.findMany({ where: { userId: adminIdE } });
    expect(sessions).toHaveLength(0);

    // Restore ACTIVE status
    await prisma.user.update({
      where: { id: adminIdE },
      data: { status: 'ACTIVE' },
    });
  });

  // Test H — Role and mobile mismatch rejected at verifyAdminOtp:
  test('Test H — Role and mobile mismatch rejected at verifyAdminOtp', async () => {
    // Attempting to verify under bill admin prefix for operations admin mobile
    const wrongIdentifier = `${config.admin.billAdminPrefix}${adminMobileE}`;

    await expect(
      AuthService.verifyAdminOtp({
        identifier: wrongIdentifier,
        otpCode: '123456',
        challengeToken: 'dummychallengetokentesting1234567890',
      })
    ).rejects.toThrow();

    const sessions = await prisma.authSession.findMany({ where: { userId: adminIdE } });
    expect(sessions).toHaveLength(0);
  });
});
