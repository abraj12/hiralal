import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticate, requireUser, AuthenticatedRequest } from '../middleware/auth.middleware';
import { NotificationService } from '../services/notification.service';
import { FcmProvider } from '../services/push/fcm.provider';
import { createRateLimiter } from '../middleware/rateLimit.middleware';
import { prisma } from '../db';

const router = Router();

const welcomeRateLimiter = createRateLimiter({
  keyPrefix: 'rl:notif:welcome',
  limit: 10,
  windowSeconds: 60,
  message: 'Too many welcome notification requests. Please try again later.',
});

/**
 * POST /api/notifications/welcome
 * Delivers welcome notification for first-launch / device installation.
 * SECURE: Requires authenticated user identity; dispatches ONLY to registered device tokens
 * belonging to the authenticated user. Eliminates arbitrary FCM relay vulnerabilities.
 * Idempotent & concurrency-safe: uses atomic database claim on AppInstallation table.
 * Returns distinct status ('ACCEPTED', 'ALREADY_ACCEPTED', 'RECORDED_PENDING_PUSH', 'FAILED_RETRYABLE').
 */
router.post('/welcome', authenticate, requireUser, welcomeRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { installationId, platform, appVersion } = req.body ?? {};
    if (!installationId || typeof installationId !== 'string' || !installationId.trim()) {
      return res.status(400).json({ success: false, message: 'A valid installationId is required.' });
    }

    const cleanInstallId = installationId.trim();
    const cleanPlatform = typeof platform === 'string' && platform.trim() ? platform.trim().toUpperCase() : 'ANDROID';
    if (cleanPlatform !== 'ANDROID' && cleanPlatform !== 'WEB') {
      return res.status(400).json({ success: false, message: 'Invalid platform. Supported platforms are ANDROID and WEB.' });
    }
    const authUserId = req.user!.id;

    const title = 'Welcome to Hiralal and Sons!';
    const message = 'Welcome to Hiralal and Sons Sales Rewards Program. Register and upload your bills to get your rewards.';

    // 1. Verify installation ownership
    let installation = await prisma.appInstallation.findUnique({
      where: { installationId: cleanInstallId },
    });

    if (installation && installation.userId && installation.userId !== authUserId) {
      return res.status(403).json({
        success: false,
        message: 'This installation is already registered to a different account.',
      });
    }

    if (installation && (installation.welcomeStatus === 'ACCEPTED' || installation.welcomeStatus === 'DELIVERED')) {
      return res.json({
        success: true,
        status: 'ALREADY_ACCEPTED',
        delivered: true,
        installationId: cleanInstallId,
        message: 'Welcome notification already delivered previously for this installation.',
      });
    }

    // 2. Ensure installation record is provisioned and bound to current user
    if (!installation) {
      try {
        installation = await prisma.appInstallation.create({
          data: {
            installationId: cleanInstallId,
            userId: authUserId,
            platform: cleanPlatform,
            appVersion: typeof appVersion === 'string' ? appVersion.slice(0, 50) : null,
            welcomeStatus: 'PENDING',
          },
        });
      } catch {
        installation = await prisma.appInstallation.findUnique({
          where: { installationId: cleanInstallId },
        });
      }
    } else if (!installation.userId) {
      installation = await prisma.appInstallation.update({
        where: { id: installation.id },
        data: { userId: authUserId },
      });
    }

    // Double check status after provision
    if (installation?.welcomeStatus === 'ACCEPTED' || installation?.welcomeStatus === 'DELIVERED') {
      return res.json({
        success: true,
        status: 'ALREADY_ACCEPTED',
        delivered: true,
        installationId: cleanInstallId,
        message: 'Welcome notification already delivered previously for this installation.',
      });
    }

    // 3. Atomically claim dispatch lease to prevent concurrent double-dispatch
    const claimId = crypto.randomUUID();
    const claimExpiresAt = new Date(Date.now() + 30000); // 30-second bounded claim lease
    const now = new Date();

    const claimResult = await prisma.appInstallation.updateMany({
      where: {
        installationId: cleanInstallId,
        userId: authUserId,
        welcomeStatus: { in: ['PENDING', 'FAILED_RETRYABLE'] },
        OR: [
          { claimExpiresAt: null },
          { claimExpiresAt: { lt: now } },
        ],
      },
      data: {
        welcomeStatus: 'SENDING',
        claimId,
        claimExpiresAt,
      },
    });

    if (claimResult.count === 0) {
      // Another concurrent worker claimed the dispatch or it transitioned to accepted
      const latest = await prisma.appInstallation.findUnique({ where: { installationId: cleanInstallId } });
      if (latest?.welcomeStatus === 'ACCEPTED' || latest?.welcomeStatus === 'DELIVERED') {
        return res.json({
          success: true,
          status: 'ALREADY_ACCEPTED',
          delivered: true,
          installationId: cleanInstallId,
          message: 'Welcome notification already delivered previously for this installation.',
        });
      }
      return res.json({
        success: true,
        status: 'SENDING',
        delivered: false,
        installationId: cleanInstallId,
        message: 'Welcome notification dispatch is actively in progress by another request.',
      });
    }

    // 4. Create durable in-app welcome notification for user
    const notification = await NotificationService.createForUser({
      userId: authUserId,
      title,
      message,
      type: 'WELCOME',
      dedupeKey: `welcome_install_${cleanInstallId}`,
    });

    // 5. Query verified active device token registered for THIS authenticated user
    const activeDeviceToken = await prisma.pushDeviceToken.findFirst({
      where: {
        userId: authUserId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!activeDeviceToken || !activeDeviceToken.token) {
      // No active registered push token yet: release claim and mark PENDING for future retry
      await prisma.appInstallation.updateMany({
        where: { installationId: cleanInstallId, claimId },
        data: {
          welcomeStatus: 'PENDING',
          claimExpiresAt: null,
        },
      });

      return res.json({
        success: true,
        status: 'RECORDED_PENDING_PUSH',
        delivered: false,
        installationId: cleanInstallId,
        notification,
        message: 'Welcome event recorded. Awaiting registered device push token before FCM dispatch.',
      });
    }

    // 6. Dispatch FCM push to the authenticated user's registered token outside DB tx
    try {
      const pushResult = await FcmProvider.sendPush({
        token: activeDeviceToken.token,
        title,
        body: message,
        data: { type: 'WELCOME', installId: cleanInstallId },
      });

      if (pushResult.success) {
        await prisma.appInstallation.updateMany({
          where: { installationId: cleanInstallId, claimId },
          data: {
            welcomeStatus: 'ACCEPTED',
            welcomeSentAt: new Date(),
            pushToken: activeDeviceToken.token,
            claimExpiresAt: null,
          },
        });

        return res.json({
          success: true,
          status: 'ACCEPTED',
          delivered: true,
          installationId: cleanInstallId,
          notification,
          message: 'Welcome push notification accepted by provider for delivery.',
        });
      } else {
        await prisma.appInstallation.updateMany({
          where: { installationId: cleanInstallId, claimId },
          data: {
            welcomeStatus: 'FAILED_RETRYABLE',
            pushToken: activeDeviceToken.token,
            claimExpiresAt: null,
          },
        });

        return res.json({
          success: true,
          status: 'FAILED_RETRYABLE',
          delivered: false,
          installationId: cleanInstallId,
          notification,
          message: 'Push notification provider returned temporary failure; queued for retry.',
        });
      }
    } catch (pushErr: any) {
      console.warn('[WELCOME-PUSH-ERROR]', pushErr?.message);
      await prisma.appInstallation.updateMany({
        where: { installationId: cleanInstallId, claimId },
        data: {
          welcomeStatus: 'FAILED_RETRYABLE',
          pushToken: activeDeviceToken.token,
          claimExpiresAt: null,
        },
      });

      return res.json({
        success: true,
        status: 'FAILED_RETRYABLE',
        delivered: false,
        installationId: cleanInstallId,
        notification,
        message: 'Push notification dispatch encountered error; queued for retry.',
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Notification operation failed. Please retry.' });
  }
});

// Protect remaining notification endpoints with authentication
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
    res.status(500).json({ success: false, message: 'Notification operation failed. Please retry.' });
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
    res.status(500).json({ success: false, message: 'Notification operation failed. Please retry.' });
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
    res.status(500).json({ success: false, message: 'Notification operation failed. Please retry.' });
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

/**
 * POST /api/notifications/device-token/deactivate
 * Deactivates a device push token passed in body.
 */
router.post('/device-token/deactivate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { token } = req.body;

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
