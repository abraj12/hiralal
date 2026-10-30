import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { app } from '../server';
import { prisma } from '../db';
import { config } from '../config';
import { AuthService } from '../services/auth.service';
import { getOrCreateOpsAdmin } from './test_helpers';

describe('HIR-M-12 — Password change and forced administrator rotation', () => {
  const userMobile = '9876500021';
  const originalPassword = 'OriginalPass#2026';
  let userId: string;
  let userToken: string;

  beforeAll(async () => {
    const existing = await prisma.user.findUnique({ where: { mobile: userMobile } });
    if (existing) {
      await prisma.authSession.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
    const user = await prisma.user.create({
      data: {
        mobile: userMobile,
        fullName: 'Password Change Tester',
        passwordHash: await bcrypt.hash(originalPassword, 12),
        role: 'USER',
        profession: 'PLUMBER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    userId = user.id;
    userToken = jwt.sign({ userId, role: 'USER' }, config.jwt.accessSecret, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('rejects an incorrect current password and counts it toward lockout', async () => {
    const res = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currentPassword: 'WrongPassword#1', newPassword: 'BrandNewPass#2026' });

    expect(res.status).toBe(400);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.failedPasswordAttempts).toBeGreaterThan(0);
    expect(await bcrypt.compare(originalPassword, after!.passwordHash)).toBe(true);
  });

  it('changes the password, revokes sessions and clears the rotation flag', async () => {
    await prisma.authSession.create({
      data: { userId, sessionId: 'pc-session', tokenHash: `pc-${Date.now()}`, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true, failedPasswordAttempts: 0 } });

    const res = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ currentPassword: originalPassword, newPassword: 'BrandNewPass#2026' });

    expect(res.status).toBe(200);
    expect(res.body.requiresReauthentication).toBe(true);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(await bcrypt.compare('BrandNewPass#2026', after!.passwordHash)).toBe(true);
    expect(after?.mustChangePassword).toBe(false);
    expect(after?.passwordChangedAt).toBeTruthy();
    expect(after?.activeSessionId).toBeNull();

    const liveSessions = await prisma.authSession.count({ where: { userId, revokedAt: null } });
    expect(liveSessions).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: userId, action: 'PASSWORD_CHANGED' } });
    expect(audit).toBeTruthy();
  });

  it('requires at least 12 characters for administrator passwords', async () => {
    const opsAdmin = await getOrCreateOpsAdmin(prisma);
    await expect(
      AuthService.changePassword({ userId: opsAdmin.id, currentPassword: 'anything', newPassword: 'Short#Pass1' })
    ).rejects.toThrow(/at least 12 characters/);
  });

  it('blocks a flagged administrator from every route except password change and /auth/me', async () => {
    const opsAdmin = await getOrCreateOpsAdmin(prisma);
    const adminToken = jwt.sign(
      { userId: opsAdmin.id, role: 'OPERATIONS_ADMIN' },
      config.admin.accessSecret || config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    await prisma.user.update({ where: { id: opsAdmin.id }, data: { mustChangePassword: true } });
    try {
      const blocked = await request(app).get('/api/v1/admin/payouts').set('Authorization', `Bearer ${adminToken}`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`);
      expect(me.status).toBe(200);
      expect(me.body.user.mustChangePassword).toBe(true);
    } finally {
      await prisma.user.update({ where: { id: opsAdmin.id }, data: { mustChangePassword: false } });
    }

    const allowed = await request(app).get('/api/v1/admin/payouts').set('Authorization', `Bearer ${adminToken}`);
    expect(allowed.status).toBe(200);
  });
});
