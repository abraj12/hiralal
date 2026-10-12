/**
 * Play Integrity Service Adapter
 *
 * Implements Google Play Integrity anti-tampering verification for Android mobile app requests.
 * Generates single-use nonces and verifies signed integrity tokens via Google Play Integrity API
 * (https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken) using Google Service Account OAuth.
 *
 * NOTE: Live Google Play Integrity in production requires Google Play Console linked Cloud Project credentials.
 * Status: NOT VERIFIED in live environment until production Google Service Account is configured.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config, isPlaceholderCredential } from '../../config';
import { getRedisClient, isRedisReady } from '../../redis';

// In-memory fallback cache when Redis is unavailable
const memoryNonceStore = new Map<string, number>();

// Clean up expired memory nonces every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiresAt] of memoryNonceStore.entries()) {
    if (expiresAt <= now) {
      memoryNonceStore.delete(nonce);
    }
  }
}, 60000).unref();

export interface PlayIntegrityVerdict {
  success: boolean;
  isRealDevice: boolean;
  isLicensed: boolean;
  appRecognitionVerdict: string;
  deviceRecognitionVerdict: string[];
  simulated?: boolean;
  appVersionCode?: string;
  error?: string;
}

export interface PlayIntegrityConfigOverride {
  clientEmail?: string;
  privateKey?: string;
  packageName?: string;
  allowedCertificateDigests?: string[];
  allowMock?: boolean;
  requireLicensing?: boolean;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class PlayIntegrityService {
  private static NONCE_TTL_SECONDS = 300; // 5 minutes
  private static tokenCache: TokenCache | null = null;
  private static inFlightTokenPromise: Promise<string> | null = null;
  private static fetchClient: typeof fetch = globalThis.fetch;
  private static configOverride: PlayIntegrityConfigOverride | null = null;

  /**
   * Injects custom fetch client for unit and integration testing.
   */
  static setFetchClient(client: typeof fetch | null): void {
    this.fetchClient = client || globalThis.fetch;
  }

  /**
   * Overrides Play Integrity configuration for testing without modifying global config.
   */
  static overrideConfig(override: PlayIntegrityConfigOverride | null): void {
    this.configOverride = override;
    this.tokenCache = null;
    this.inFlightTokenPromise = null;
  }

  /**
   * Clears the cached OAuth2 access token.
   */
  static resetTokenCache(): void {
    this.tokenCache = null;
    this.inFlightTokenPromise = null;
  }

  /**
   * Clears all in-memory nonces.
   */
  static clearMemoryNonces(): void {
    memoryNonceStore.clear();
  }

  /**
   * Resolves effective Play Integrity configuration (override or application config).
   */
  static getEffectiveConfig(): {
    clientEmail: string;
    privateKey: string;
    packageName: string;
    allowedCertificateDigests: string[];
    allowMock: boolean;
    requireLicensing: boolean;
  } {
    return {
      clientEmail:
        this.configOverride?.clientEmail ??
        config.playIntegrity?.clientEmail ??
        (process.env.PLAY_INTEGRITY_CLIENT_EMAIL || ''),
      privateKey:
        this.configOverride?.privateKey ??
        config.playIntegrity?.privateKey ??
        (process.env.PLAY_INTEGRITY_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      packageName:
        this.configOverride?.packageName ??
        config.playIntegrity?.packageName ??
        (process.env.PLAY_INTEGRITY_PACKAGE_NAME || 'com.hiralal.rewards'),
      allowedCertificateDigests:
        this.configOverride?.allowedCertificateDigests ??
        config.playIntegrity?.allowedCertificateDigests ??
        (process.env.PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS || '')
          .split(',')
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
      allowMock:
        this.configOverride?.allowMock ??
        config.playIntegrity?.allowMock ??
        (process.env.PLAY_INTEGRITY_ALLOW_MOCK === 'true'),
      requireLicensing:
        this.configOverride?.requireLicensing ??
        config.playIntegrity?.requireLicensing ??
        (process.env.PLAY_INTEGRITY_REQUIRE_LICENSING === 'true'),
    };
  }

  /**
   * Generates a cryptographically secure, single-use, URL-safe Base64 nonce.
   */
  static async generateNonce(): Promise<{ nonce: string; expiresAt: string }> {
    const rawBytes = crypto.randomBytes(32);
    const nonce = rawBytes.toString('base64url');
    const expiresAt = new Date(Date.now() + this.NONCE_TTL_SECONDS * 1000);

    const key = `integrity:nonce:${nonce}`;
    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        await redis.set(key, '1', 'EX', this.NONCE_TTL_SECONDS);
      } catch (err) {
        memoryNonceStore.set(nonce, expiresAt.getTime());
      }
    } else {
      memoryNonceStore.set(nonce, expiresAt.getTime());
    }

    return {
      nonce,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Validates and consumes a single-use nonce to prevent replay attacks.
   */
  private static async consumeNonce(nonce: string): Promise<boolean> {
    if (!nonce || typeof nonce !== 'string' || nonce.length < 16) {
      return false;
    }

    const key = `integrity:nonce:${nonce}`;
    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        const deleted = await redis.del(key);
        if (deleted === 1) return true;
      } catch {
        // Fallback to memory
      }
    }

    if (memoryNonceStore.has(nonce)) {
      const expiresAt = memoryNonceStore.get(nonce)!;
      memoryNonceStore.delete(nonce);
      return expiresAt > Date.now();
    }

    return false;
  }

  /**
   * Determine if live Google Play API credentials are fully configured.
   * Rejects empty strings, partial configurations, and placeholder/example values.
   */
  static isConfigured(): boolean {
    const { clientEmail, privateKey, packageName } = this.getEffectiveConfig();
    if (!clientEmail || !privateKey || !packageName) return false;
    if (
      isPlaceholderCredential(clientEmail) ||
      isPlaceholderCredential(privateKey) ||
      isPlaceholderCredential(packageName)
    ) {
      return false;
    }
    if (!clientEmail.includes('@')) return false;
    if (!privateKey.includes('PRIVATE KEY')) return false;
    return true;
  }

  /**
   * Retrieves or generates cached Google OAuth2 Bearer Access Token for Play Integrity.
   */
  static async getAccessToken(): Promise<string> {
    const { clientEmail, privateKey } = this.getEffectiveConfig();

    if (!clientEmail || !privateKey) {
      throw new Error('Play Integrity credentials are not configured.');
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
   */
  private static async requestNewAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: clientEmail,
      sub: clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/playintegrity',
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

      const data = (await response.json().catch(() => null)) as any;

      if (!response.ok || !data?.access_token) {
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
   * Calls Google Play Integrity decodeIntegrityToken API.
   */
  private static async decodeIntegrityToken(
    packageName: string,
    integrityToken: string,
    accessToken: string
  ): Promise<any> {
    const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await this.fetchClient(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ integrity_token: integrityToken }),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => null)) as any;

      if (!response.ok) {
        const errorMsg = data?.error?.message || data?.error_description || `HTTP ${response.status}`;
        throw new Error(`Google Play Integrity API rejected token: ${errorMsg}`);
      }

      if (!data || !data.tokenPayloadExternal) {
        throw new Error('Google Play Integrity API returned invalid or empty tokenPayloadExternal');
      }

      return data.tokenPayloadExternal;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Evaluates decoded Play Integrity token payload against strict security rules.
   */
  private static evaluateIntegrityPayload(
    payload: any,
    expectedNonce: string,
    effectiveConfig: {
      packageName: string;
      allowedCertificateDigests: string[];
      requireLicensing: boolean;
    }
  ): PlayIntegrityVerdict {
    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: 'Google Play Integrity API returned an empty or invalid payload.',
      };
    }

    const requestDetails = payload.requestDetails || {};
    const appIntegrity = payload.appIntegrity || {};
    const deviceIntegrity = payload.deviceIntegrity || {};
    const accountDetails = payload.accountDetails || {};

    const appRecognitionVerdict = appIntegrity.appRecognitionVerdict || 'UNEVALUATED';
    const deviceRecognitionVerdict: string[] = Array.isArray(deviceIntegrity.deviceRecognitionVerdict)
      ? deviceIntegrity.deviceRecognitionVerdict
      : [];
    const isLicensed = accountDetails.appLicensingVerdict === 'LICENSED';

    // 1. Package Name Validation
    const returnedPackage = requestDetails.requestPackageName;
    if (!returnedPackage || returnedPackage !== effectiveConfig.packageName) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: `Package name mismatch in integrity payload: expected ${effectiveConfig.packageName}, received ${returnedPackage || 'none'}.`,
      };
    }

    // 2. Nonce Match Validation
    const returnedNonce = requestDetails.nonce;
    if (!returnedNonce || returnedNonce !== expectedNonce) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: 'Integrity payload nonce mismatch.',
      };
    }

    // 3. Timestamp Freshness Validation (within 5 minutes tolerance)
    const timestampMillis = Number(requestDetails.timestampMillis);
    if (!timestampMillis || isNaN(timestampMillis)) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: 'Missing or invalid timestampMillis in integrity payload.',
      };
    }

    const now = Date.now();
    const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
    if (Math.abs(now - timestampMillis) > MAX_AGE_MS) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: 'Integrity token timestamp is stale or clock skew exceeded 5 minutes.',
      };
    }

    // 4. App Recognition Verdict
    if (appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
      return {
        success: false,
        isRealDevice: false,
        isLicensed,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: `App recognition verdict failed: ${appRecognitionVerdict}.`,
      };
    }

    // 5. App Certificate SHA-256 Digest Validation (if configured)
    if (effectiveConfig.allowedCertificateDigests && effectiveConfig.allowedCertificateDigests.length > 0) {
      const rawPayloadDigests: string[] = Array.isArray(appIntegrity.certificateSha256Digest)
        ? appIntegrity.certificateSha256Digest
        : [];
      const normalizedPayloadDigests = rawPayloadDigests.map((d: string) =>
        d.trim().toLowerCase().replace(/:/g, '')
      );
      const normalizedAllowed = effectiveConfig.allowedCertificateDigests.map((d) =>
        d.trim().toLowerCase().replace(/:/g, '')
      );

      const hasMatchingCert = normalizedPayloadDigests.some((d: string) => normalizedAllowed.includes(d));
      if (!hasMatchingCert) {
        return {
          success: false,
          isRealDevice: false,
          isLicensed,
          appRecognitionVerdict,
          deviceRecognitionVerdict,
          error: 'App certificate digest does not match authorized certificate fingerprints.',
        };
      }
    }

    // 6. Device Recognition Verdict
    const meetsDevice =
      deviceRecognitionVerdict.includes('MEETS_DEVICE_INTEGRITY') ||
      deviceRecognitionVerdict.includes('MEETS_STRONG_INTEGRITY');

    if (!meetsDevice) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: 'Device integrity verdict unsatisfied. Device does not meet device integrity.',
      };
    }

    // 7. Account Licensing Verdict (when required)
    if (effectiveConfig.requireLicensing && !isLicensed) {
      return {
        success: false,
        isRealDevice: true,
        isLicensed: false,
        appRecognitionVerdict,
        deviceRecognitionVerdict,
        error: `App licensing verdict failed: ${accountDetails.appLicensingVerdict || 'UNLICENSED'}.`,
      };
    }

    // 8. Genuine Verification Passed
    return {
      success: true,
      isRealDevice: true,
      isLicensed,
      appRecognitionVerdict,
      deviceRecognitionVerdict,
      appVersionCode: appIntegrity.versionCode,
    };
  }

  /**
   * Verifies an integrity token from the mobile app against the consumed single-use nonce.
   */
  static async verifyToken(params: {
    nonce: string;
    integrityToken: string;
  }): Promise<PlayIntegrityVerdict> {
    const { nonce, integrityToken } = params;

    if (!nonce) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: 'Nonce is required.',
      };
    }

    if (!integrityToken) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: 'Integrity token is required.',
      };
    }

    // 1. Consume nonce atomically (single-use anti-replay)
    const isValidNonce = await this.consumeNonce(nonce);
    if (!isValidNonce) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: 'Invalid, expired, or replayed integrity nonce.',
      };
    }

    const effectiveConfig = this.getEffectiveConfig();

    // 2. Behavior when credentials are unset / incomplete
    if (!this.isConfigured()) {
      // Production MUST always fail closed
      if (config.isProduction || process.env.NODE_ENV === 'production') {
        return {
          success: false,
          isRealDevice: false,
          isLicensed: false,
          appRecognitionVerdict: 'UNEVALUATED',
          deviceRecognitionVerdict: [],
          error: 'Play Integrity credentials are not configured on the production server. Mobile integrity validation failed closed.',
        };
      }

      // Non-production allows mock ONLY if explicitly enabled
      if (effectiveConfig.allowMock) {
        if (process.env.NODE_ENV !== 'test') {
          console.log(
            '[PLAY-INTEGRITY] [MOCK] Verification succeeded in mock mode (credentials unconfigured). Status: NOT VERIFIED.'
          );
        }
        return {
          success: true,
          isRealDevice: true,
          isLicensed: true,
          appRecognitionVerdict: 'PLAY_RECOGNIZED',
          deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
          simulated: true,
        };
      }

      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: 'Play Integrity credentials are not configured and mock mode is not enabled.',
      };
    }

    // 3. Genuine Google Play Integrity Verification
    // Calls Google OAuth + decodeIntegrityToken
    try {
      const accessToken = await this.getAccessToken();
      const payload = await this.decodeIntegrityToken(
        effectiveConfig.packageName,
        integrityToken,
        accessToken
      );

      return this.evaluateIntegrityPayload(payload, nonce, effectiveConfig);
    } catch (err: any) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: `Play Integrity verification failed: ${err.message}`,
      };
    }
  }
}
