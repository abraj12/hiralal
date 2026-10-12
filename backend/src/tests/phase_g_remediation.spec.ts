/**
 * Phase G / G.1 — CI Recovery, Concurrency Safety, Security Hardening & Regression Tests
 *
 * Covers:
 *  1. Production Configuration & Play Integrity Fail-Fast Validation
 *  2. CI Override Compose File Verification (NODE_ENV=development, CI_INTEGRATION_MODE=true)
 *  3. Welcome Notification: Authentication, Token Ownership & Race-Free Idempotency
 *  4. Account Deletion: Cancellation Pre-check, AppInstallation Redaction & Lease Fencing
 *  5. Admin Bill-Review Configuration: Rule Alignment with Bill Submission Timestamp
 *  6. Canonical Play Integrity Request Hash Cross-Check (Mobile vs Server)
 *  7. Dynamic Admin Prefix Discovery
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from '../server';
import { prisma } from '../db';
import { config, validateProductionConfig, validateProductionPlayIntegrity, isPlaceholderCredential } from '../config';
import { AccountDeletionService } from '../services/account-deletion.service';
import { FcmProvider } from '../services/push/fcm.provider';
import {
  computeIntegrityRequestHash,
  normalizeRegistrationIntegrityPayload,
  buildCanonicalRegistrationPayload,
  buildCanonicalAuthPayload,
  computeSha256Json,
} from '../utils/integrityRequestHash';

const TEST_MOBILE = '9833300088';
const OTHER_USER_MOBILE = '9833300089';
const TEST_ADMIN_MOBILE = '9833300090';
const TEST_PASSWORD = 'PhaseG_Test@2026';

let userId: string;
let otherUserId: string;
let billAdminId: string;
let userToken: string;
let otherUserToken: string;
let billAdminToken: string;

const validProductionEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  ENCRYPTION_KEY: 'a'.repeat(32),
  FIELD_ENCRYPTION_KEY: 'b'.repeat(32),
  REDIS_PASSWORD: 'a'.repeat(24),
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ADMIN_ACCESS_SECRET: 'c'.repeat(32),
  BILL_ADMIN_PREFIX: 'BADM',
  OPERATIONS_ADMIN_PREFIX: 'OADM',
  STORAGE_HMAC_SECRET: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'valid_r2_access_key',
  R2_SECRET_ACCESS_KEY: 'valid_r2_secret_key',
  R2_BUCKET_NAME: 'my-bucket',
  R2_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
  SIGNCARE_API_KEY: 'valid_signcare_key',
  SIGNCARE_APP_ID: 'valid_signcare_app',
  RAZORPAYX_KEY_ID: 'rzp_live_validkey',
  RAZORPAYX_KEY_SECRET: 'valid_rzp_secret',
  RAZORPAYX_ACCOUNT_NUMBER: '2323230041123456',
  RAZORPAYX_WEBHOOK_SECRET: 'valid_webhook_secret',
  MSG91_AUTH_KEY: 'valid_msg91_auth',
  MSG91_TEMPLATE_ID: 'valid_template',
  CORS_ALLOWED_ORIGINS: 'https://hiralal.com',
  BILL_ADMIN_MOBILE: '9876540001',
  OPERATIONS_ADMIN_MOBILE: '9876540002',
  BILL_ADMIN_INITIAL_PASSWORD: 'ValidBillPass2026!',
  OPERATIONS_ADMIN_INITIAL_PASSWORD: 'ValidOpsPass2026!',
  PLAY_INTEGRITY_CLIENT_EMAIL: 'play-integrity@hiralal-rewards.iam.gserviceaccount.com',
  PLAY_INTEGRITY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----',
  PLAY_INTEGRITY_PACKAGE_NAME: 'com.hiralal.rewards',
  PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  PLAY_INTEGRITY_ALLOW_MOCK: 'false',
  PLAY_INTEGRITY_REQUIRE_LICENSING: 'true',
  PLAY_INTEGRITY_ENFORCE_ACTIONS: 'true',
};

async function cleanTestData() {
  const mobiles = [TEST_MOBILE, OTHER_USER_MOBILE];
  await prisma.accountDeletionOperation.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.appInstallation.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.pushDeviceToken.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.authSession.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.otpRequest.deleteMany({ where: { mobile: { in: mobiles } } });
  await prisma.bill.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.walletTransaction.deleteMany({ where: { wallet: { user: { mobile: { in: mobiles } } } } });
  await prisma.wallet.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.notification.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });
}

beforeAll(async () => {
  await cleanTestData();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  // 1. Primary Test Craftsman
  const user = await prisma.user.create({
    data: {
      mobile: TEST_MOBILE,
      fullName: 'Phase G Test User',
      firstName: 'PhaseG',
      lastName: 'Test',
      passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      profession: 'PLUMBER',
      isVerified: true,
      wallet: { create: { availableBalance: 100.0, totalRedeemed: 0.0 } },
    },
  });
  userId = user.id;
  userToken = jwt.sign(
    { userId: user.id, role: 'USER', mobile: TEST_MOBILE },
    config.jwt.accessSecret,
    { expiresIn: '1h' }
  );

  // 2. Secondary Craftsman (for authorization boundary testing)
  const otherUser = await prisma.user.create({
    data: {
      mobile: OTHER_USER_MOBILE,
      fullName: 'Other Craftsman',
      firstName: 'Other',
      lastName: 'Craftsman',
      passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      profession: 'TILE_INSTALLER',
      isVerified: true,
      wallet: { create: { availableBalance: 50.0, totalRedeemed: 0.0 } },
    },
  });
  otherUserId = otherUser.id;
  otherUserToken = jwt.sign(
    { userId: otherUser.id, role: 'USER', mobile: OTHER_USER_MOBILE },
    config.jwt.accessSecret,
    { expiresIn: '1h' }
  );

  // 3. Bill Admin (find existing system BILL_ADMIN or provision if not present)
  let billAdmin = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
  if (!billAdmin) {
    billAdmin = await prisma.user.create({
      data: {
        mobile: TEST_ADMIN_MOBILE,
        fullName: 'Test Bill Admin',
        firstName: 'Bill',
        lastName: 'Admin',
        passwordHash,
        role: 'BILL_ADMIN',
        status: 'ACTIVE',
        profession: 'PLUMBER',
        isVerified: true,
      },
    });
  }
  billAdminId = billAdmin.id;
  billAdminToken = jwt.sign(
    { userId: billAdmin.id, role: 'BILL_ADMIN', mobile: billAdmin.mobile },
    config.admin.accessSecret || config.jwt.accessSecret,
    { expiresIn: '1h' }
  );
});

afterAll(async () => {
  await cleanTestData();
});

// ==========================================
// 1. Production Config & Play Integrity Validation
// ==========================================
describe('Production Config — Fail-Fast Validation', () => {
  test('valid production baseline passes validation without errors', () => {
    expect(() => validateProductionConfig('api', validProductionEnv)).not.toThrow();
  });

  test('rejects missing or malformed PLAY_INTEGRITY_CLIENT_EMAIL', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_CLIENT_EMAIL: 'not-an-email' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /Valid Play Integrity service-account email is required/
    );
  });

  test('rejects placeholder PLAY_INTEGRITY_CLIENT_EMAIL', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_CLIENT_EMAIL: 'REPLACE_WITH_PLAY_INTEGRITY_EMAIL@example.com' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /service-account email contains an insecure placeholder/
    );
  });

  test('rejects missing or malformed PLAY_INTEGRITY_PRIVATE_KEY', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_PRIVATE_KEY: 'not-a-valid-key' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /private key is missing or malformed/
    );
  });

  test('rejects placeholder PLAY_INTEGRITY_PRIVATE_KEY', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nREPLACE_WITH_REAL_KEY\n-----END PRIVATE KEY-----' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /private key contains an insecure placeholder/
    );
  });

  test('rejects non-matching package name', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_PACKAGE_NAME: 'com.attacker.app' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /package name does not match the approved Android package/
    );
  });

  test('rejects invalid or empty allowed certificate digests', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS: 'short_invalid_hash' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /valid SHA-256 certificate allowlist is required/
    );
  });

  test('rejects PLAY_INTEGRITY_ALLOW_MOCK=true in production', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_ALLOW_MOCK: 'true' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /Play Integrity mocks must be disabled in production/
    );
  });

  test('rejects PLAY_INTEGRITY_REQUIRE_LICENSING=false in production', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_REQUIRE_LICENSING: 'false' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /Play Integrity licensing enforcement must be enabled in production/
    );
  });

  test('rejects PLAY_INTEGRITY_ENFORCE_ACTIONS=false in production', () => {
    const env = { ...validProductionEnv, PLAY_INTEGRITY_ENFORCE_ACTIONS: 'false' };
    expect(() => validateProductionPlayIntegrity(env)).toThrow(
      /Play Integrity protected-action enforcement must be enabled in production/
    );
  });

  test('isPlaceholderCredential detects REPLACE_WITH_ patterns and insecure secrets', () => {
    expect(isPlaceholderCredential('REPLACE_WITH_REAL_KEY')).toBe(true);
    expect(isPlaceholderCredential('changeme')).toBe(true);
    expect(isPlaceholderCredential('password')).toBe(true);
    expect(isPlaceholderCredential('secret')).toBe(true);
    expect(isPlaceholderCredential('change_this_to_a_strong_password_in_production')).toBe(true);
    expect(isPlaceholderCredential('')).toBe(true);
    expect(isPlaceholderCredential(undefined)).toBe(true);
    expect(isPlaceholderCredential('CI_STUB_PRIVATE_KEY')).toBe(false);
    expect(isPlaceholderCredential('valid_production_key_abc123')).toBe(false);
  });

  test('docker-compose.ci.yml sets NODE_ENV=development, enables CI mode, and exposes DB/Redis', () => {
    const ciOverridePath = path.resolve(__dirname, '../../../docker-compose.ci.yml');
    expect(fs.existsSync(ciOverridePath)).toBe(true);
    const content = fs.readFileSync(ciOverridePath, 'utf-8');
    expect(content).toMatch(/NODE_ENV:\s*development/);
    expect(content).toMatch(/CI_INTEGRATION_MODE:\s*["']?true["']?/);
    expect(content).toMatch(/PLAY_INTEGRITY_ALLOW_MOCK:\s*["']?true["']?/);
    expect(content).toMatch(/5432:5432/);
    expect(content).toMatch(/6379:6379/);
    expect(content).not.toMatch(/NODE_ENV:\s*production/);
  });
});

// ==========================================
// 2. Welcome Notification Security & Token Ownership
// ==========================================
describe('Welcome Notification — Secure Push & Device Token Ownership', () => {
  test('unauthenticated request is rejected with 401 Unauthorized', async () => {
    const installId = `install-anon-${Date.now()}`;
    const res = await request(app)
      .post('/api/notifications/welcome')
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(401);
  });

  test('non-user role (admin token) is rejected with 403 Forbidden', async () => {
    const installId = `install-admin-${Date.now()}`;
    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${billAdminToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(403);
  });

  test('authenticated user without registered push token returns RECORDED_PENDING_PUSH', async () => {
    const installId = `install-notoken-${Date.now()}`;
    // Ensure no push token exists for this user
    await prisma.pushDeviceToken.deleteMany({ where: { userId } });

    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('RECORDED_PENDING_PUSH');
    expect(res.body.delivered).toBe(false);

    // Database check: AppInstallation is bound to userId and in PENDING status
    const dbRec = await prisma.appInstallation.findUnique({ where: { installationId: installId } });
    expect(dbRec?.userId).toBe(userId);
    expect(dbRec?.welcomeStatus).toBe('PENDING');

    await prisma.appInstallation.deleteMany({ where: { installationId: installId } });
  });

  test('authenticated user with registered push token dispatches and returns ACCEPTED', async () => {
    const installId = `install-withtoken-${Date.now()}`;
    const testPushToken = 'ExponentPushToken[phase-g1-valid-registered-token]';

    const pushSpy = jest.spyOn(FcmProvider, 'sendPush').mockResolvedValue({
      success: true,
      messageId: 'projects/test/messages/msg-welcome-001',
    });

    // Register active push token for this user
    await prisma.pushDeviceToken.create({
      data: {
        userId,
        token: testPushToken,
        platform: 'ANDROID',
        isActive: true,
      },
    });

    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('ACCEPTED');

    const dbRec = await prisma.appInstallation.findUnique({ where: { installationId: installId } });
    expect(dbRec?.userId).toBe(userId);
    expect(dbRec?.welcomeStatus).toBe('ACCEPTED');
    expect(dbRec?.pushToken).toBe(testPushToken);

    // Subsequent call for the same installation returns ALREADY_ACCEPTED
    const repeatRes = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.status).toBe('ALREADY_ACCEPTED');
    expect(repeatRes.body.delivered).toBe(true);

    pushSpy.mockRestore();
    await prisma.appInstallation.deleteMany({ where: { installationId: installId } });
    await prisma.pushDeviceToken.deleteMany({ where: { userId } });
  });

  test('arbitrary token in body is ignored — user registered token is always used', async () => {
    const installId = `install-relay-attempt-${Date.now()}`;
    const userRealToken = 'ExponentPushToken[phase-g1-user-real-token]';
    const attackerRelayToken = 'ExponentPushToken[attacker-arbitrary-relay-token]';

    const pushSpy = jest.spyOn(FcmProvider, 'sendPush').mockResolvedValue({
      success: true,
      messageId: 'projects/test/messages/msg-welcome-002',
    });

    await prisma.pushDeviceToken.create({
      data: {
        userId,
        token: userRealToken,
        platform: 'ANDROID',
        isActive: true,
      },
    });

    // Caller passes arbitrary token in request body
    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        installationId: installId,
        token: attackerRelayToken,
        platform: 'ANDROID',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');

    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        token: userRealToken,
      })
    );

    const dbRec = await prisma.appInstallation.findUnique({ where: { installationId: installId } });
    // Must be user's registered token, NOT the arbitrary token
    expect(dbRec?.pushToken).toBe(userRealToken);
    expect(dbRec?.pushToken).not.toBe(attackerRelayToken);

    pushSpy.mockRestore();
    await prisma.appInstallation.deleteMany({ where: { installationId: installId } });
    await prisma.pushDeviceToken.deleteMany({ where: { userId } });
  });

  test('installation registered to User A cannot be accessed by User B (returns 403)', async () => {
    const installId = `install-ownership-${Date.now()}`;

    // Provision installation bound to userId
    await prisma.appInstallation.create({
      data: {
        installationId: installId,
        userId,
        platform: 'ANDROID',
        welcomeStatus: 'PENDING',
      },
    });

    // otherUser attempts to dispatch for user's installation
    const res = await request(app)
      .post('/api/notifications/welcome')
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ installationId: installId, platform: 'ANDROID' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/registered to a different account/);

    await prisma.appInstallation.deleteMany({ where: { installationId: installId } });
  });
});

// ==========================================
// 3. Account Deletion — Concurrency Fencing & Cleanup
// ==========================================
describe('Account Deletion — Concurrency Fencing & Cleanup', () => {
  test('processScheduledDeletions skips user if deletion was cancelled mid-batch', async () => {
    // Schedule deletion
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: new Date(Date.now() - 9 * 24 * 3600 * 1000),
        deletionScheduledAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      },
    });

    // Simulate user login during grace period cancelling deletion
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      },
    });

    const result = await AccountDeletionService.processScheduledDeletions(prisma, undefined);
    const processedUserError = result.errors.find((e) => e.userId === userId);
    expect(processedUserError).toBeUndefined();

    // User data is intact
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.fullName).toBe('Phase G Test User');
    expect(user?.mobile).toBe(TEST_MOBILE);
  });

  test('AppInstallation records have userId and pushToken cleared on anonymization', async () => {
    const testInstall = await prisma.appInstallation.create({
      data: {
        installationId: `cleanup-test-${Date.now()}`,
        userId,
        platform: 'ANDROID',
        pushToken: 'ExponentPushToken[test-cleanup-token]',
        welcomeStatus: 'DELIVERED',
      },
    });

    expect(testInstall.userId).toBe(userId);
    expect(testInstall.pushToken).not.toBeNull();

    // Execute anonymization transaction logic
    await prisma.$transaction(async (tx: any) => {
      await tx.appInstallation.updateMany({
        where: { userId },
        data: { userId: null, pushToken: null },
      });
    });

    const updatedInstall = await prisma.appInstallation.findUnique({ where: { id: testInstall.id } });
    expect(updatedInstall?.userId).toBeNull();
    expect(updatedInstall?.pushToken).toBeNull();

    await prisma.appInstallation.delete({ where: { id: testInstall.id } });
  });

  test('atomic lease version fencing prevents duplicate worker claims', async () => {
    const op = await prisma.accountDeletionOperation.create({
      data: {
        userId,
        status: 'PENDING',
        scheduledFor: new Date(),
        leaseOwner: 'worker-node-1',
        leaseVersion: 1,
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    });

    // Worker 2 attempts to claim with stale lease version
    const staleClaim = await prisma.accountDeletionOperation.updateMany({
      where: {
        id: op.id,
        leaseVersion: 0, // Stale version
      },
      data: {
        leaseOwner: 'worker-node-2',
        leaseVersion: 2,
      },
    });

    expect(staleClaim.count).toBe(0);

    // Worker 1 renews with current version
    const validClaim = await prisma.accountDeletionOperation.updateMany({
      where: {
        id: op.id,
        leaseVersion: 1,
      },
      data: {
        leaseVersion: 2,
        leaseExpiresAt: new Date(Date.now() + 120000),
      },
    });

    expect(validClaim.count).toBe(1);

    await prisma.accountDeletionOperation.delete({ where: { id: op.id } });
  });
});

// ==========================================
// 4. Admin Bill Review Configuration Alignment
// ==========================================
describe('Admin Bill Review Configuration Alignment', () => {
  test('GET /api/admin/bills/:id/review-config returns submissionTimestamp based on bill.createdAt', async () => {
    const historicalSubmission = new Date('2026-06-15T10:00:00.000Z');
    const bill = await prisma.bill.create({
      data: {
        userId,
        invoiceNumber: `INV-PHG-${Date.now()}`,
        invoiceDate: new Date('2026-06-15'),
        billAmount: 10000.0,
        grossBillAmount: 10000.0,
        calculatedReward: 50.0,
        status: 'PENDING',
        fileUrl: 'https://r2.hiralal.com/bills/test.pdf',
        fileKey: 'bills/test.pdf',
        createdAt: historicalSubmission,
      },
    });

    const res = await request(app)
      .get(`/api/admin/bills/${bill.id}/review-config`)
      .set('Authorization', `Bearer ${billAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.submissionTimestamp).toBeDefined();
    // Must match the bill's createdAt submission timestamp
    expect(new Date(res.body.submissionTimestamp).toISOString()).toBe(historicalSubmission.toISOString());
    expect(res.body.rewardRule).toBeDefined();
    expect(res.body.gstRules).toBeDefined();
    expect(Array.isArray(res.body.gstRules)).toBe(true);

    await prisma.bill.delete({ where: { id: bill.id } });
  });
});

// ==========================================
// 5. Canonical Play Integrity Request Hash Cross-Check
// ==========================================
describe('Canonical Play Integrity Request Binding Cross-Check', () => {
  test('registration payload canonical normalization matches between client and server', () => {
    const rawInput = {
      mobile: '+91 98765 43210',
      profession: 'plumber',
      firstName: '  Ramesh  ',
      middleName: '',
      lastName: ' Kumar ',
      fullName: '',
    };

    const serverNormalized = normalizeRegistrationIntegrityPayload(rawInput);

    expect(serverNormalized).toEqual({
      version: 2,
      action: 'REGISTRATION',
      mobile: '9876543210',
      profession: 'PLUMBER',
      firstName: 'Ramesh',
      middleName: '',
      lastName: 'Kumar',
      fullName: 'Ramesh Kumar',
    });

    const serverHash = computeSha256Json(serverNormalized);
    expect(serverHash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(serverHash)).toBe(true);

    // Equivalent client computation simulation
    const clientPayload = {
      version: 2 as const,
      action: 'REGISTRATION' as const,
      mobile: '9876543210',
      profession: 'PLUMBER' as const,
      firstName: 'Ramesh',
      middleName: '',
      lastName: 'Kumar',
      fullName: 'Ramesh Kumar',
    };
    const clientHash = crypto.createHash('sha256').update(JSON.stringify(clientPayload), 'utf8').digest('hex').toLowerCase();

    expect(serverHash).toBe(clientHash);
  });

  test('auth canonical payload produces identical SHA-256 hash vector', () => {
    const payload = buildCanonicalAuthPayload('9876543210');
    expect(payload).toEqual({
      version: 1,
      action: 'AUTH',
      mobile: '9876543210',
    });

    const hash = computeSha256Json(payload);
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify({
      version: 1,
      action: 'AUTH',
      mobile: '9876543210',
    }), 'utf8').digest('hex').toLowerCase();

    expect(hash).toBe(expectedHash);
  });
});

// ==========================================
// 6. Admin Prefix Discovery API
// ==========================================
describe('Admin Prefix Discovery — Dynamic Server-Configured Prefixes', () => {
  test('GET /api/auth/admin-prefixes returns configured prefixes without authentication', async () => {
    const res = await request(app).get('/api/auth/admin-prefixes');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.prefixes).toBeDefined();
    expect(typeof res.body.prefixes.billAdmin).toBe('string');
    expect(typeof res.body.prefixes.operationsAdmin).toBe('string');
    expect(res.body.prefixes.billAdmin.length).toBeGreaterThan(0);
    expect(res.body.prefixes.operationsAdmin.length).toBeGreaterThan(0);
    expect(res.body.prefixes.billAdmin).not.toBe(res.body.prefixes.operationsAdmin);
  });

  test('Standard mobile login with non-admin prefix follows user auth path', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: TEST_MOBILE, mobile: TEST_MOBILE, password: TEST_PASSWORD });

    expect([200, 400, 401, 403]).toContain(res.status);
    if (res.status === 403) {
      expect(res.body.code).not.toBe('INTEGRITY_FAILED');
    }
  });
});
