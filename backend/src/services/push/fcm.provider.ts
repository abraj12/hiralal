import { config } from '../../config';
import { prisma } from '../../db';
import jwt from 'jsonwebtoken';

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
  errorCode?: string;
  skipped?: boolean;
}

interface FcmConfigOverride {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class FcmProvider {
  private static tokenCache: TokenCache | null = null;
  private static inFlightTokenPromise: Promise<string> | null = null;
  private static fetchClient: typeof fetch = globalThis.fetch;
  private static configOverride: FcmConfigOverride | null = null;

  /**
   * Safe device token masking for structured logging.
   * Never exposes full device tokens in logs.
   */
  static maskToken(token: string): string {
    if (!token || typeof token !== 'string') return 'UNKNOWN';
    if (token.length <= 10) return '***';
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }

  /**
   * Injects custom fetch client for unit testing.
   */
  static setFetchClient(client: typeof fetch | null): void {
    this.fetchClient = client || globalThis.fetch;
  }

  /**
   * Overrides FCM configuration for testing without modifying global config.
   */
  static overrideConfig(override: FcmConfigOverride | null): void {
    this.configOverride = override;
    this.tokenCache = null;
    this.inFlightTokenPromise = null;
  }

  /**
   * Resets in-memory cached OAuth2 access token.
   */
  static resetTokenCache(): void {
    this.tokenCache = null;
    this.inFlightTokenPromise = null;
  }

  /**
   * Resolves effective FCM configuration (override or application config).
   */
  private static getEffectiveConfig(): { projectId: string; clientEmail: string; privateKey: string } {
    return {
      projectId: this.configOverride?.projectId ?? config.fcm.projectId,
      clientEmail: this.configOverride?.clientEmail ?? config.fcm.clientEmail,
      privateKey: this.configOverride?.privateKey ?? config.fcm.privateKey,
    };
  }

  /**
   * Determine if FCM credentials have been fully provisioned in environment.
   */
  static isConfigured(): boolean {
    const { projectId, clientEmail, privateKey } = this.getEffectiveConfig();
    return Boolean(projectId && clientEmail && privateKey);
  }

  /**
   * Generates or retrieves cached Google OAuth2 Bearer Access Token for FCM HTTP v1.
   * Uses single in-flight promise synchronization for concurrent callers.
   */
  static async getAccessToken(): Promise<string> {
    const { clientEmail, privateKey } = this.getEffectiveConfig();

    if (!clientEmail || !privateKey) {
      throw new Error('FCM credentials are not configured.');
    }

    // Return cached token if valid (with 5-minute safety buffer)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.accessToken;
    }

    if (this.inFlightTokenPromise) {
      return this.inFlightTokenPromise;
    }

    this.inFlightTokenPromise = this.requestNewAccessToken(clientEmail, privateKey).finally(() => {
      this.inFlightTokenPromise = null;
    });

    return this.inFlightTokenPromise;
  }

