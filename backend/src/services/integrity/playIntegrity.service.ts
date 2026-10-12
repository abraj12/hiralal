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

export type IntegrityAction =
  | 'BILL_UPLOAD'
  | 'PAYOUT_REDEEM'
  | 'KYC_SUBMIT'
  | 'AUTH'
  | 'REGISTRATION'
  | 'FORGOT_PASSWORD'
  | 'BENEFICIARY_VERIFY'
  | 'GENERAL'
  | 'ACCOUNT_DELETION'
  | 'ACCOUNT_DELETION_REQUEST'
  | 'ACCOUNT_DELETION_CONFIRM';

export interface ActionNonceContext {
  userId?: string;
  sessionId?: string | null;
  action: IntegrityAction;
  requestHash?: string;
}

export interface NonceMetadata extends ActionNonceContext {
  nonce: string;
  expiresAt: number;
}

// In-memory fallback cache when Redis is unavailable
const memoryNonceStore = new Map<string, NonceMetadata>();

// Clean up expired memory nonces every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [nonce, metadata] of memoryNonceStore.entries()) {
    if (metadata.expiresAt <= now) {
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
  enforceActions?: boolean;
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
  private static enforceActionsOverride: boolean | null = null;

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
   * Controls whether action integrity attestation is strictly enforced.
   * In production or staging, enforcement is permanently active and cannot be disabled.
   */
  static setEnforceActions(enforce: boolean | null): void {
    const isProdOrStaging =
      (config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') &&
      process.env.NODE_ENV !== 'test';

    if (isProdOrStaging && enforce === false) {
      throw new Error('Integrity action enforcement cannot be disabled in production or staging.');
    }
    this.enforceActionsOverride = enforce;
  }

  /**
   * Checks whether integrity action enforcement is currently active.
   */
  static isEnforcingActions(): boolean {
    const isProdOrStaging =
      (config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') &&
      process.env.NODE_ENV !== 'test';

    if (isProdOrStaging) {
      return true;
    }
    if (this.enforceActionsOverride !== null) {
      return this.enforceActionsOverride;
    }
    return (
      this.configOverride?.enforceActions ??
      config.playIntegrity?.enforceActions ??
      process.env.PLAY_INTEGRITY_ENFORCE_ACTIONS === 'true'
    );
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
   * Validates whether a given string is a syntactically valid SHA-256 hex digest.
   * Supports standard 64-hex format or colon-delimited fingerprints.
   */
  static isValidSha256Fingerprint(fingerprint: string): boolean {
    if (!fingerprint || typeof fingerprint !== 'string') return false;
    const normalized = fingerprint.replace(/[: -]/g, '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized);
  }

  /**
   * Validates production configuration for certificate digests and fail-closed policies.
   */
  static validateProductionConfiguration(configToCheck: {
    clientEmail: string;
    privateKey: string;
    packageName: string;
    allowedCertificateDigests: string[];
    allowMock: boolean;
  }): { valid: boolean; error?: string } {
    const isProdOrStaging =
      config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

    if (isProdOrStaging) {
      // Mock mode is strictly forbidden in production and staging
      if (configToCheck.allowMock) {
        return {
          valid: false,
          error: 'Mock mode (PLAY_INTEGRITY_ALLOW_MOCK) is strictly forbidden in production and staging environments.',
        };
      }

      // Certificate allowlist is required in production
      if (!configToCheck.allowedCertificateDigests || configToCheck.allowedCertificateDigests.length === 0) {
        return {
          valid: false,
          error:
            'Production configuration error: PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS must contain at least one valid SHA-256 certificate digest in production.',
        };
      }

      for (const digest of configToCheck.allowedCertificateDigests) {
        if (!this.isValidSha256Fingerprint(digest)) {
          return {
            valid: false,
            error: `Production configuration error: Malformed SHA-256 certificate digest "${digest}". Expected 64 hex characters.`,
          };
        }
      }
    }

    return { valid: true };
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
    enforceActions: boolean;
  } {
    const isProdOrStaging =
      config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

    const rawAllowMock =
      this.configOverride?.allowMock ??
      config.playIntegrity?.allowMock ??
      (process.env.PLAY_INTEGRITY_ALLOW_MOCK === 'true');

    // In production or staging, mock mode is strictly forced to false
    const allowMock = isProdOrStaging ? false : rawAllowMock;

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
      allowMock,
      requireLicensing:
        this.configOverride?.requireLicensing ??
        config.playIntegrity?.requireLicensing ??
        (process.env.PLAY_INTEGRITY_REQUIRE_LICENSING === 'true'),
      enforceActions: this.isEnforcingActions(),
    };
  }

  /**
   * Generates a cryptographically secure, single-use, URL-safe Base64 nonce bound to optional action and session context.
   */
  static async generateNonce(
    context?: Partial<ActionNonceContext>
  ): Promise<{ nonce: string; expiresAt: string; action: IntegrityAction }> {
    const isProdOrStaging =
      (config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') &&
      process.env.NODE_ENV !== 'test';

    if (isProdOrStaging && !isRedisReady()) {
      throw new Error(
        'Shared Redis storage is required for integrity nonces in production and staging environments.'
      );
    }

    const rawBytes = crypto.randomBytes(32);
    const nonce = rawBytes.toString('base64url');
    const expiresAtMs = Date.now() + this.NONCE_TTL_SECONDS * 1000;
    const expiresAt = new Date(expiresAtMs);
    const action: IntegrityAction = context?.action || 'GENERAL';

    const metadata: NonceMetadata = {
      nonce,
      userId: context?.userId,
      sessionId: context?.sessionId,
      action,
      requestHash: context?.requestHash ? context.requestHash.toLowerCase() : undefined,
      expiresAt: expiresAtMs,
    };

    const key = `integrity:nonce:${nonce}`;
    const value = JSON.stringify(metadata);

    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        await redis.set(key, value, 'EX', this.NONCE_TTL_SECONDS);
      } catch (err: any) {
        if (isProdOrStaging) {
          throw new Error(`Failed to store integrity nonce in Redis: ${err.message}`);
        }
        memoryNonceStore.set(nonce, metadata);
      }
    } else {
      memoryNonceStore.set(nonce, metadata);
    }

    return {
      nonce,
      expiresAt: expiresAt.toISOString(),
      action,
    };
  }

  /**
   * Validates and atomically consumes a single-use nonce to prevent replay attacks,
   * verifying bound user, session, action, and request-hash context.
   */
  static async consumeNonce(
    nonce: string,
    expectedContext?: Partial<ActionNonceContext>
  ): Promise<{ valid: boolean; metadata?: NonceMetadata; error?: string }> {
    if (!nonce || typeof nonce !== 'string' || nonce.length < 16) {
      return { valid: false, error: 'Nonce is required and must be at least 16 characters.' };
    }

    const isProdOrStaging =
      (config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') &&
      process.env.NODE_ENV !== 'test';

    const key = `integrity:nonce:${nonce}`;
    let rawMetadata: string | null = null;
    let memoryEntry: NonceMetadata | null = null;

    if (isRedisReady()) {
      try {
        const redis = getRedisClient();
        // Atomic fetch and delete via Lua script: exactly one concurrent request can consume the nonce
        const atomicGetAndDelete = `
          local value = redis.call('GET', KEYS[1])
          if value then
            redis.call('DEL', KEYS[1])
          end
          return value
        `;
        const fetched = await redis.eval(atomicGetAndDelete, 1, key);
        rawMetadata = typeof fetched === 'string' ? fetched : null;
      } catch (err: any) {
        if (isProdOrStaging) {
          return {
            valid: false,
            error: `Shared Redis error during nonce consumption: ${err.message}`,
          };
        }
      }
    } else if (isProdOrStaging) {
      // In production/staging, memory fallback is strictly prohibited
      return {
        valid: false,
        error: 'Shared Redis storage is required for integrity nonces in production and staging environments.',
      };
    }

    // In non-production environments only, check memory fallback if Redis was not used/available
    if (!isProdOrStaging && !rawMetadata && memoryNonceStore.has(nonce)) {
      memoryEntry = memoryNonceStore.get(nonce)!;
      memoryNonceStore.delete(nonce);
    }

    let metadata: NonceMetadata;
    if (rawMetadata) {
      try {
        metadata = JSON.parse(rawMetadata);
      } catch {
        return { valid: false, error: 'Corrupted nonce metadata.' };
      }
    } else if (memoryEntry) {
      metadata = memoryEntry;
    } else {
      return { valid: false, error: 'Invalid, expired, or replayed integrity nonce.' };
    }

    // Expiry check
    if (metadata.expiresAt <= Date.now()) {
      return { valid: false, error: 'Integrity nonce has expired.' };
    }

    // Action binding check - strictly compare whenever expected action is provided
    // (a GENERAL nonce must NEVER pass as a protected action like BILL_UPLOAD, KYC_SUBMIT, PAYOUT_REDEEM)
    if (expectedContext?.action) {
      if (metadata.action !== expectedContext.action) {
        return {
          valid: false,
          error: `Integrity nonce was issued for action ${metadata.action}, but presented for ${expectedContext.action}.`,
        };
      }
    }

    const isProtectedAction =
      expectedContext?.action &&
      ['BILL_UPLOAD', 'KYC_SUBMIT', 'PAYOUT_REDEEM'].includes(expectedContext.action);

    // User binding check
    if (expectedContext?.userId) {
      if (!metadata.userId || metadata.userId !== expectedContext.userId) {
        return {
          valid: false,
          error: 'Integrity nonce was issued for a different user.',
        };
      }
    }

    // Session binding check
    if (expectedContext?.sessionId) {
      if (!metadata.sessionId || metadata.sessionId !== expectedContext.sessionId) {
        return {
          valid: false,
          error: 'Integrity nonce was issued for a different user session.',
        };
      }
    }

    // Request hash binding check: mandatory for protected actions
    if (isProtectedAction) {
      if (!expectedContext?.requestHash || !metadata.requestHash) {
        return {
          valid: false,
          error: 'Integrity nonce request hash is required for protected actions.',
        };
      }
      if (expectedContext.requestHash.toLowerCase() !== metadata.requestHash.toLowerCase()) {
        return {
          valid: false,
          error: 'Integrity nonce requestHash mismatch.',
        };
      }
    } else if (expectedContext?.requestHash || metadata.requestHash) {
      if (
        !expectedContext?.requestHash ||
        !metadata.requestHash ||
        expectedContext.requestHash.toLowerCase() !== metadata.requestHash.toLowerCase()
      ) {
        return {
          valid: false,
          error: 'Integrity nonce requestHash mismatch.',
        };
      }
    }

    return { valid: true, metadata };
  }

  /**
   * Determine if live Google Play API credentials are fully configured.
   * Rejects empty strings, partial configurations, and placeholder/example values.
   */
  static isConfigured(): boolean {
    const effectiveConfig = this.getEffectiveConfig();
    const { clientEmail, privateKey, packageName } = effectiveConfig;
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
   * Constructs standard Google Service Account OAuth2 JWT assertion claims.
   * NOTE: The `sub` claim is strictly omitted for normal server-to-server authentication
   * to prevent accidental domain-wide delegation requests.
   */
  static createAssertionPayload(clientEmail: string, now: number = Math.floor(Date.now() / 1000)): Record<string, any> {
    return {
      iss: clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/playintegrity',
    };
  }

  /**
   * Exchanges RS256-signed JWT assertion against Google OAuth2 token endpoint.
   */
  private static async requestNewAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = this.createAssertionPayload(clientEmail, now);

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
        d.trim().toLowerCase().replace(/[: -]/g, '')
      );
      const normalizedAllowed = effectiveConfig.allowedCertificateDigests.map((d) =>
        d.trim().toLowerCase().replace(/[: -]/g, '')
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
   * Verifies an integrity token from the mobile app against the consumed single-use nonce,
   * validating bound action and user context.
   */
  static async verifyActionToken(params: {
    nonce: string;
    integrityToken: string;
    expectedContext?: Partial<ActionNonceContext>;
  }): Promise<PlayIntegrityVerdict> {
    const { nonce, integrityToken, expectedContext } = params;

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

    // 1. Consume nonce atomically with action and session context check
    const consumption = await this.consumeNonce(nonce, expectedContext);
    if (!consumption.valid) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: consumption.error || 'Invalid, expired, or replayed integrity nonce.',
      };
    }

    const effectiveConfig = this.getEffectiveConfig();

    // 2. Behavior when credentials are unset / incomplete
    if (!this.isConfigured()) {
      const isProdOrStaging =
        config.isProduction || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

      if (isProdOrStaging) {
        return {
          success: false,
          isRealDevice: false,
          isLicensed: false,
          appRecognitionVerdict: 'UNEVALUATED',
          deviceRecognitionVerdict: [],
          error:
            'Play Integrity credentials are not configured on the production server. Mobile integrity validation failed closed.',
        };
      }

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

    // 3. Validate production configuration when credentials are configured
    const prodConfigCheck = this.validateProductionConfiguration(effectiveConfig);
    if (!prodConfigCheck.valid) {
      return {
        success: false,
        isRealDevice: false,
        isLicensed: false,
        appRecognitionVerdict: 'UNEVALUATED',
        deviceRecognitionVerdict: [],
        error: prodConfigCheck.error,
      };
    }

    // 4. Genuine Google Play Integrity Verification
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

  /**
   * Verifies an integrity token from the mobile app against the consumed single-use nonce.
   */
  static async verifyToken(params: {
    nonce: string;
    integrityToken: string;
  }): Promise<PlayIntegrityVerdict> {
    return this.verifyActionToken(params);
  }
}
