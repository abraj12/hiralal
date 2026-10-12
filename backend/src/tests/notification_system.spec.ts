import request from 'supertest';
import { app } from '../server';
import { prisma } from '../db';
import { BillService } from '../services/bill.service';
import { checkRedisConnection, closeRedis } from '../redis';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import crypto from 'crypto';
import { PlayIntegrityService } from '../services/integrity/playIntegrity.service';

describe('Task L & N — Notification System, In-App Center, Operations Broadcast & Play Integrity Tests', () => {
  const plumberMobile = '9822200001';
  const tileWorkerMobile = '9822200002';
  const opsAdminMobile = '9822200003';
  const billAdminMobile = '9822200004';

  let plumberUser: any;
  let tileWorkerUser: any;
  let opsAdminUser: any;
  let billAdminUser: any;

  let plumberToken: string;
  let tileWorkerToken: string;
  let opsAdminToken: string;
  let billAdminToken: string;

  beforeAll(async () => {
    await checkRedisConnection();

    // Cleanup existing test records
    await prisma.notification.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.pushDeviceToken.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.notificationCampaign.deleteMany({
      where: { createdByAdmin: { mobile: { in: [opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile] } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile] } } },
    });
    await prisma.authSession.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } },
    });

    // Create Plumber
    const plumberSessionId = crypto.randomUUID();
    plumberUser = await prisma.user.create({
      data: {
        mobile: plumberMobile,
        fullName: 'Mahesh Plumber',
        passwordHash: 'hashed_password',
        profession: 'PLUMBER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        activeSessionId: plumberSessionId,
      },
    });
    await prisma.wallet.create({ data: { userId: plumberUser.id, availableBalance: 1000 } });
    await prisma.authSession.create({
      data: {
        userId: plumberUser.id,
        sessionId: plumberSessionId,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    plumberToken = jwt.sign(
      { userId: plumberUser.id, role: 'USER', mobile: plumberMobile, sessionId: plumberSessionId },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Create Tile Worker
    const tileSessionId = crypto.randomUUID();
    tileWorkerUser = await prisma.user.create({
      data: {
        mobile: tileWorkerMobile,
        fullName: 'Suresh Tile Worker',
        passwordHash: 'hashed_password',
        profession: 'TILE_INSTALLER',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
        activeSessionId: tileSessionId,
      },
    });
    await prisma.wallet.create({ data: { userId: tileWorkerUser.id, availableBalance: 500 } });
    await prisma.authSession.create({
      data: {
        userId: tileWorkerUser.id,
        sessionId: tileSessionId,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    tileWorkerToken = jwt.sign(
      { userId: tileWorkerUser.id, role: 'USER', mobile: tileWorkerMobile, sessionId: tileSessionId },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Find or create Operations Admin
    const opsSessionId = crypto.randomUUID();
    const existingOps = await prisma.user.findFirst({ where: { role: 'OPERATIONS_ADMIN' } });
    if (existingOps) {
      opsAdminUser = existingOps;
      await prisma.user.update({
        where: { id: opsAdminUser.id },
        data: { activeSessionId: opsSessionId, status: 'ACTIVE' },
      });
    } else {
      opsAdminUser = await prisma.user.create({
        data: {
          mobile: opsAdminMobile,
          fullName: 'Operations Admin User',
          passwordHash: 'hashed_password',
          role: 'OPERATIONS_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
          activeSessionId: opsSessionId,
        },
      });
    }
    await prisma.authSession.create({
      data: {
        userId: opsAdminUser.id,
        sessionId: opsSessionId,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    opsAdminToken = jwt.sign(
      { userId: opsAdminUser.id, role: 'OPERATIONS_ADMIN', mobile: opsAdminUser.mobile, sessionId: opsSessionId },
      config.admin.accessSecret,
      { expiresIn: '1h' }
    );

    // Find or create Bill Admin
    const billSessionId = crypto.randomUUID();
    const existingBill = await prisma.user.findFirst({ where: { role: 'BILL_ADMIN' } });
    if (existingBill) {
      billAdminUser = existingBill;
      await prisma.user.update({
        where: { id: billAdminUser.id },
        data: { activeSessionId: billSessionId, status: 'ACTIVE' },
      });
    } else {
      billAdminUser = await prisma.user.create({
        data: {
          mobile: billAdminMobile,
          fullName: 'Bill Admin User',
          passwordHash: 'hashed_password',
          role: 'BILL_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
          activeSessionId: billSessionId,
        },
      });
    }
    await prisma.authSession.create({
      data: {
        userId: billAdminUser.id,
        sessionId: billSessionId,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    billAdminToken = jwt.sign(
      { userId: billAdminUser.id, role: 'BILL_ADMIN', mobile: billAdminUser.mobile, sessionId: billSessionId },
      config.admin.accessSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.pushDeviceToken.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.notificationCampaign.deleteMany({
      where: { createdByAdmin: { mobile: { in: [opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.bill.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile] } } },
    });
    await prisma.wallet.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile] } } },
    });
    await prisma.authSession.deleteMany({
      where: { user: { mobile: { in: [plumberMobile, tileWorkerMobile, opsAdminMobile, billAdminMobile] } } },
    });
    await prisma.user.deleteMany({
      where: { mobile: { in: [plumberMobile, tileWorkerMobile] } },
    });
    await prisma.$disconnect();
    await closeRedis();
  });

  describe('1. Push Device Token Registration & Management', () => {
    const testFcmToken = 'fcm_sample_device_token_xyz_1234567890';

    test('User can register FCM device push token', async () => {
      const res = await request(app)
        .post('/api/notifications/device-token')
        .set('Authorization', `Bearer ${plumberToken}`)
        .send({ token: testFcmToken, platform: 'ANDROID' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.deviceToken.token).toBe(testFcmToken);
      expect(res.body.deviceToken.platform).toBe('ANDROID');
      expect(res.body.deviceToken.isActive).toBe(true);

      const dbToken = await prisma.pushDeviceToken.findUnique({ where: { token: testFcmToken } });
      expect(dbToken).not.toBeNull();
      expect(dbToken?.userId).toBe(plumberUser.id);
    });

    test('Registering same token updates lastUsedAt and keeps isActive true (idempotent upsert)', async () => {
      const res = await request(app)
        .post('/api/notifications/device-token')
        .set('Authorization', `Bearer ${plumberToken}`)
        .send({ token: testFcmToken, platform: 'ANDROID' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('User can deactivate device token on logout', async () => {
      const res = await request(app)
        .delete(`/api/notifications/device-token/${encodeURIComponent(testFcmToken)}`)
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbToken = await prisma.pushDeviceToken.findUnique({ where: { token: testFcmToken } });
      expect(dbToken?.isActive).toBe(false);
    });
  });

  describe('2. User In-App Notifications & Ownership Protection', () => {
    let createdNotificationId: string;

    beforeAll(async () => {
      // Seed notifications for plumber
      const n1 = await prisma.notification.create({
        data: {
          userId: plumberUser.id,
          title: 'Welcome to Hiralal Rewards',
          message: 'Start scanning and uploading bills to earn cashback points!',
          type: 'WELCOME',
          isRead: false,
        },
      });
      createdNotificationId = n1.id;

      await prisma.notification.create({
        data: {
          userId: plumberUser.id,
          title: 'Special Diwali Bonus',
          message: 'Get extra 1% rewards this week on all verified invoices.',
          type: 'OFFER',
          isRead: false,
        },
      });
    });

    test('User can fetch paginated notifications and unread count', async () => {
      const res = await request(app)
        .get('/api/notifications?page=1&limit=10')
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.notifications.length).toBeGreaterThanOrEqual(2);
      expect(res.body.unreadCount).toBeGreaterThanOrEqual(2);
      expect(res.body.pagination).toBeDefined();
    });

    test('User can fetch unread count fast indicator', async () => {
      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.unreadCount).toBe('number');
      expect(res.body.unreadCount).toBeGreaterThanOrEqual(2);
    });

    test('User A cannot mark User B notification as read (Cross-user ownership protection)', async () => {
      // Tile worker attempts to mark Plumber notification as read
      const res = await request(app)
        .patch(`/api/notifications/${createdNotificationId}/read`)
        .set('Authorization', `Bearer ${tileWorkerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      // Verify still unread in database
      const notif = await prisma.notification.findUnique({ where: { id: createdNotificationId } });
      expect(notif?.isRead).toBe(false);
      expect(notif?.readAt).toBeNull();
    });

    test('Owner user can mark notification as read and readAt is stamped', async () => {
      const res = await request(app)
        .patch(`/api/notifications/${createdNotificationId}/read`)
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.notification.isRead).toBe(true);
      expect(res.body.notification.readAt).toBeDefined();

      const dbNotif = await prisma.notification.findUnique({ where: { id: createdNotificationId } });
      expect(dbNotif?.isRead).toBe(true);
      expect(dbNotif?.readAt).not.toBeNull();
    });

    test('User can mark all notifications as read', async () => {
      const res = await request(app)
        .patch('/api/notifications/read-all')
        .set('Authorization', `Bearer ${plumberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const unread = await prisma.notification.count({
        where: { userId: plumberUser.id, isRead: false },
      });
      expect(unread).toBe(0);
    });
  });

  describe('3. Operations Admin Broadcast & Role Authorization', () => {
    test('BILL_ADMIN receives 403 Forbidden when attempting broadcast', async () => {
      const res = await request(app)
        .post('/api/admin/notifications/broadcast')
        .set('Authorization', `Bearer ${billAdminToken}`)
        .send({
          title: 'Unauthorized Broadcast',
          message: 'This should fail because Bill Admin cannot broadcast.',
          targetAudience: 'ALL',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test('OPERATIONS_ADMIN can broadcast notification to specific profession (PLUMBER)', async () => {
      const broadcastTitle = 'Special Plumber Scheme 2026';
      const broadcastMessage = 'New brass fitting bonuses are now active!';
      const idempotencyKey = `idem_broadcast_${Date.now()}`;

      const res = await request(app)
        .post('/api/admin/notifications/broadcast')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          title: broadcastTitle,
          message: broadcastMessage,
          targetAudience: 'PLUMBER',
          idempotencyKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.campaign).toBeDefined();
      expect(res.body.campaign.targetAudience).toBe('PLUMBER');
      expect(res.body.campaign.recipientCount).toBeGreaterThanOrEqual(1);

      // Verify Plumber received it
      const plumberNotif = await prisma.notification.findFirst({
        where: { userId: plumberUser.id, title: broadcastTitle },
      });
      expect(plumberNotif).not.toBeNull();

      // Verify Tile Worker did NOT receive it
      const tileNotif = await prisma.notification.findFirst({
        where: { userId: tileWorkerUser.id, title: broadcastTitle },
      });
      expect(tileNotif).toBeNull();
    });

    test('Broadcast idempotency: replaying same idempotencyKey returns existing campaign without duplicating', async () => {
      const fixedIdempotencyKey = 'idempotent_test_campaign_key_999';

      const res1 = await request(app)
        .post('/api/admin/notifications/broadcast')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          title: 'Idempotent Announcement',
          message: 'Testing single execution.',
          targetAudience: 'ALL',
          idempotencyKey: fixedIdempotencyKey,
        });

      expect(res1.status).toBe(201);

      const countBefore = await prisma.notification.count({
        where: { title: 'Idempotent Announcement' },
      });

      // Repeat request with exact same idempotencyKey
      const res2 = await request(app)
        .post('/api/admin/notifications/broadcast')
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          title: 'Idempotent Announcement',
          message: 'Testing single execution.',
          targetAudience: 'ALL',
          idempotencyKey: fixedIdempotencyKey,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.campaign.id).toBe(res1.body.campaign.id);

      const countAfter = await prisma.notification.count({
        where: { title: 'Idempotent Announcement' },
      });
      expect(countAfter).toBe(countBefore); // No duplicates created
    });

    test('OPERATIONS_ADMIN can send direct notification to specific user', async () => {
      const directTitle = 'KYC Documents Notice';
      const directMessage = 'Please submit your PAN card copy.';

      const res = await request(app)
        .post(`/api/admin/notifications/users/${tileWorkerUser.id}`)
        .set('Authorization', `Bearer ${opsAdminToken}`)
        .send({
          title: directTitle,
          message: directMessage,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.notification.userId).toBe(tileWorkerUser.id);
      expect(res.body.notification.title).toBe(directTitle);
    });

    test('OPERATIONS_ADMIN can query campaign audit history', async () => {
      const res = await request(app)
        .get('/api/admin/notifications/history?page=1&limit=10')
        .set('Authorization', `Bearer ${opsAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.campaigns.length).toBeGreaterThanOrEqual(1);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('4. Automated Event-Driven Notifications (Bill Approval & Rejection)', () => {
    test('Approving a bill creates BILL_APPROVED in-app notification with credited amount', async () => {
      // Create pending bill for plumber
      const testBill = await prisma.bill.create({
        data: {
          userId: plumberUser.id,
          invoiceNumber: `INV-APP-${Date.now()}`,
          billAmount: 5000,
          grossBillAmount: 5000,
          calculatedReward: 25,
          status: 'PENDING',
          fileUrl: 'https://storage.hsspl.algions.in/bills/sample1.jpg',
          fileKey: 'bills/sample1.jpg',
          fileHash: `hash_sample_app_${Date.now()}`,
          invoiceDate: new Date(),
        },
      });

      // Approve bill
      await BillService.approveBill(testBill.id, billAdminUser.id);

      // Check notification created for plumber
      const notif = await prisma.notification.findUnique({
        where: { dedupeKey: `bill_approved_${testBill.id}` },
      });

      expect(notif).not.toBeNull();
      expect(notif?.userId).toBe(plumberUser.id);
      expect(notif?.title).toBe('Bill Approved');
      expect(notif?.type).toBe('BILL_APPROVED');
      expect(notif?.message).toContain('has been credited to your rewards wallet');
    });

    test('Rejecting a bill creates BILL_REJECTED in-app notification with reason', async () => {
      const testBill = await prisma.bill.create({
        data: {
          userId: plumberUser.id,
          invoiceNumber: `INV-REJ-${Date.now()}`,
          billAmount: 3000,
          grossBillAmount: 3000,
          calculatedReward: 15,
          status: 'PENDING',
          fileUrl: 'https://storage.hsspl.algions.in/bills/sample2.jpg',
          fileKey: 'bills/sample2.jpg',
          fileHash: `hash_sample_rej_${Date.now()}`,
          invoiceDate: new Date(),
        },
      });

      const rejectionReason = 'Invoice image is blurry and date is not readable.';
      await BillService.rejectBill(testBill.id, billAdminUser.id, rejectionReason);

      const notif = await prisma.notification.findUnique({
        where: { dedupeKey: `bill_rejected_${testBill.id}` },
      });

      expect(notif).not.toBeNull();
      expect(notif?.userId).toBe(plumberUser.id);
      expect(notif?.title).toBe('Bill Rejected');
      expect(notif?.type).toBe('BILL_REJECTED');
      expect(notif?.message).toContain(rejectionReason);
    });
  });

  describe('5. Play Integrity Nonce Generation & Verification Adapter', () => {
    let testNonce: string;

    beforeAll(() => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
    });

    afterAll(() => {
      PlayIntegrityService.overrideConfig(null);
    });

    test('GET /api/auth/integrity/nonce returns 404 and POST requires authentication', async () => {
      const getRes = await request(app).get('/api/auth/integrity/nonce');
      expect(getRes.status).toBe(404);

      const unauthRes = await request(app).post('/api/auth/integrity/nonce');
      expect(unauthRes.status).toBe(401);
    });

    test('POST /api/auth/integrity/nonce returns cryptographically secure nonce with authenticated action context', async () => {
      const validHash = crypto.createHash('sha256').update('test_payload').digest('hex');
      const res = await request(app)
        .post('/api/auth/integrity/nonce')
        .set('Authorization', `Bearer ${plumberToken}`)
        .send({
          action: 'BILL_UPLOAD',
          requestHash: validHash,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.nonce).toBeDefined();
      expect(typeof res.body.nonce).toBe('string');
      expect(res.body.nonce.length).toBeGreaterThanOrEqual(16);
      expect(res.body.expiresAt).toBeDefined();

      testNonce = res.body.nonce;
    });

    test('POST /api/auth/integrity/verify verifies token and consumes nonce (single-use anti-replay)', async () => {
      const validHash = crypto.createHash('sha256').update('test_payload').digest('hex');
      const verifyRes = await request(app)
        .post('/api/auth/integrity/verify')
        .set('Authorization', `Bearer ${plumberToken}`)
        .send({
          nonce: testNonce,
          integrityToken: 'sample_jwt_integrity_token_from_play_store',
          action: 'BILL_UPLOAD',
          requestHash: validHash,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.verdict).toBeDefined();
      expect(verifyRes.body.verdict.isRealDevice).toBe(true);

      // Replay attempt with same nonce MUST be rejected
      const replayRes = await request(app)
        .post('/api/auth/integrity/verify')
        .set('Authorization', `Bearer ${plumberToken}`)
        .send({
          nonce: testNonce,
          integrityToken: 'sample_jwt_integrity_token_from_play_store',
          action: 'BILL_UPLOAD',
          requestHash: validHash,
        });

      expect(replayRes.status).toBe(400);
      expect(replayRes.body.success).toBe(false);
      expect(replayRes.body.message).toContain('replayed');
    });
  });
});
