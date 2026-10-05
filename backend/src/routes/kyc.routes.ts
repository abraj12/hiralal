import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { KycService } from '../services/kyc.service';

const router = Router();

router.post('/pan/verify', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { panNumber, panName } = req.body;

    if (!panNumber || !panName) {
      return res.status(400).json({ success: false, message: 'PAN number and full name are required.' });
    }

    const record = await KycService.verifyPan(user.id, panNumber, panName);

    res.json({
      success: true,
      message: 'PAN verified successfully.',
      kyc: {
        panStatus: record.panStatus,
        maskedPan: record.maskedPan,
        panName: record.panName,
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
    const record = KycService.getUserKyc(user.id);

    res.json({
      success: true,
      kyc: record
        ? {
            panStatus: record.panStatus,
            maskedPan: record.maskedPan,
            panName: record.panName,
            verifiedAt: record.verifiedAt,
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
