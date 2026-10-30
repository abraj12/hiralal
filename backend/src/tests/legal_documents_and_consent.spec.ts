import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server';
import { prisma } from '../db';
import { config, validateProductionLegalContact } from '../config';
import {
  getLegalDocument,
  PAN_CONSENT_TEXT,
  sha256Text,
  TERMS_VERSION,
  PRIVACY_VERSION,
} from '../legal/documents';

describe('Phase 5 — legal documents and consent records (HIR-M-06, M-07, M-08)', () => {
  const userMobile = '9876500041';
  let userId: string;
  let userToken: string;

  beforeAll(async () => {
    const existing = await prisma.user.findUnique({ where: { mobile: userMobile } });
    if (existing) {
      await prisma.consentRecord.deleteMany({ where: { userId: existing.id } });
      await prisma.kycRecord.deleteMany({ where: { userId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
    const user = await prisma.user.create({
      data: { mobile: userMobile, fullName: 'Consent Tester', passwordHash: 'x', role: 'USER', profession: 'PLUMBER', status: 'ACTIVE', isVerified: true },
    });
    userId = user.id;
    userToken = jwt.sign({ userId, role: 'USER' }, config.jwt.accessSecret, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.kycRecord.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('serves versioned Terms and Privacy Policy that name every processor and the corrected rules', async () => {
    const terms = await request(app).get('/api/v1/legal/terms');
    const privacy = await request(app).get('/api/v1/legal/privacy');
    expect(terms.status).toBe(200);
    expect(privacy.status).toBe(200);
    expect(terms.body.document.version).toBe(TERMS_VERSION);
    expect(privacy.body.document.version).toBe(PRIVACY_VERSION);

    for (const processor of ['SignCare', 'RazorpayX', 'WhatsApp', 'MSG91', 'Cloudflare', 'Firebase Cloud Messaging', 'Play Integrity']) {
      expect(privacy.body.document.content).toContain(processor);
    }
    // HIR-M-07: the old claims about automated GST and unconditional 100% payout are gone
    expect(terms.body.document.content).not.toMatch(/automated GST/i);
    expect(terms.body.document.content).toContain('₹50,000');
    expect(terms.body.document.content).toMatch(/Grievance Officer/);
  });

  it('rejects registration without accepting the current documents', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ mobile: '9876500042', fullName: 'No Accept', password: 'Password@123', profession: 'PLUMBER', verificationToken: 'x'.repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
  });

  it('records the server-owned PAN consent text, not client-supplied wording', async () => {
    await request(app)
      .post('/api/v1/kyc/pan/verify')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ panNumber: 'ZXCVB1234N', panName: 'Consent Tester', consent: true, consentText: 'Something else entirely' });

    const record = await prisma.consentRecord.findFirst({ where: { userId, purpose: 'PAN_VERIFICATION' } });
    expect(record).toBeTruthy();
    expect(record?.textSha256).toBe(sha256Text(PAN_CONSENT_TEXT));
  });

  it('requires consent before bank or UPI verification', async () => {
    const res = await request(app)
      .post('/api/v1/payment-account/upi/verify')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ upiId: 'consent.tester@upi' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('mobile consent wording is identical to the server-recorded wording', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const mobileTexts = fs.readFileSync(path.resolve(__dirname, '../../../mobile/src/legal/consentTexts.ts'), 'utf8');
    const documents = require('../legal/documents');
    for (const key of ['PAN_CONSENT_TEXT', 'BENEFICIARY_CONSENT_TEXT', 'AGE_CONFIRMATION_TEXT']) {
      expect(mobileTexts).toContain(documents[key]);
    }
  });

  it('requires real grievance contact details in sensitive environments', () => {
    expect(() => validateProductionLegalContact({})).toThrow(/LEGAL_GRIEVANCE_OFFICER_NAME/);
    expect(() =>
      validateProductionLegalContact({
        LEGAL_COMPANY_ADDRESS: 'Plot 1, Industrial Area, Jaipur, Rajasthan',
        LEGAL_GRIEVANCE_OFFICER_NAME: 'A. Officer',
        LEGAL_GRIEVANCE_OFFICER_EMAIL: 'grievance@example.in',
      })
    ).not.toThrow();
    expect(getLegalDocument('privacy', { LEGAL_GRIEVANCE_OFFICER_EMAIL: 'grievance@example.in' }).content).toContain('grievance@example.in');
  });
});
