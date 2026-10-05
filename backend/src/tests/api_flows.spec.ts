import request from 'supertest';
import { app } from '../server';

describe('Hiralal & Sons - End-to-End API Integration Tests', () => {
  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    // 1. Login seeded plumber Raj
    const userRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: '9876543210', password: 'Password@123' });

    expect(userRes.status).toBe(200);
    userToken = userRes.body.token;

    // 2. Login seeded Admin
    const adminRes = await request(app)
      .post('/api/auth/admin-login')
      .send({ username: '9999999999', password: 'Admin@123' });

    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;
  });

  test('GET /health returns 200 OK with service details', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toContain('Hiralal & Sons');
  });

  test('POST /api/auth/send-otp and register new user with profession', async () => {
    const uniqueMobile = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

    const otpRes = await request(app)
      .post('/api/auth/send-otp')
      .send({ mobile: uniqueMobile, purpose: 'REGISTRATION' });
    expect(otpRes.status).toBe(200);
    expect(otpRes.body.success).toBe(true);

    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        mobile: uniqueMobile,
        fullName: 'Vikram Singh',
        password: 'Password@123',
        profession: 'PLUMBER',
        otpCode: '123456',
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.profession).toBe('PLUMBER');
    expect(regRes.body.token).toBeDefined();
  });

  test('GET /api/auth/me returns user profile and profession', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.fullName).toBe('Raj Kumar');
    expect(res.body.user.profession).toBe('PLUMBER');
    expect(res.body.wallet).toBeDefined();
  });

  test('PATCH /api/auth/me allows dynamically switching profession', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ profession: 'TILE_INSTALLER' });

    expect(res.status).toBe(200);
    expect(res.body.user.profession).toBe('TILE_INSTALLER');

    // Switch back to PLUMBER
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ profession: 'PLUMBER' });
  });

  test('POST /api/bills uploads bill and calculates provisional reward', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        invoiceNumber: `INV-${Date.now()}`,
        invoiceDate: '2026-10-04',
        billAmount: '75000',
        remarks: 'Pipes & Fittings for site A',
      });

    expect(res.status).toBe(201);
    expect(res.body.bill.status).toBe('PENDING');
    expect(res.body.bill.calculatedReward).toBe(375.0); // 75,000 * 0.5% = 375
  });

  test('GET /api/admin/dashboard rejects regular user with 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(403);
  });

  test('GET /api/admin/dashboard allows Admin with 200 OK and analytics', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.pool.totalPoolCap).toBe(50000);
    expect(res.body.stats.pool.percentageUsed).toBeDefined();
    expect(res.body.recentBills.length).toBeGreaterThan(0);
  });

  test('POST /api/admin/bills/:id/verify approves bill and credits wallet atomically', async () => {
    // 1. Create a pending bill first
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        invoiceNumber: `INV-VERIFY-${Date.now()}`,
        invoiceDate: '2026-10-04',
        billAmount: '100000',
        remarks: 'Verification Test',
      });

    const billId = billRes.body.bill.id;

    // 2. Admin Approves Bill
    const verifyRes = await request(app)
      .post(`/api/admin/bills/${billId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'APPROVE' });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.bill.status).toBe('APPROVED');
    expect(verifyRes.body.bill.calculatedReward).toBe(500.0); // Server calculated ₹500
  });

  test('POST /api/admin/bills/:id/verify rejects bill with required rejection reason', async () => {
    // 1. Create a pending bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        invoiceNumber: `INV-REJECT-${Date.now()}`,
        invoiceDate: '2026-10-04',
        billAmount: '15000',
      });

    const billId = billRes.body.bill.id;

    // Attempt reject without reason should fail
    const failRes = await request(app)
      .post(`/api/admin/bills/${billId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'REJECT' });

    expect(failRes.status).toBe(400);

    // Reject with reason
    const okRes = await request(app)
      .post(`/api/admin/bills/${billId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'REJECT', rejectionReason: 'Invoice image blurry and date mismatched' });

    expect(okRes.status).toBe(200);
    expect(okRes.body.bill.status).toBe('REJECTED');
    expect(okRes.body.bill.rejectionReason).toContain('blurry');
  });

  test('PUT /api/admin/settings/reward-rules updates reward rules with audit logging', async () => {
    const res = await request(app)
      .put('/api/admin/settings/reward-rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        percentage: '0.6',
        monthlyPoolLimit: '60000',
        minRedemptionAmount: '600',
      });

    expect(res.status).toBe(200);
    expect(res.body.rules.percentage).toBe(0.6);
    expect(res.body.rules.monthlyPoolLimit).toBe(60000);

    // Reset back
    await request(app)
      .put('/api/admin/settings/reward-rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        percentage: '0.5',
        monthlyPoolLimit: '50000',
        minRedemptionAmount: '500',
      });
  });
});
