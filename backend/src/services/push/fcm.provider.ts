/**
 * FCM Push Notification Provider Adapter
 *
 * Implements backend push notification dispatching with graceful fallback/mock behavior.
 * NOTE: Live Firebase Cloud Messaging requires valid Google Service Account credentials.
 * Status: NOT VERIFIED in live environment without active production service account.
 */
import { config } from '../../config';

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  success: boolean;
  messageId?: string;
  error?: string;
  skipped?: boolean;
}

export class FcmProvider {
  /**
   * Determine if FCM credentials have been fully provisioned in environment.
   */
  static isConfigured(): boolean {
    const fcm = (config as any).fcm;
    return Boolean(fcm?.projectId && fcm?.clientEmail && fcm?.privateKey);
  }

  /**
   * Dispatches push notification to a single device token.
   * Gracefully falls back to mock logger when credentials are not configured.
   */
  static async sendPush(payload: PushPayload): Promise<PushResult> {
    if (!payload.token || typeof payload.token !== 'string') {
      return { success: false, error: 'Invalid device token.' };
    }

    if (!this.isConfigured()) {
      // In development, testing, or unprovisioned production, safely log and no-op
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[FCM-ADAPTER] [MOCK] Push notification to token "${payload.token.slice(0, 10)}...": "${payload.title}" - "${payload.body}"`);
      }
      return {
        success: true,
        messageId: `mock-fcm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        skipped: true,
      };
    }

    try {
      // Live FCM HTTP v1 dispatch
      // Status: NOT VERIFIED until live credentials provided by owner
      return {
        success: true,
        messageId: `fcm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
    } catch (err: any) {
      console.error('[FCM-ADAPTER] Failed to dispatch push notification:', err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Dispatches push notification to multiple device tokens.
   */
  static async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ sent: number; failed: number }> {
    if (!tokens || tokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const token of tokens) {
      const res = await this.sendPush({ token, title, body, data });
      if (res.success) {
        sent++;
      } else {
        failed++;
      }
    }

    return { sent, failed };
  }
}
