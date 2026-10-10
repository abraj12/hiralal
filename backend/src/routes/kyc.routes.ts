import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { KycService } from '../services/kyc.service';
import { kycLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

router.post('/pan/verify', authenticate, kycLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { panNumber, panName, consent, consentText } = req.body;

    if (!panNumber || !panName) {
      return res.status(400).json({ success: false, message: 'PAN number and full name on PAN card are required.' });
    }

    if (consent !== true) {
      return res.status(400).json({
        success: false,
        message: 'User informed consent is mandatory before submitting PAN identity for verification.',
      });
    }

    const record = await KycService.submitPan({
      userId: user.id,
      panNumber,
      panName,
      consent: true,
      consentText,
    });

    res.json({
      success: true,
      message: 'PAN verified and name matched successfully.',
      kyc: {
        panStatus: record.panStatus,
        maskedPan: record.maskedPan,
        panName: record.panName,
        verifiedName: record.verifiedName,
        nameMatched: record.nameMatched,
        verifiedAt: record.verifiedAt,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const result = await KycService.getUserKyc(user.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
