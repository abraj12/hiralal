import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import {
  ConsentPurpose,
  getLegalDocument,
  sha256Text,
  TERMS_VERSION,
  PRIVACY_VERSION,
  AGE_CONFIRMATION_TEXT,
  PAN_CONSENT_TEXT,
  PAN_CONSENT_VERSION,
  BENEFICIARY_CONSENT_TEXT,
  BENEFICIARY_CONSENT_VERSION,
} from '../legal/documents';

type Db = Prisma.TransactionClient | typeof prisma;

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * HIR-M-08: Records server-owned consent evidence: purpose, document version and a hash of the exact
 * text the user was shown. Client-supplied consent wording is never stored as the record of consent.
 */
export class ConsentService {
  static async record(
    db: Db,
    userId: string,
    purpose: ConsentPurpose,
    documentVersion: string,
    text: string,
    ctx: RequestContext = {}
  ) {
    return db.consentRecord.create({
      data: {
        userId,
        purpose,
        documentVersion,
        textSha256: sha256Text(text),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent?.slice(0, 300),
      },
    });
  }

  /** Validates the acceptance fields a registering client must send. Returns an error message or null. */
  static validateRegistrationAcceptance(body: any): string | null {
    if (body?.acceptedTermsVersion !== TERMS_VERSION || body?.acceptedPrivacyVersion !== PRIVACY_VERSION) {
      return 'Please read and accept the current Terms & Conditions and Privacy Policy to register. Update the app if you are using an older version.';
    }
    if (body?.ageConfirmed !== true) {
      return 'You must confirm that you are 18 years of age or older to register.';
    }
    return null;
  }

  static async recordRegistrationAcceptance(db: Db, userId: string, ctx: RequestContext = {}) {
    await this.record(db, userId, 'TERMS_OF_SERVICE', TERMS_VERSION, getLegalDocument('terms').content, ctx);
    await this.record(db, userId, 'PRIVACY_NOTICE', PRIVACY_VERSION, getLegalDocument('privacy').content, ctx);
    await this.record(db, userId, 'AGE_CONFIRMATION', TERMS_VERSION, AGE_CONFIRMATION_TEXT, ctx);
  }

  static recordPanConsent(userId: string, ctx: RequestContext = {}) {
    return this.record(prisma, userId, 'PAN_VERIFICATION', PAN_CONSENT_VERSION, PAN_CONSENT_TEXT, ctx);
  }

  static recordBeneficiaryConsent(userId: string, ctx: RequestContext = {}) {
    return this.record(prisma, userId, 'BENEFICIARY_VERIFICATION', BENEFICIARY_CONSENT_VERSION, BENEFICIARY_CONSENT_TEXT, ctx);
  }
}
