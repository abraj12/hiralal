import { Router, Request, Response } from 'express';
import {
  getLegalDocument,
  LegalDocumentType,
  PAN_CONSENT_TEXT,
  PAN_CONSENT_VERSION,
  BENEFICIARY_CONSENT_TEXT,
  BENEFICIARY_CONSENT_VERSION,
  AGE_CONFIRMATION_TEXT,
} from '../legal/documents';

/**
 * HIR-M-06 / HIR-M-07 / HIR-M-08: Public, versioned legal documents and consent texts.
 * The apps display these instead of hard-coded strings, so what users accept is what the server records.
 */
const router = Router();

router.get('/consent-texts', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    success: true,
    consents: {
      PAN_VERIFICATION: { version: PAN_CONSENT_VERSION, text: PAN_CONSENT_TEXT },
      BENEFICIARY_VERIFICATION: { version: BENEFICIARY_CONSENT_VERSION, text: BENEFICIARY_CONSENT_TEXT },
      AGE_CONFIRMATION: { text: AGE_CONFIRMATION_TEXT },
    },
  });
});

router.get('/:type', (req: Request, res: Response) => {
  const type = req.params.type as LegalDocumentType;
  if (type !== 'terms' && type !== 'privacy') {
    return res.status(404).json({ success: false, message: 'Legal document not found.' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json({ success: true, document: getLegalDocument(type) });
});

export default router;
