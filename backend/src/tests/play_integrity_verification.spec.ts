import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../server';
import { PlayIntegrityService, PlayIntegrityVerdict } from '../services/integrity/playIntegrity.service';
import { config } from '../config';

describe('Play Integrity Comprehensive Verification & Anti-Tamper Test Suite', () => {
  let validRsaPrivateKey: string;
  let validRsaPublicKey: string;

  const TEST_PACKAGE_NAME = 'com.hiralal.rewards';
  const TEST_CLIENT_EMAIL = 'play-integrity@hiralal-rewards.iam.gserviceaccount.com';
  const TEST_CERT_DIGEST = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

  beforeAll(() => {
    // Generate real 2048-bit RSA keypair for RS256 JWT signing tests
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    validRsaPrivateKey = keyPair.privateKey;
    validRsaPublicKey = keyPair.publicKey;
  });

  beforeEach(() => {
    PlayIntegrityService.overrideConfig(null);
    PlayIntegrityService.setFetchClient(null);
    PlayIntegrityService.resetTokenCache();
    PlayIntegrityService.clearMemoryNonces();
  });

  afterAll(() => {
    PlayIntegrityService.overrideConfig(null);
    PlayIntegrityService.setFetchClient(null);
    PlayIntegrityService.resetTokenCache();
  });

  // =========================================================================
  // 1. Cryptographic Nonce Generation & Single-Use Lifecycle
  // =========================================================================
  describe('1. Nonce Generation & Anti-Replay Lifecycle', () => {
    it('generates a URL-safe Base64 nonce with valid future expiresAt timestamp', async () => {
      const res = await PlayIntegrityService.generateNonce();
      expect(res.nonce).toBeDefined();
      expect(typeof res.nonce).toBe('string');
      expect(res.nonce.length).toBeGreaterThanOrEqual(32);
      expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects verification when nonce is missing or empty', async () => {
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: '',
        integrityToken: 'some_integrity_token',
      });
      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Nonce is required');
    });

    it('rejects verification when integrityToken is missing or empty', async () => {
      const nonceObj = await PlayIntegrityService.generateNonce();
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: '',
      });
      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Integrity token is required');
    });

    it('rejects verification with unknown or fabricated nonce', async () => {
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: 'fabricated_nonce_that_was_never_issued_1234567890',
        integrityToken: 'some_token',
      });
      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Invalid, expired, or replayed');
    });

    it('consumes nonce on first attempt and strictly rejects replay attempt', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
      const nonceObj = await PlayIntegrityService.generateNonce();

      // First use consumes nonce
      const firstVerdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token_attempt_1',
      });
      expect(firstVerdict.success).toBe(true);

      // Replay attempt with same nonce MUST fail
      const replayVerdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token_attempt_2',
      });
      expect(replayVerdict.success).toBe(false);
      expect(replayVerdict.error).toContain('Invalid, expired, or replayed');
    });

    it('action-bound nonces reject mismatched action attempts', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
      const nonceObj = await PlayIntegrityService.generateNonce({ action: 'BILL_UPLOAD' });
      expect(nonceObj.action).toBe('BILL_UPLOAD');

      // Attempt verification for different action (e.g. PAYOUT_REDEEM)
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: nonceObj.nonce,
        integrityToken: 'dummy_token',
        expectedContext: { action: 'PAYOUT_REDEEM' },
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Integrity nonce was issued for action BILL_UPLOAD, but presented for PAYOUT_REDEEM');
    });

    it('action-bound nonces reject mismatched user attempts', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'BILL_UPLOAD',
        userId: 'user_123',
      });

      // Attempt verification by different user
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: nonceObj.nonce,
        integrityToken: 'dummy_token',
        expectedContext: { action: 'BILL_UPLOAD', userId: 'user_456' },
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Integrity nonce was issued for a different user');
    });

    it('action-bound nonces reject mismatched session attempts', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'PAYOUT_REDEEM',
        sessionId: 'session_abc',
      });

      // Attempt verification by different session
      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: nonceObj.nonce,
        integrityToken: 'dummy_token',
        expectedContext: { action: 'PAYOUT_REDEEM', sessionId: 'session_xyz' },
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Integrity nonce was issued for a different user session');
    });

    it('action-bound nonces succeed when all context parameters match', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
      const nonceObj = await PlayIntegrityService.generateNonce({
        action: 'KYC_SUBMIT',
        userId: 'user_123',
        sessionId: 'session_abc',
      });

      const verdict = await PlayIntegrityService.verifyActionToken({
        nonce: nonceObj.nonce,
        integrityToken: 'dummy_token',
        expectedContext: {
          action: 'KYC_SUBMIT',
          userId: 'user_123',
          sessionId: 'session_abc',
        },
      });

      expect(verdict.success).toBe(true);
      expect(verdict.isRealDevice).toBe(true);
    });
  });

  // =========================================================================
  // 2. Environment Fail-Closed vs. Explicit Mock Policy
  // =========================================================================
  describe('2. Fail-Closed & Mock Mode Policy', () => {
    it('production mode ALWAYS fails closed when credentials are unconfigured', async () => {
      const savedEnv = process.env.NODE_ENV;
      const savedProd = config.isProduction;

      try {
        (config as any).isProduction = true;
        PlayIntegrityService.overrideConfig({ allowMock: true }); // Even if allowMock was requested

        const nonceObj = await PlayIntegrityService.generateNonce();
        const verdict = await PlayIntegrityService.verifyToken({
          nonce: nonceObj.nonce,
          integrityToken: 'token_prod_test',
        });

        expect(verdict.success).toBe(false);
        expect(verdict.isRealDevice).toBe(false);
        expect(verdict.error).toContain('Play Integrity credentials are not configured on the production server');
      } finally {
        (config as any).isProduction = savedProd;
        process.env.NODE_ENV = savedEnv;
      }
    });

    it('non-production environment with unconfigured credentials and allowMock=false fails closed', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: false });
      const nonceObj = await PlayIntegrityService.generateNonce();

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token_dev_test',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.isRealDevice).toBe(false);
      expect(verdict.error).toContain('mock mode is not enabled');
    });

    it('non-production environment with unconfigured credentials and allowMock=true returns simulated success', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });
      const nonceObj = await PlayIntegrityService.generateNonce();

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token_dev_mock',
      });

      expect(verdict.success).toBe(true);
      expect(verdict.isRealDevice).toBe(true);
      expect(verdict.isLicensed).toBe(true);
      expect(verdict.simulated).toBe(true);
      expect(verdict.appRecognitionVerdict).toBe('PLAY_RECOGNIZED');
      expect(verdict.deviceRecognitionVerdict).toContain('MEETS_DEVICE_INTEGRITY');
    });

    it('when credentials ARE configured, allowMock is IGNORED and real flow is executed', async () => {
      // Mock fetchClient that returns decoded token
      const mockFetch: typeof fetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'mock_google_oauth_token', expires_in: 3600 }),
          } as any;
        }
        if (urlStr.includes('decodeIntegrityToken')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tokenPayloadExternal: {
                requestDetails: {
                  requestPackageName: TEST_PACKAGE_NAME,
                  nonce: 'expected_nonce',
                  timestampMillis: String(Date.now()),
                },
                appIntegrity: {
                  appRecognitionVerdict: 'PLAY_RECOGNIZED',
                  versionCode: '101',
                },
                deviceIntegrity: {
                  deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
                },
                accountDetails: {
                  appLicensingVerdict: 'LICENSED',
                },
              },
            }),
          } as any;
        }
        throw new Error(`Unexpected URL in mockFetch: ${urlStr}`);
      };

      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
        allowMock: true, // Should be ignored because credentials are configured!
      });
      PlayIntegrityService.setFetchClient(mockFetch);

      const nonceObj = await PlayIntegrityService.generateNonce();
      // Replace nonce in mock response by re-creating mock fetch with the exact nonce:
      const fetchWithExactNonce: typeof fetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'mock_google_oauth_token', expires_in: 3600 }),
          } as any;
        }
        if (urlStr.includes('decodeIntegrityToken')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tokenPayloadExternal: {
                requestDetails: {
                  requestPackageName: TEST_PACKAGE_NAME,
                  nonce: nonceObj.nonce,
                  timestampMillis: String(Date.now()),
                },
                appIntegrity: {
                  appRecognitionVerdict: 'PLAY_RECOGNIZED',
                  versionCode: '101',
                },
                deviceIntegrity: {
                  deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
                },
                accountDetails: {
                  appLicensingVerdict: 'LICENSED',
                },
              },
            }),
          } as any;
        }
        throw new Error(`Unexpected URL: ${urlStr}`);
      };
      PlayIntegrityService.setFetchClient(fetchWithExactNonce);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'genuine_jwt_token',
      });

      expect(verdict.success).toBe(true);
      expect(verdict.simulated).toBeUndefined(); // MUST NOT have simulated flag
      expect(verdict.isRealDevice).toBe(true);
      expect(verdict.appVersionCode).toBe('101');
    });
  });

  // =========================================================================
  // 3. Credential Provisioning & isConfigured Checks
  // =========================================================================
  describe('3. Credential Validation & isConfigured', () => {
    it('rejects partial credentials, empty strings, and placeholder values', () => {
      // Empty
      PlayIntegrityService.overrideConfig({ clientEmail: '', privateKey: '', packageName: '' });
      expect(PlayIntegrityService.isConfigured()).toBe(false);

      // Placeholders
      PlayIntegrityService.overrideConfig({
        clientEmail: 'replace_with_email@google.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nreplace_me\n-----END PRIVATE KEY-----',
        packageName: 'your_package_name',
      });
      expect(PlayIntegrityService.isConfigured()).toBe(false);

      // Email missing @
      PlayIntegrityService.overrideConfig({
        clientEmail: 'invalid_email_format',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...\n-----END PRIVATE KEY-----',
        packageName: 'com.hiralal.rewards',
      });
      expect(PlayIntegrityService.isConfigured()).toBe(false);

      // Private key without PEM banner
      PlayIntegrityService.overrideConfig({
        clientEmail: 'valid@serviceaccount.com',
        privateKey: 'just_some_random_string',
        packageName: 'com.hiralal.rewards',
      });
      expect(PlayIntegrityService.isConfigured()).toBe(false);

      // Fully valid
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });
      expect(PlayIntegrityService.isConfigured()).toBe(true);
    });

    it('validates syntax of SHA-256 certificate digests correctly', () => {
      // 64 hex characters
      expect(PlayIntegrityService.isValidSha256Fingerprint('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(true);
      // Colon-separated 32 bytes
      expect(PlayIntegrityService.isValidSha256Fingerprint('AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00')).toBe(true);
      // Malformed: too short
      expect(PlayIntegrityService.isValidSha256Fingerprint('a1b2c3d4e5f6')).toBe(false);
      // Malformed: non-hex characters
      expect(PlayIntegrityService.isValidSha256Fingerprint('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
      // Empty
      expect(PlayIntegrityService.isValidSha256Fingerprint('')).toBe(false);
    });

    it('enforces production certificate pinning and fails closed when digest allowlist is missing or malformed', () => {
      const savedEnv = process.env.NODE_ENV;
      const savedProd = config.isProduction;

      try {
        (config as any).isProduction = true;
        process.env.NODE_ENV = 'production';

        // 1. Missing digests in production => fails closed
        const missingRes = PlayIntegrityService.validateProductionConfiguration({
          clientEmail: TEST_CLIENT_EMAIL,
          privateKey: validRsaPrivateKey,
          packageName: TEST_PACKAGE_NAME,
          allowedCertificateDigests: [],
          allowMock: false,
        });
        expect(missingRes.valid).toBe(false);
        expect(missingRes.error).toContain('must contain at least one valid SHA-256 certificate digest');

        // 2. Malformed digest in production => fails closed
        const malformedRes = PlayIntegrityService.validateProductionConfiguration({
          clientEmail: TEST_CLIENT_EMAIL,
          privateKey: validRsaPrivateKey,
          packageName: TEST_PACKAGE_NAME,
          allowedCertificateDigests: ['invalid_fingerprint_not_sha256'],
          allowMock: false,
        });
        expect(malformedRes.valid).toBe(false);
        expect(malformedRes.error).toContain('Malformed SHA-256 certificate digest');

        // 3. Mock enabled in production => fails closed
        const mockRes = PlayIntegrityService.validateProductionConfiguration({
          clientEmail: TEST_CLIENT_EMAIL,
          privateKey: validRsaPrivateKey,
          packageName: TEST_PACKAGE_NAME,
          allowedCertificateDigests: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'],
          allowMock: true,
        });
        expect(mockRes.valid).toBe(false);
        expect(mockRes.error).toContain('Mock mode (PLAY_INTEGRITY_ALLOW_MOCK) is strictly forbidden in production');

        // 4. Fully valid production configuration
        const validRes = PlayIntegrityService.validateProductionConfiguration({
          clientEmail: TEST_CLIENT_EMAIL,
          privateKey: validRsaPrivateKey,
          packageName: TEST_PACKAGE_NAME,
          allowedCertificateDigests: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'],
          allowMock: false,
        });
        expect(validRes.valid).toBe(true);
      } finally {
        (config as any).isProduction = savedProd;
        process.env.NODE_ENV = savedEnv;
      }
    });
  });

  // =========================================================================
  // 4. Google Service Account OAuth Flow & Token Caching
  // =========================================================================
  describe('4. Google OAuth2 Token Exchange & Caching', () => {
    it('fails when private key is invalid or corrupted RSA format', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: '-----BEGIN PRIVATE KEY-----\ncorrupted_data\n-----END PRIVATE KEY-----',
        packageName: TEST_PACKAGE_NAME,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Failed to sign Google OAuth assertion JWT');
    });

    it('fails when Google OAuth endpoint returns HTTP 401 or error response', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const mockFetch: typeof fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid_client', error_description: 'Unauthorized client' }),
      } as any);
      PlayIntegrityService.setFetchClient(mockFetch);

      const nonceObj = await PlayIntegrityService.generateNonce();
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Google OAuth2 token exchange failed: Unauthorized client');
    });

    it('caches access token and does not re-request token within expiry window', async () => {
      let oauthRequestCount = 0;
      let decodeRequestCount = 0;

      const nonceObj1 = await PlayIntegrityService.generateNonce();
      const nonceObj2 = await PlayIntegrityService.generateNonce();

      const mockFetch: typeof fetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          oauthRequestCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'cached_access_token_123', expires_in: 3600 }),
          } as any;
        }
        if (urlStr.includes('decodeIntegrityToken')) {
          decodeRequestCount++;
          const requestedNonce = decodeRequestCount === 1 ? nonceObj1.nonce : nonceObj2.nonce;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              tokenPayloadExternal: {
                requestDetails: {
                  requestPackageName: TEST_PACKAGE_NAME,
                  nonce: requestedNonce,
                  timestampMillis: String(Date.now()),
                },
                appIntegrity: {
                  appRecognitionVerdict: 'PLAY_RECOGNIZED',
                },
                deviceIntegrity: {
                  deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
                },
                accountDetails: {
                  appLicensingVerdict: 'LICENSED',
                },
              },
            }),
          } as any;
        }
        throw new Error(`Unexpected URL: ${urlStr}`);
      };

      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });
      PlayIntegrityService.setFetchClient(mockFetch);

      // Call 1
      const verdict1 = await PlayIntegrityService.verifyToken({
        nonce: nonceObj1.nonce,
        integrityToken: 'first_token',
      });
      expect(verdict1.success).toBe(true);
      expect(oauthRequestCount).toBe(1);
      expect(decodeRequestCount).toBe(1);

      // Call 2 within TTL
      const verdict2 = await PlayIntegrityService.verifyToken({
        nonce: nonceObj2.nonce,
        integrityToken: 'second_token',
      });
      expect(verdict2.success).toBe(true);
      // OAuth endpoint MUST NOT be called again; token was cached!
      expect(oauthRequestCount).toBe(1);
      expect(decodeRequestCount).toBe(2);
    });

    it('signs RS256 assertion without sub claim to prevent accidental domain-wide delegation', async () => {
      let capturedAssertion = '';

      const mockFetch: typeof fetch = async (_input: any, init?: any) => {
        const body = init?.body ? String(init.body) : '';
        const params = new URLSearchParams(body);
        capturedAssertion = params.get('assertion') || '';

        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'mock_token', expires_in: 3600 }),
        } as any;
      };

      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });
      PlayIntegrityService.setFetchClient(mockFetch);

      const token = await PlayIntegrityService.getAccessToken();
      expect(token).toBe('mock_token');
      expect(capturedAssertion).toBeTruthy();

      // Decode the captured assertion JWT and verify claims
      const decoded: any = jwt.decode(capturedAssertion, { complete: true });
      expect(decoded).toBeTruthy();
      expect(decoded.header.alg).toBe('RS256');

      const claims = decoded.payload;
      expect(claims.iss).toBe(TEST_CLIENT_EMAIL);
      expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
      expect(claims.scope).toBe('https://www.googleapis.com/auth/playintegrity');
      expect(typeof claims.iat).toBe('number');
      expect(claims.exp).toBe(claims.iat + 3600);

      // CRITICAL: sub claim MUST NOT be present for normal service account OAuth!
      expect(claims.sub).toBeUndefined();
      expect(claims).not.toHaveProperty('sub');

      // Also verify createAssertionPayload directly
      const payload = PlayIntegrityService.createAssertionPayload(TEST_CLIENT_EMAIL, claims.iat);
      expect(payload.sub).toBeUndefined();
      expect(payload).not.toHaveProperty('sub');
      expect(payload.iss).toBe(TEST_CLIENT_EMAIL);
      expect(payload.aud).toBe('https://oauth2.googleapis.com/token');
      expect(payload.scope).toBe('https://www.googleapis.com/auth/playintegrity');
    });
  });

  // =========================================================================
  // 5. Google Play Integrity API Communication Errors
  // =========================================================================
  describe('5. Google Play Integrity API Error Handling', () => {
    it('handles Google Play Integrity API HTTP 403 Forbidden', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const mockFetch: typeof fetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'valid_token', expires_in: 3600 }),
          } as any;
        }
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { message: 'Caller does not have permission' } }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const nonceObj = await PlayIntegrityService.generateNonce();
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Caller does not have permission');
    });

    it('handles empty or malformed tokenPayloadExternal response from Google', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const mockFetch: typeof fetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'valid_token', expires_in: 3600 }),
          } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}), // Missing tokenPayloadExternal
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const nonceObj = await PlayIntegrityService.generateNonce();
      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('invalid or empty tokenPayloadExternal');
    });
  });

  // =========================================================================
  // 6. Decoded Payload Security Checks (Negative & Positive)
  // =========================================================================
  describe('6. Decoded Payload Verdict Verification Rules', () => {
    const createMockWithPayload = (payloadModifier: (nonce: string) => any) => {
      return async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'valid_token', expires_in: 3600 }),
          } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: payloadModifier('placeholder_nonce'),
          }),
        } as any;
      };
    };

    it('rejects when requestPackageName does not match configured package', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: 'com.attacker.counterfeit',
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'attacker_token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Package name mismatch');
    });

    it('rejects when decoded nonce does not match the consumed nonce', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: 'different_nonce_from_replay_or_man_in_the_middle',
                timestampMillis: String(Date.now()),
              },
              appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Integrity payload nonce mismatch');
    });

    it('rejects when timestampMillis is stale (> 5 minutes ago)', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const staleTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago

      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(staleTimestamp),
              },
              appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('Integrity token timestamp is stale or clock skew exceeded 5 minutes');
    });

    it('rejects when appRecognitionVerdict is not PLAY_RECOGNIZED', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('App recognition verdict failed: UNRECOGNIZED_VERSION');
    });

    it('rejects certificate digest when configured allowedCertificateDigests has no match', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
        allowedCertificateDigests: [TEST_CERT_DIGEST],
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: {
                appRecognitionVerdict: 'PLAY_RECOGNIZED',
                certificateSha256Digest: ['ffeeddccbbaa00112233445566778899aabbccddeeff00112233445566778899'],
              },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('App certificate digest does not match');
    });

    it('accepts certificate digest matching authorized fingerprint (case-insensitive & colon-insensitive)', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
        allowedCertificateDigests: [TEST_CERT_DIGEST],
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: {
                appRecognitionVerdict: 'PLAY_RECOGNIZED',
                // Google format often uppercase with colons
                certificateSha256Digest: [
                  'A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2',
                ],
              },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(true);
      expect(verdict.isRealDevice).toBe(true);
    });

    it('rejects when deviceRecognitionVerdict does not meet device integrity (e.g. rooted or emulator)', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] }, // Only basic, not device!
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.isRealDevice).toBe(false);
      expect(verdict.error).toContain('Device integrity verdict unsatisfied');
    });

    it('rejects when requireLicensing=true and appLicensingVerdict is UNLICENSED', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
        requireLicensing: true,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
              accountDetails: { appLicensingVerdict: 'UNLICENSED' },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(false);
      expect(verdict.error).toContain('App licensing verdict failed: UNLICENSED');
    });

    it('accepts when requireLicensing=true and appLicensingVerdict is LICENSED', async () => {
      PlayIntegrityService.overrideConfig({
        clientEmail: TEST_CLIENT_EMAIL,
        privateKey: validRsaPrivateKey,
        packageName: TEST_PACKAGE_NAME,
        requireLicensing: true,
      });

      const nonceObj = await PlayIntegrityService.generateNonce();
      const mockFetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes('oauth2.googleapis.com')) {
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 3600 }) } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: TEST_PACKAGE_NAME,
                nonce: nonceObj.nonce,
                timestampMillis: String(Date.now()),
              },
              appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
              deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_STRONG_INTEGRITY', 'MEETS_DEVICE_INTEGRITY'] },
              accountDetails: { appLicensingVerdict: 'LICENSED' },
            },
          }),
        } as any;
      };
      PlayIntegrityService.setFetchClient(mockFetch);

      const verdict = await PlayIntegrityService.verifyToken({
        nonce: nonceObj.nonce,
        integrityToken: 'token',
      });

      expect(verdict.success).toBe(true);
      expect(verdict.isRealDevice).toBe(true);
      expect(verdict.isLicensed).toBe(true);
    });
  });

  // =========================================================================
  // 7. Route Endpoints & Rate Limiting Integration
  // =========================================================================
  describe('7. API Route Endpoints & Rate Limiting', () => {
    it('GET and POST /api/auth/integrity/nonce both return 200 with nonce', async () => {
      const getRes = await request(app).get('/api/auth/integrity/nonce');
      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.nonce).toBeDefined();

      const postRes = await request(app).post('/api/auth/integrity/nonce');
      expect(postRes.status).toBe(200);
      expect(postRes.body.success).toBe(true);
      expect(postRes.body.nonce).toBeDefined();
    });

    it('POST /api/auth/integrity/verify returns 400 when body is missing nonce or token', async () => {
      const res = await request(app).post('/api/auth/integrity/verify').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Both nonce and integrityToken are required');
    });

    it('POST /api/auth/integrity/verify returns 200 with verdict on valid verification', async () => {
      PlayIntegrityService.overrideConfig({ allowMock: true });

      const nonceRes = await request(app).post('/api/auth/integrity/nonce');
      const nonce = nonceRes.body.nonce;

      const verifyRes = await request(app)
        .post('/api/auth/integrity/verify')
        .send({ nonce, integrityToken: 'valid_mock_token' });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.verdict).toBeDefined();
      expect(verifyRes.body.verdict.isRealDevice).toBe(true);
    });

    it('enforces rate limiting on /api/auth/integrity/nonce when tested with header', async () => {
      const limit = 120; // non-production limit is 120
      let rateLimited = false;

      for (let i = 0; i < limit + 5; i++) {
        const res = await request(app)
          .post('/api/auth/integrity/nonce')
          .set('x-test-rate-limit', 'true');

        if (res.status === 429) {
          rateLimited = true;
          expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
          break;
        }
      }

      expect(rateLimited).toBe(true);
    });
  });
});
