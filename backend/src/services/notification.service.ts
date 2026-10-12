import { prisma } from '../db';
import { FcmProvider } from './push/fcm.provider';

export interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  type?: string;
  metadata?: any;
  dedupeKey?: string;
}

export interface BroadcastInput {
  title: string;
  message: string;
  targetAudience?: 'ALL' | 'PLUMBER' | 'TILE_INSTALLER';
  idempotencyKey?: string;
  metadata?: any;
}

export class NotificationService {
  /**
   * Creates an in-app notification for a specific user and asynchronously triggers push.
   * If dedupeKey is provided and already exists, gracefully returns the existing notification.
   */
  static async createForUser(input: CreateNotificationInput) {
    if (!input.userId) {
      throw new Error('User ID is required to create a notification.');
    }
    if (!input.title || !input.title.trim()) {
      throw new Error('Notification title is required.');
    }
    if (!input.message || !input.message.trim()) {
      throw new Error('Notification message is required.');
    }

    if (input.dedupeKey) {
      const existing = await prisma.notification.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) {
        return existing;
      }
    }

    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title.trim(),
        message: input.message.trim(),
        type: input.type || 'GENERAL',
        metadata: input.metadata || null,
        dedupeKey: input.dedupeKey || null,
      },
    });

    // Asynchronously dispatch push to registered active device tokens
    this.dispatchPushForUser(input.userId, input.title.trim(), input.message.trim(), input.metadata).catch((err) => {
      console.error(`[NOTIFICATION-SERVICE] Background push dispatch failed for user ${input.userId}:`, err.message);
    });

    return notification;
  }

  /**
   * Helper to dispatch push notifications to all active device tokens of a user.
   */
  private static async dispatchPushForUser(userId: string, title: string, message: string, metadata?: any) {
    const tokens = await prisma.pushDeviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length > 0) {
      const tokenStrings = tokens.map((t) => t.token);
      await FcmProvider.sendMulticast(tokenStrings, title, message, metadata ? { meta: JSON.stringify(metadata) } : undefined);
    }
  }

  /**
   * Retrieves paginated notifications for a user, sorted descending by creation time.
   */
  static async getNotificationsForUser(userId: string, options: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Fast count of unread notifications for badges.
   */
  static async getUnreadCount(userId: string): Promise<number> {
    return await prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Marks a single notification as read with strict user ownership validation.
   */
  static async markReadForUser(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found or access denied.');
    }

    if (notification.isRead) {
      return notification;
    }

    return await prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Marks all notifications of a user as read.
   */
  static async markAllReadForUser(userId: string) {
    const now = new Date();
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: now,
      },
    });

    return { updatedCount: result.count };
  }

  /**
   * Registers or reactivates a push device token for a user.
   */
  static async registerDeviceToken(userId: string, input: { token: string; platform?: string }) {
    const token = String(input.token || '').trim();
    if (!token || token.length < 10) {
      throw new Error('A valid device token string (at least 10 characters) is required.');
    }

    const validPlatforms = ['ANDROID', 'IOS', 'WEB'];
    const platform = (input.platform || 'ANDROID').toUpperCase();
    const finalPlatform = validPlatforms.includes(platform) ? platform : 'ANDROID';

    return await prisma.pushDeviceToken.upsert({
      where: { token },
      update: {
        userId,
        platform: finalPlatform,
        isActive: true,
        lastUsedAt: new Date(),
      },
      create: {
        userId,
        token,
        platform: finalPlatform,
        isActive: true,
      },
    });
  }

  /**
   * Deactivates a device token for a user upon logout or token revocation.
   */
  static async deactivateDeviceToken(userId: string, token: string) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) {
      throw new Error('Device token is required.');
    }

    const existing = await prisma.pushDeviceToken.findFirst({
      where: { userId, token: cleanToken },
    });

    if (existing) {
      await prisma.pushDeviceToken.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
    }

    return { success: true };
  }

  /**
   * Operations Admin broadcast to targeted workers.
   * Audited, idempotent, and creates both in-app records and push dispatches.
   */
  static async broadcastToWorkers(adminId: string, input: BroadcastInput) {
    if (!input.title || !input.title.trim()) {
      throw new Error('Broadcast title is required.');
    }
    if (!input.message || !input.message.trim()) {
      throw new Error('Broadcast message is required.');
    }

    const audience = input.targetAudience || 'ALL';
    const allowedAudiences = ['ALL', 'PLUMBER', 'TILE_INSTALLER'];
    if (!allowedAudiences.includes(audience)) {
      throw new Error(`Invalid target audience "${audience}". Allowed: ALL, PLUMBER, TILE_INSTALLER.`);
    }

    // Check idempotencyKey to prevent duplicate broadcasts
    if (input.idempotencyKey) {
      const existingCampaign = await prisma.notificationCampaign.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existingCampaign) {
        return existingCampaign;
      }
    }

    // Determine target users
    const userWhere: any = {
      role: 'USER',
      status: 'ACTIVE',
    };

    if (audience === 'PLUMBER') {
      userWhere.profession = 'PLUMBER';
    } else if (audience === 'TILE_INSTALLER') {
      userWhere.profession = 'TILE_INSTALLER';
    }

    const targetUsers = await prisma.user.findMany({
      where: userWhere,
      select: { id: true },
    });

    const recipientCount = targetUsers.length;

    // Transaction to create Campaign and Notifications
    const campaign = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.notificationCampaign.create({
        data: {
          title: input.title.trim(),
          message: input.message.trim(),
          targetAudience: audience,
          recipientCount,
          createdByAdminId: adminId,
          idempotencyKey: input.idempotencyKey || null,
          metadata: input.metadata || null,
        },
      });

      if (targetUsers.length > 0) {
        await tx.notification.createMany({
          data: targetUsers.map((u) => ({
            userId: u.id,
            title: input.title.trim(),
            message: input.message.trim(),
            type: 'ANNOUNCEMENT',
            metadata: {
              campaignId: newCampaign.id,
              audience,
              ...(input.metadata || {}),
            },
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'NOTIFICATION_BROADCAST_CREATED',
          entityType: 'NotificationCampaign',
          entityId: newCampaign.id,
          newValue: JSON.stringify({
            title: input.title.trim(),
            audience,
            recipientCount,
          }),
        },
      });

      return newCampaign;
    });

    // Background push to all active tokens for target users
    (async () => {
      try {
        const tokens = await prisma.pushDeviceToken.findMany({
          where: {
            userId: { in: targetUsers.map((u) => u.id) },
            isActive: true,
          },
          select: { token: true },
        });

        if (tokens.length > 0) {
          const tokenStrings = tokens.map((t) => t.token);
          await FcmProvider.sendMulticast(
            tokenStrings,
            input.title.trim(),
            input.message.trim(),
            { campaignId: campaign.id }
          );
        }
      } catch (err: any) {
        console.error('[NOTIFICATION-SERVICE] Background multicast failed:', err.message);
      }
    })();

    return campaign;
  }

  /**
   * Operations Admin direct notification to a specific user.
   */
  static async sendDirectNotification(
    adminId: string,
    targetUserId: string,
    input: { title: string; message: string; metadata?: any }
  ) {
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new Error('Target user not found.');
    }

    const notification = await this.createForUser({
      userId: targetUserId,
      title: input.title,
      message: input.message,
      type: 'ADMIN_DIRECT',
      metadata: input.metadata,
    });

    await prisma.auditLog.create({
      data: {
        adminId,
        action: 'NOTIFICATION_DIRECT_SENT',
        entityType: 'Notification',
        entityId: notification.id,
        newValue: JSON.stringify({
          targetUserId,
          title: input.title,
        }),
      },
    });

    return notification;
  }

  /**
   * Retrieves campaign history for operational audit.
   */
  static async getCampaignHistory(options: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      prisma.notificationCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          createdByAdmin: {
            select: { id: true, fullName: true, mobile: true, role: true },
          },
        },
        skip,
        take: limit,
      }),
      prisma.notificationCampaign.count(),
    ]);

    return {
      campaigns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
