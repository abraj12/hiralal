import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';
import { NotificationService } from '../services/notification.service';

const router = Router();

// Protect all notification endpoints with authentication
router.use(authenticate);

/**
 * GET /api/notifications
 * Retrieves paginated in-app notifications for the authenticated user.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

    const result = await NotificationService.getNotificationsForUser(userId, { page, limit });
    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/notifications/unread-count
 * Fast endpoint for mobile & web badge indicators.
 */
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const count = await NotificationService.getUnreadCount(userId);
    res.json({ success: true, unreadCount: count });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Marks all notifications for the authenticated user as read.
 */
router.patch('/read-all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await NotificationService.markAllReadForUser(userId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks a specific notification as read, enforcing strict user ownership.
 */
router.patch('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const notificationId = req.params.id;

    const updated = await NotificationService.markReadForUser(notificationId, userId);
    res.json({ success: true, notification: updated });
  } catch (err: any) {
    const isForbidden = err.message && (err.message.includes('denied') || err.message.includes('not found'));
    res.status(isForbidden ? 404 : 400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/notifications/device-token
 * Registers or updates a device push token for the authenticated user.
 */
router.post('/device-token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { token, platform } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Device token is required.' });
    }

    const deviceToken = await NotificationService.registerDeviceToken(userId, { token, platform });
    res.status(201).json({ success: true, deviceToken });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/notifications/device-token/:token
 * Deactivates a device push token upon logout.
 */
router.delete('/device-token/:token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const token = req.params.token;

    await NotificationService.deactivateDeviceToken(userId, token);
    res.json({ success: true, message: 'Device token deactivated.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/notifications/device-token
 * Deactivates a device push token passed in query or body.
 */
router.delete('/device-token', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const token = (req.body?.token || req.query?.token) as string;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Device token is required.' });
    }

    await NotificationService.deactivateDeviceToken(userId, token);
    res.json({ success: true, message: 'Device token deactivated.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
