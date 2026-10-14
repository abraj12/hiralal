import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../server';
import { prisma } from '../db';
import { closeRedis } from '../redis';
import { PlayIntegrityService } from '../services/integrity/playIntegrity.service';
import { config } from '../config';
import {
  buildCanonicalBillUploadPayload,
  buildCanonicalKycSubmitPayload,
  buildCanonicalPayoutRedeemPayload,
  computeSha256Bytes,
  computeSha256Json,
} from '../utils/integrityRequestHash';

describe('Server-Side Play Integrity Action Enforcement & Bypass Prevention', () => {
  let userToken: string;
  let otherUserToken: string;
  let testUserId: string;
  let otherUserId: string;
  let userSessionId: string;

  const createDummyPdf = (seed: string = '') =>
    Buffer.from(
      `%PDF-1.4\n%${seed}-${Date.now()}-${Math.random()}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources <<>> >>\nendobj\nxref\n0 4\n' +
        '0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
        'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF'
    );
  const validDummyPdf = createDummyPdf('default');

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password@123', 10);

    // 1. Create primary test user
    const user = await prisma.user.upsert({
      where: { mobile: '9888877771' },
      update: { passwordHash },
      create: {
        mobile: '9888877771',
        passwordHash,
        fullName: 'Integrity Test Craftsman',
        profession: 'PLUMBER',
        status: 'ACTIVE',
      },
    });
    testUserId = user.id;

    // Ensure wallet exists for primary user
    await prisma.wallet.upsert({
      where: { userId: user.id },
      update: { availableBalance: 5000 },
      create: { userId: user.id, availableBalance: 5000, processingAmount: 0, totalRedeemed: 0 },
    });

    // 2. Create secondary test user for cross-user bypass tests
    const otherUser = await prisma.user.upsert({
      where: { mobile: '9888877772' },
      update: { passwordHash },
      create: {
        mobile: '9888877772',
        passwordHash,
        fullName: 'Other Craftsman',
        profession: 'TILE_INSTALLER',
        status: 'ACTIVE',
      },
    });
    otherUserId = otherUser.id;

    // Login primary user
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: '9888877771', password: 'Password@123' });
    userToken = loginRes.body.token;
    const dbUser = await prisma.user.findUnique({ where: { id: testUserId } });
    userSessionId = loginRes.body.sessionId || dbUser?.activeSessionId || '';

    // Login secondary user
    const otherLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: '9888877772', password: 'Password@123' });
    otherUserToken = otherLoginRes.body.token;

    // Clean up any residual bills and KYC records from previous runs
    await prisma.bill.deleteMany({
      where: { userId: { in: [testUserId, otherUserId] } },
    });
    await prisma.kycRecord.deleteMany({
      where: { userId: { in: [testUserId, otherUserId] } },
    });
  });

  beforeEach(() => {
    // Enable action enforcement and test mock mode
    PlayIntegrityService.setEnforceActions(true);
    PlayIntegrityService.overrideConfig({ allowMock: true });
    PlayIntegrityService.setFetchClient(null);
  });

  afterEach(() => {
    PlayIntegrityService.setEnforceActions(false);
    PlayIntegrityService.overrideConfig(null);
  });

  afterAll(async () => {
    PlayIntegrityService.setEnforceActions(false);
    PlayIntegrityService.overrideConfig(null);
    try {
      await prisma.bill.deleteMany({
        where: { userId: { in: [testUserId, otherUserId] } },
      });
      await prisma.kycRecord.deleteMany({
        where: { userId: { in: [testUserId, otherUserId] } },
      });
    } catch {}
    await prisma.$disconnect();
    await closeRedis();
  });

  // =========================================================================
  // 1. Bill Upload Integrity Enforcement (POST /api/bills)
  // =========================================================================
  describe('1. Bill Upload Protection (POST /api/bills)', () => {
    it('rejects direct API calls without integrity headers (Bypass Attempt)', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .field('invoiceNumber', `INV-NOINT-${Date.now()}`)
        .field('invoiceDate', '2026-10-05')
        .field('billAmount', '2500.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_REQUIRED');
      expect(res.body.message).toContain('Device integrity attestation is required');
    });

    it('rejects direct API calls with empty or whitespace integrity headers', async () => {
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', '   ')
        .set('x-integrity-nonce', '')
        .field('invoiceNumber', `INV-EMPTYINT-${Date.now()}`)
        .field('invoiceDate', '2026-10-05')
        .field('billAmount', '2500.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_REQUIRED');
    });

    it('rejects attestation when nonce was issued for a different action (Mismatched Action)', async () => {
      // Nonce issued specifically for PAYOUT_REDEEM
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'PAYOUT_REDEEM',
        userId: testUserId,
      });

      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .field('invoiceNumber', `INV-WRONGACT-${Date.now()}`)
        .field('invoiceDate', '2026-10-05')
        .field('billAmount', '2500.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('Integrity nonce was issued for action PAYOUT_REDEEM, but presented for BILL_UPLOAD');
    });

    it('rejects attestation when nonce was issued for a different user (Cross-User Theft Attempt)', async () => {
      // Nonce issued for otherUser
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: otherUserId,
      });

      // Presented by primary user
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .field('invoiceNumber', `INV-WRONGUSER-${Date.now()}`)
        .field('invoiceDate', '2026-10-05')
        .field('billAmount', '2500.00')
        .attach('invoiceFile', validDummyPdf, 'invoice.pdf');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('Integrity nonce was issued for a different user');
    });

    it('rejects replay of previously consumed nonce on bill upload', async () => {
      const invNum1 = `INV-FIRST-${Date.now()}`;
      const invDate = '2026-10-05';
      const billAmt = '1000.00';
      const fileBuf1 = createDummyPdf('first');
      const fileSha256_1 = computeSha256Bytes(fileBuf1);
      const payload1 = buildCanonicalBillUploadPayload(invNum1, invDate, billAmt, undefined, fileSha256_1);
      const reqHash1 = computeSha256Json(payload1);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash1,
      });

      // Legitimate first upload consumes nonce
      const res1 = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .field('invoiceNumber', invNum1)
        .field('invoiceDate', invDate)
        .field('billAmount', billAmt)
        .attach('invoiceFile', fileBuf1, 'invoice.pdf');

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);

      // Replay attempt with same nonce MUST be rejected
      const invNum2 = `INV-REPLAY-${Date.now()}`;
      const fileBuf2 = createDummyPdf('replay');
      const res2 = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .field('invoiceNumber', invNum2)
        .field('invoiceDate', invDate)
        .field('billAmount', billAmt)
        .attach('invoiceFile', fileBuf2, 'invoice.pdf');

      expect(res2.status).toBe(403);
      expect(res2.body.success).toBe(false);
      expect(res2.body.code).toBe('INTEGRITY_FAILED');
      expect(res2.body.message).toContain('Invalid, expired, or replayed');
    });

    it('accepts legitimate bill upload when action-bound attestation is valid', async () => {
      const invNum = `INV-LEGIT-${Date.now()}`;
      const invDate = '2026-10-05';
      const billAmt = '1500.00';
      const fileBuf = createDummyPdf('legit');
      const fileSha256 = computeSha256Bytes(fileBuf);
      const payload = buildCanonicalBillUploadPayload(invNum, invDate, billAmt, undefined, fileSha256);
      const reqHash = computeSha256Json(payload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash,
      });

      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .field('invoiceNumber', invNum)
        .field('invoiceDate', invDate)
        .field('billAmount', billAmt)
        .attach('invoiceFile', fileBuf, 'invoice.pdf');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.bill.invoiceNumber).toBe(invNum);
    });

    it('strictly rejects bill upload when request payload is tampered after nonce generation', async () => {
      const invNum = `INV-TAMPER-${Date.now()}`;
      const invDate = '2026-10-05';
      const billAmt = '1500.00';
      const fileBuf = createDummyPdf('legit');
      const fileSha256 = computeSha256Bytes(fileBuf);
      const payload = buildCanonicalBillUploadPayload(invNum, invDate, billAmt, undefined, fileSha256);
      const reqHash = computeSha256Json(payload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash,
      });

      // Tamper: post a different bill amount than was bound into requestHash
      const res = await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .field('invoiceNumber', invNum)
        .field('invoiceDate', invDate)
        .field('billAmount', '9999.00')
        .attach('invoiceFile', fileBuf, 'invoice.pdf');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('requestHash mismatch');
    });
  });

  // =========================================================================
  // 2. Payout Redemption Protection (POST /api/payouts/redeem)
  // =========================================================================
  describe('2. Payout Redemption Protection (POST /api/payouts/redeem)', () => {
    it('rejects direct redemption calls without integrity headers (Bypass Attempt)', async () => {
      const res = await request(app)
        .post('/api/payouts/redeem')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ idempotencyKey: `redeem_direct_bypass_${Date.now()}` });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_REQUIRED');
      expect(res.body.message).toContain('Device integrity attestation is required');
    });

    it('rejects redemption when nonce was issued for BILL_UPLOAD', async () => {
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: computeSha256Json({ test: 'dummy' }),
      });

      const res = await request(app)
        .post('/api/payouts/redeem')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({ idempotencyKey: `redeem_wrong_action_${Date.now()}` });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('Integrity nonce was issued for action BILL_UPLOAD, but presented for PAYOUT_REDEEM');
    });

    it('processes redemption verification when action-bound attestation is valid', async () => {
      const idempotencyKey = `redeem_legit_key_${Date.now()}`;
      const payload = buildCanonicalPayoutRedeemPayload(idempotencyKey);
      const reqHash = computeSha256Json(payload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'PAYOUT_REDEEM',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash,
      });

      const res = await request(app)
        .post('/api/payouts/redeem')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({ idempotencyKey });

      // If redemption conditions (KYC or bank account or window) fail, it returns 400 with business error,
      // NOT 403 INTEGRITY_REQUIRED or INTEGRITY_FAILED! That proves integrity attestation passed!
      expect(res.status).not.toBe(403);
    });

    it('strictly rejects redemption when idempotencyKey is tampered after nonce generation', async () => {
      const idempotencyKey = `redeem_legit_key_${Date.now()}`;
      const payload = buildCanonicalPayoutRedeemPayload(idempotencyKey);
      const reqHash = computeSha256Json(payload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'PAYOUT_REDEEM',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash,
      });

      // Tamper: present different idempotencyKey than was hashed
      const res = await request(app)
        .post('/api/payouts/redeem')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({ idempotencyKey: `tampered_key_${Date.now()}` });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('requestHash mismatch');
    });
  });

  // =========================================================================
  // 3. KYC Submission Protection (POST /api/kyc/pan/verify)
  // =========================================================================
  describe('3. KYC PAN Verification Protection (POST /api/kyc/pan/verify)', () => {
    it('rejects direct KYC submission without integrity headers (Bypass Attempt)', async () => {
      const res = await request(app)
        .post('/api/kyc/pan/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          panNumber: 'ABCDE1234F',
          panName: 'Test Craftsman',
          consent: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_REQUIRED');
    });

    it('rejects KYC submission when nonce was issued for BILL_UPLOAD', async () => {
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: computeSha256Json({ test: 'dummy' }),
      });

      const res = await request(app)
        .post('/api/kyc/pan/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({
          panNumber: 'INTGR1234F',
          panName: 'Test Craftsman',
          consent: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('Integrity nonce was issued for action BILL_UPLOAD, but presented for KYC_SUBMIT');
    });

    it('accepts KYC submission when action-bound attestation is valid', async () => {
      const panNumber = 'INTGR1234F';
      const panName = 'Test Craftsman';
      const consent = true;
      const consentText = 'I provide consent to verify my PAN identity for rewards payout compliance.';
      const payload = buildCanonicalKycSubmitPayload(panNumber, panName, consent, consentText);
      const reqHash = computeSha256Json(payload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'KYC_SUBMIT',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash,
      });

      const res = await request(app)
        .post('/api/kyc/pan/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({
          panNumber,
          panName,
          consent,
          consentText,
        });

      // Integrity verification succeeded (returns 200 or business status, not 403)
      expect(res.status).not.toBe(403);
    });

    it('strictly rejects KYC submission when request payload is tampered after nonce generation', async () => {
      const panNumber = 'INTGR1234F';
      const panName = 'Test Craftsman';
      const consent = true;
      const consentText = 'I provide consent to verify my PAN identity for rewards payout compliance.';
      const payload = buildCanonicalKycSubmitPayload(panNumber, panName, consent, consentText);
      const reqHash = computeSha256Json(payload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'KYC_SUBMIT',
        userId: testUserId,
        sessionId: userSessionId,
        requestHash: reqHash,
      });

      // Tamper: send a different PAN number
      const res = await request(app)
        .post('/api/kyc/pan/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({
          panNumber: 'XXXXX9999Y',
          panName,
          consent,
          consentText,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toContain('requestHash mismatch');
    });
  });

  describe('Pre-Auth Play Integrity Enforcement on Worker Password Recovery Routes', () => {
    const recoverySalt = 'c1c2c3c4d5d6d7d8e9e0e1e2f3f4f5f6';
    const testWorkerMobile = '9888877771';

    it('rejects /password-reset/request when integrity token is missing', async () => {
      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ mobile: testWorkerMobile, integrityRequestSalt: recoverySalt });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INTEGRITY_REQUIRED');
    });

    it('rejects /password-reset/request when integrity nonce is missing', async () => {
      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .set('x-integrity-token', 'valid_mock_token')
        .send({ mobile: testWorkerMobile, integrityRequestSalt: recoverySalt });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INTEGRITY_REQUIRED');
    });

    it('rejects /password-reset/request when integrityRequestSalt is missing or invalid', async () => {
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'FORGOT_PASSWORD_REQUEST',
        requestHash: 'a'.repeat(64),
      });

      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .send({ mobile: testWorkerMobile });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
      expect(res.body.message).toBe('Device integrity request validation failed.');
    });

    it('rejects /password-reset/request when body salt conflicts with header salt', async () => {
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'FORGOT_PASSWORD_REQUEST',
        requestHash: 'a'.repeat(64),
      });

      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .set('x-integrity-request-salt', '00000000000000000000000000000000')
        .send({ mobile: testWorkerMobile, integrityRequestSalt: recoverySalt });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INTEGRITY_FAILED');
    });

    it('accepts valid pre-auth attestation and reaches business handler on /password-reset/request', async () => {
      const canonicalPayload = {
        version: 2,
        action: 'FORGOT_PASSWORD_REQUEST',
        mobile: testWorkerMobile,
        integrityRequestSalt: recoverySalt,
      };
      const reqHash = computeSha256Json(canonicalPayload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'FORGOT_PASSWORD_REQUEST',
        requestHash: reqHash,
      });

      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .set('x-integrity-request-salt', recoverySalt)
        .send({ mobile: testWorkerMobile, integrityRequestSalt: recoverySalt });

      // Verification passed through integrity middleware
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects replayed nonce on /password-reset/request', async () => {
      const canonicalPayload = {
        version: 2,
        action: 'FORGOT_PASSWORD_REQUEST',
        mobile: testWorkerMobile,
        integrityRequestSalt: recoverySalt,
      };
      const reqHash = computeSha256Json(canonicalPayload);

      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'FORGOT_PASSWORD_REQUEST',
        requestHash: reqHash,
      });

      const firstRes = await request(app)
        .post('/api/auth/password-reset/request')
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .set('x-integrity-request-salt', recoverySalt)
        .send({ mobile: testWorkerMobile, integrityRequestSalt: recoverySalt });

      expect(firstRes.status).toBe(200);

      // Replay attempt with same nonce
      const secondRes = await request(app)
        .post('/api/auth/password-reset/request')
        .set('x-integrity-token', 'valid_mock_token')
        .set('x-integrity-nonce', nonceObj.nonce)
        .set('x-integrity-request-salt', recoverySalt)
        .send({ mobile: testWorkerMobile, integrityRequestSalt: recoverySalt });

      expect(secondRes.status).toBe(403);
      expect(secondRes.body.code).toBe('INTEGRITY_FAILED');
    });

    it('strictly enforces integrity on /password-reset/verify and /password-reset/complete', async () => {
      // 1. Verify missing token
      const verifyRes = await request(app)
        .post('/api/auth/password-reset/verify')
        .send({ mobile: testWorkerMobile, otpCode: '123456', integrityRequestSalt: recoverySalt });
      expect(verifyRes.status).toBe(403);
      expect(verifyRes.body.code).toBe('INTEGRITY_REQUIRED');

      // 2. Complete missing token
      const completeRes = await request(app)
        .post('/api/auth/password-reset/complete')
        .send({
          mobile: testWorkerMobile,
          verificationToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          newPassword: 'ValidPassword@123',
          integrityRequestSalt: recoverySalt,
        });
      expect(completeRes.status).toBe(403);
      expect(completeRes.body.code).toBe('INTEGRITY_REQUIRED');
    });
  });
});
