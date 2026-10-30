import { Router, Response } from 'express';
import { authenticate, requireUser, AuthenticatedRequest } from '../middleware/auth.middleware';
import { KycService } from '../services/kyc.service';
import { kycLimiter } from '../middleware/rateLimit.middleware';
import { requireActionIntegrity } from '../middleware/integrity.middleware';
import { ConsentService } from '../services/consent.service';
import { PAN_CONSENT_TEXT } from '../legal/documents';

const router = Router();

router.post('/pan/verify', authenticate, requireUser, kycLimiter, requireActionIntegrity('KYC_SUBMIT'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { panNumber, panName, consent } = req.body;

    if (!panNumber || !panName || typeof panNumber !== 'string' || typeof panName !== 'string') {
      return res.status(400).json({ success: false, message: 'PAN number and full name on PAN card must be valid text.' });
    }

    if (consent !== true) {
      return res.status(400).json({
        success: false,
        message: 'User informed consent is mandatory before submitting PAN identity for verification.',
      });
    }

    // HIR-M-08: record the server-owned consent text the app displays, not client-supplied wording
    await ConsentService.recordPanConsent(user.id, {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    const record = await KycService.submitPan({
      userId: user.id,
      panNumber,
      panName,
      consent: true,
      consentText: PAN_CONSENT_TEXT,
    });

    res.json({
      success: true,
      message: 'PAN verified and name matched successfully.',
      kyc: {
        panStatus: record.panStatus,
        maskedPan: record.maskedPan,
        panName: record.panName,
        verifiedName: record.verifiedName || record.panName,
        nameMatched: record.nameMatched,
        verifiedAt: record.verifiedAt,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/status', authenticate, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const result = await KycService.getUserKyc(user.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve KYC status. Please retry.' });
  }
});

export default router;