  /**
   * Exchanges RS256-signed JWT assertion against Google OAuth2 token endpoint.
   * Note: 'sub' claim is omitted unless domain-wide delegation is explicitly required.
   */
  private static async requestNewAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600, // 1 hour expiration
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    };

    let signedAssertion: string;
    try {
      signedAssertion = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    } catch (err: any) {
      throw new Error(`Failed to sign Google OAuth assertion JWT: ${err.message}`);
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const bodyParams = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await this.fetchClient(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
        signal: controller.signal,
      });

      const data = await response.json() as any;

      if (!response.ok || !data.access_token) {
        const errorMsg = data?.error_description || data?.error || `HTTP ${response.status}`;
        throw new Error(`Google OAuth2 token exchange failed: ${errorMsg}`);
      }

      const expiresInSeconds = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      this.tokenCache = {
        accessToken: data.access_token,
        expiresAt: Date.now() + Math.max(60, expiresInSeconds - 300) * 1000,
      };

      return data.access_token;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Dispatches push notification to a single device token via genuine FCM HTTP v1.
   * Handles authentication, retry, timeouts, and invalid token deactivation.
   * Never fabricates message IDs or returns mock success.
   */
  static async sendPush(payload: PushPayload): Promise<PushResult> {
    if (!payload.token || typeof payload.token !== 'string' || !payload.token.trim()) {
      return { success: false, error: 'Invalid device token.', skipped: false };
    }

    const cleanToken = payload.token.trim();

    // Explicit behavior when FCM credentials are not configured:
    // Returns skipped = true, success = false without fabricating IDs
    if (!this.isConfigured()) {
      if (config.isProduction) {
        console.warn('[FCM-PROVIDER] [WARNING] Firebase Cloud Messaging credentials are not configured in production. Push delivery is disabled.');
      } else if (process.env.NODE_ENV !== 'test') {
        console.log(`[FCM-PROVIDER] [SKIPPED] FCM credentials not configured. Notification to ${this.maskToken(cleanToken)} skipped.`);
      }
      return {
        success: false,
        skipped: true,
        error: 'FCM push skipped: Google Service Account credentials are not configured in environment.',
      };
    }

    const { projectId } = this.getEffectiveConfig();
    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    let attempt = 0;
    const maxAttempts = 3; // 1 initial attempt + up to 2 retries

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const accessToken = await this.getAccessToken();

        const fcmPayload: any = {
          message: {
            token: cleanToken,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            android: {
              priority: 'HIGH',
            },
          },
        };

        if (payload.data && Object.keys(payload.data).length > 0) {
          const stringifiedData: Record<string, string> = {};
          for (const [k, v] of Object.entries(payload.data)) {
            stringifiedData[k] = typeof v === 'string' ? v : String(v);
          }
          fcmPayload.message.data = stringifiedData;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        let response: Response;
        try {
          response = await this.fetchClient(fcmEndpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(fcmPayload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const resData = await response.json() as any;

        if (response.ok && resData && resData.name) {
          // Genuine FCM message ID received (e.g. projects/{projectId}/messages/{messageId})
          return {
            success: true,
            messageId: resData.name,
            skipped: false,
          };
        }

        // Handle error responses from FCM
        const errObj = resData?.error || {};
        const statusCode = response.status;
        const errStatus = errObj.status || '';
        const errMsg = errObj.message || `FCM HTTP Error ${statusCode}`;

        // Deactivate token ONLY when the response specifically identifies an unregistered or invalid token.
        // DO NOT deactivate solely because statusCode is 404 (which could be an invalid project or URL).
        const isUnregistered =
          (Array.isArray(errObj.details) &&
            errObj.details.some(
              (d: any) => d.errorCode === 'UNREGISTERED' || d.errorCode === 'INVALID_ARGUMENT'
            )) ||
          errStatus === 'UNREGISTERED' ||
          (typeof errMsg === 'string' &&
            (errMsg.includes('registration-token-not-registered') ||
              errMsg.toLowerCase().includes('not registered') ||
              errMsg.toLowerCase().includes('invalid registration token')));

        if (isUnregistered) {
          // Deactivate token in database to prevent future failed deliveries
          try {
            await prisma.pushDeviceToken.updateMany({
              where: { token: cleanToken },
              data: { isActive: false },
            });
          } catch (dbErr: any) {
            console.warn(`[FCM-PROVIDER] Failed to deactivate unregistered token: ${dbErr?.message}`);
          }

          return {
            success: false,
            error: 'Device token is invalid or unregistered.',
            errorCode: 'UNREGISTERED',
            skipped: false,
          };
        }

        // On 401/403: auth failure, clear token cache and retry if attempts remain
        if ((statusCode === 401 || statusCode === 403) && attempt < maxAttempts) {
          this.resetTokenCache();
          continue;
        }

        // On 429 (rate limit) or 5xx (server error): retry with bounded exponential backoff
        if ((statusCode === 429 || statusCode >= 500) && attempt < maxAttempts) {
          let delayMs = Math.min(500 * Math.pow(2, attempt - 1), 3000);
          const retryAfterHeader = response.headers?.get?.('retry-after') || response.headers?.get?.('Retry-After');
          if (retryAfterHeader) {
            const parsedSec = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSec) && parsedSec > 0) {
              delayMs = Math.min(parsedSec * 1000, 5000);
            }
          }
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        return {
          success: false,
          error: errMsg,
          errorCode: errStatus || `HTTP_${statusCode}`,
          skipped: false,
        };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return {
            success: false,
            error: 'FCM push request timed out after 10000ms.',
            errorCode: 'TIMEOUT',
            skipped: false,
          };
        }

        if (attempt < maxAttempts && !err.message?.includes('credentials')) {
          const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 3000);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        return {
          success: false,
          error: err.message || 'Unknown FCM delivery error.',
          skipped: false,
        };
      }
    }

    return {
      success: false,
      error: 'FCM delivery failed after retry attempts.',
      skipped: false,
    };
  }

  /**
   * Dispatches push notifications to multiple device tokens.
   */
  static async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ sent: number; failed: number; skipped: number; results: PushResult[] }> {
    if (!tokens || tokens.length === 0) {
      return { sent: 0, failed: 0, skipped: 0, results: [] };
    }

    const results: PushResult[] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const token of tokens) {
      const res = await this.sendPush({ token, title, body, data });
      results.push(res);
      if (res.skipped) {
        skipped++;
      } else if (res.success) {
        sent++;
      } else {
        failed++;
      }
    }

    return { sent, failed, skipped, results };
  }
}
