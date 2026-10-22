import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { pushTokenLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
router.use(authenticate);

/**
 * POST /api/push-token/register
 * Registers or reactivates a device push token for the authenticated user.
 */
router.post('/register', pushTokenLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { token, platform } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ success: false, message: 'Device token is required.' });
    }

    if (platform && !['ANDROID', 'IOS', 'WEB'].includes(String(platform).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Platform must be ANDROID, IOS, or WEB.' });
    }

    const deviceToken = await NotificationService.registerDeviceToken(userId, { token, platform });
    res.status(201).json({ success: true, deviceToken });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/push-token/deactivate
 * Deactivates a device push token for the authenticated user.
 */
router.post('/deactivate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { token, platform } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ success: false, message: 'Device token is required.' });
    }

    if (platform && !['ANDROID', 'IOS', 'WEB'].includes(String(platform).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Platform must be ANDROID, IOS, or WEB.' });
    }

    await NotificationService.deactivateDeviceToken(userId, token);
    res.json({ success: true, message: 'Device token deactivated.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/push-token
 * Deactivates a device push token for the authenticated user.
 */
router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const token = (req.body?.token || req.query?.token) as string;
    const platform = (req.body?.platform || req.query?.platform) as string | undefined;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ success: false, message: 'Device token is required.' });
    }

    if (platform && !['ANDROID', 'IOS', 'WEB'].includes(String(platform).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Platform must be ANDROID, IOS, or WEB.' });
    }

    await NotificationService.deactivateDeviceToken(userId, token);
    res.json({ success: true, message: 'Device token deactivated.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
