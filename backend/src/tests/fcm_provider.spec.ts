import { FcmProvider, parseRetryAfterHeader, isInvalidRegistrationTokenError } from '../services/push/fcm.provider';
import { NotificationService } from '../services/notification.service';
import { prisma } from '../db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

describe('Firebase Cloud Messaging (FCM HTTP v1) Provider Hardened Tests', () => {
  let testPrivateKey: string;
  let testUserId: string;
  const testMobile = '9877700001';

  beforeAll(async () => {
    // Generate valid RSA 2048 keypair for cryptographic testing
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    testPrivateKey = privateKey;

    // Clean up and create test user
    await prisma.notification.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.pushDeviceToken.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });

    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        fullName: 'Push Test Worker',
        passwordHash: 'dummy_hash',
        role: 'USER',
        status: 'ACTIVE',
        isVerified: true,
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    FcmProvider.overrideConfig(null);
    FcmProvider.setFetchClient(null);
    FcmProvider.resetTokenCache();

    await prisma.notification.deleteMany({ where: { userId: testUserId } });
    await prisma.pushDeviceToken.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    FcmProvider.resetTokenCache();
  });

  // 1. Token Masking Safety
  test('maskToken never exposes full device token in logs', () => {
    const fullToken = 'eXamPle_fcm_device_token_abcdef1234567890_very_long_token';
    const masked = FcmProvider.maskToken(fullToken);

    expect(masked).toContain('...');
    expect(masked.startsWith('eXamPl')).toBe(true);
    expect(masked.endsWith('oken')).toBe(true);
    expect(masked).not.toBe(fullToken);
    expect(masked.length).toBeLessThan(fullToken.length);

    expect(FcmProvider.maskToken('')).toBe('UNKNOWN');
    expect(FcmProvider.maskToken('short')).toBe('***');
  });

  // 2. Rejection of Placeholder, Example, and Incomplete Credentials
  test('sendPush with unconfigured, partial, or placeholder FCM credentials skips cleanly without calling OAuth or FCM', async () => {
    let networkCallMade = false;
    const mockFailingFetch = async (): Promise<Response> => {
      networkCallMade = true;
      throw new Error('Network should never be invoked when credentials are placeholders!');
    };
    FcmProvider.setFetchClient(mockFailingFetch as any);

    // 2a: Empty credentials
    FcmProvider.overrideConfig({
      projectId: '',
      clientEmail: '',
      privateKey: '',
    });
    expect(FcmProvider.isConfigured()).toBe(false);

    const resEmpty = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Empty Test',
      body: 'Should skip cleanly',
    });
    expect(resEmpty.success).toBe(false);
    expect(resEmpty.skipped).toBe(true);
    expect(resEmpty.messageId).toBeUndefined();
    expect(networkCallMade).toBe(false);

    // 2b: Literal placeholder strings (from .env.example / .env.production.example)
    FcmProvider.overrideConfig({
      projectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID',
      clientEmail: 'REPLACE_WITH_FIREBASE_CLIENT_EMAIL',
      privateKey: 'REPLACE_WITH_FIREBASE_PRIVATE_KEY',
    });
    expect(FcmProvider.isConfigured()).toBe(false);

    const resPlaceholder = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Placeholder Test',
      body: 'Should skip cleanly',
    });
    expect(resPlaceholder.success).toBe(false);
    expect(resPlaceholder.skipped).toBe(true);
    expect(resPlaceholder.messageId).toBeUndefined();
    expect(networkCallMade).toBe(false);

    // 2c: Angle bracket placeholders e.g. <project_id>
    FcmProvider.overrideConfig({
      projectId: '<your-firebase-project-id>',
      clientEmail: '<your-client-email@project.iam.gserviceaccount.com>',
      privateKey: testPrivateKey,
    });
    expect(FcmProvider.isConfigured()).toBe(false);

    const resAngle = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Angle Bracket Test',
      body: 'Should skip cleanly',
    });
    expect(resAngle.success).toBe(false);
    expect(resAngle.skipped).toBe(true);
    expect(networkCallMade).toBe(false);

    // 2d: Partial credentials (missing privateKey)
    FcmProvider.overrideConfig({
      projectId: 'hiralal-valid-project',
      clientEmail: 'service@hiralal-valid-project.iam.gserviceaccount.com',
      privateKey: '',
    });
    expect(FcmProvider.isConfigured()).toBe(false);

    const resPartial = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Partial Creds Test',
      body: 'Should skip cleanly',
    });
    expect(resPartial.success).toBe(false);
    expect(resPartial.skipped).toBe(true);
    expect(networkCallMade).toBe(false);
  });

  // 3. JWT Claims: Proper claims, audience, scope, and omission of 'sub'
  test('OAuth2 token exchange generates correct JWT claims with sub omitted', async () => {
    const clientEmail = 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com';
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail,
      privateKey: testPrivateKey,
    });

    let capturedAssertion = '';
    let capturedGrantType = '';

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        const bodyParams = new URLSearchParams(init?.body as string);
        capturedAssertion = bodyParams.get('assertion') || '';
        capturedGrantType = bodyParams.get('grant_type') || '';

        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock_jwt_verified_token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        } as any;
      }
      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const token = await FcmProvider.getAccessToken();
    expect(token).toBe('mock_jwt_verified_token');
    expect(capturedGrantType).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(capturedAssertion).toBeTruthy();

    // Verify and decode JWT assertion
    const decoded = jwt.decode(capturedAssertion) as any;
    expect(decoded).toBeDefined();
    expect(decoded.iss).toBe(clientEmail);
    expect(decoded.aud).toBe('https://oauth2.googleapis.com/token');
    expect(decoded.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    // STRICT REQUIREMENT: sub claim must be omitted unless domain-wide delegation is used
    expect(decoded.sub).toBeUndefined();
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  // 4. Single In-Flight Promise for Concurrent Token Requests (Promise Deduplication)
  test('concurrent getAccessToken calls perform exactly ONE in-flight OAuth token exchange', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    let oauthCallCount = 0;

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        oauthCallCount++;
        // Simulate network latency
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'shared_concurrent_token_abc',
            expires_in: 3600,
          }),
        } as any;
      }
      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    // Launch 5 concurrent calls simultaneously
    const results = await Promise.all([
      FcmProvider.getAccessToken(),
      FcmProvider.getAccessToken(),
      FcmProvider.getAccessToken(),
      FcmProvider.getAccessToken(),
      FcmProvider.getAccessToken(),
    ]);

    expect(oauthCallCount).toBe(1); // EXACTLY ONE network call performed!
    results.forEach((tok) => expect(tok).toBe('shared_concurrent_token_abc'));
  });

  // 5. Access Token Refresh Upon Expiry
  test('refreshes access token after token cache expires', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    let exchangeCounter = 0;

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        exchangeCounter++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: `token_version_${exchangeCounter}`,
            expires_in: 3600,
          }),
        } as any;
      }
      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const token1 = await FcmProvider.getAccessToken();
    expect(token1).toBe('token_version_1');
    expect(exchangeCounter).toBe(1);

    // Call again before expiry -> returns cached token without re-fetching
    const token1Cached = await FcmProvider.getAccessToken();
    expect(token1Cached).toBe('token_version_1');
    expect(exchangeCounter).toBe(1);

    // Reset cache to simulate expiry
    FcmProvider.resetTokenCache();

    // Call after expiry -> fetches fresh token
    const token2 = await FcmProvider.getAccessToken();
    expect(token2).toBe('token_version_2');
    expect(exchangeCounter).toBe(2);
  });

  // 6. Real FCM HTTP v1 Delivery & Payload Contract
  test('sendPush posts to correct FCM HTTP v1 endpoint with high priority Android payload and string data', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    let fcmEndpointRequested = '';
    let fcmAuthHeader = '';
    let parsedBody: any = null;

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'valid_bearer_token', expires_in: 3600 }),
        } as any;
      }

      if (urlStr.includes('messages:send')) {
        fcmEndpointRequested = urlStr;
        fcmAuthHeader = (init?.headers as any)?.Authorization || '';
        parsedBody = JSON.parse(init?.body as string);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'projects/hiralal-test-project/messages/msg_valid_12345',
          }),
        } as any;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const result = await FcmProvider.sendPush({
      token: 'fcm_phone_token_sample',
      title: 'Invoice Approved',
      body: 'Your ₹1,500 cashback is credited.',
      data: {
        billId: 'b_789',
        amount: '1500',
      },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('projects/hiralal-test-project/messages/msg_valid_12345');
    expect(fcmEndpointRequested).toBe('https://fcm.googleapis.com/v1/projects/hiralal-test-project/messages:send');
    expect(fcmAuthHeader).toBe('Bearer valid_bearer_token');

    // Contract verification
    expect(parsedBody.message.token).toBe('fcm_phone_token_sample');
    expect(parsedBody.message.notification.title).toBe('Invoice Approved');
    expect(parsedBody.message.notification.body).toBe('Your ₹1,500 cashback is credited.');
    expect(parsedBody.message.android.priority).toBe('HIGH');
    expect(parsedBody.message.data.billId).toBe('b_789');
    expect(parsedBody.message.data.amount).toBe('1500');
  });

  // 7. Transient Errors (429 / 5xx) with Exponential Backoff and Retry-After Header
  test('sendPush retries up to 3 attempts with backoff on 429 and 503 and respects Retry-After header', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    // 7a: Unit test parseRetryAfterHeader helper directly
    expect(parseRetryAfterHeader('2')).toBe(2000);
    expect(parseRetryAfterHeader('120')).toBe(5000); // Bounded at 5000ms maximum
    expect(parseRetryAfterHeader(null)).toBeNull();
    expect(parseRetryAfterHeader('')).toBeNull();
    const futureHttpDate = new Date(Date.now() + 3000).toUTCString();
    const parsedHttpDateMs = parseRetryAfterHeader(futureHttpDate);
    expect(typeof parsedHttpDateMs).toBe('number');
    expect(parsedHttpDateMs).toBeLessThanOrEqual(5000);

    let fcmAttempt = 0;

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'test_token', expires_in: 3600 }),
        } as any;
      }

      if (urlStr.includes('messages:send')) {
        fcmAttempt++;
        if (fcmAttempt === 1) {
          // Attempt 1: 429 Rate Limit with Retry-After header
          return {
            ok: false,
            status: 429,
            headers: {
              get: (header: string) => (header.toLowerCase() === 'retry-after' ? '0' : null),
            },
            json: async () => ({
              error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' },
            }),
          } as any;
        }

        if (fcmAttempt === 2) {
          // Attempt 2: 503 Server Error
          return {
            ok: false,
            status: 503,
            headers: { get: () => null },
            json: async () => ({
              error: { code: 503, message: 'Backend unavailable', status: 'UNAVAILABLE' },
            }),
          } as any;
        }

        // Attempt 3: Success!
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'projects/hiralal-test-project/messages/retry_final_success_789',
          }),
        } as any;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const result = await FcmProvider.sendPush({
      token: 'transient_retry_token',
      title: 'Retry Test',
      body: 'Will succeed on 3rd attempt',
    });

    expect(fcmAttempt).toBe(3); // 1 initial attempt + 2 retries = 3 attempts total
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('projects/hiralal-test-project/messages/retry_final_success_789');
  });

  // 8. Device Token Deactivation ONLY for Genuine Invalid/Unregistered Token, NOT on Payload, Project 404, or Auth Errors
  test('strictly discriminates genuine unregistered/invalid tokens from generic payload, project, and auth errors', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    const safeToken = 'valid_token_should_never_deactivate';
    const badPayloadToken = 'valid_token_with_malformed_payload';
    const invalidFormatToken = 'genuinely_invalid_fcm_token_format';
    const unregisteredToken = 'actual_dead_unregistered_token';

    // Seed all tokens as active in DB
    for (const t of [safeToken, badPayloadToken, invalidFormatToken, unregisteredToken]) {
      await prisma.pushDeviceToken.upsert({
        where: { token: t },
        update: { isActive: true },
        create: { userId: testUserId, token: t, platform: 'ANDROID', isActive: true },
      });
    }

    // 8a: Simulate 404 Project Error ("Project not found" / "NOT_FOUND")
    const mockFetchProjectError = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            code: 404,
            message: 'Project hiralal-test-project was not found.',
            status: 'NOT_FOUND',
          },
        }),
      } as any;
    };

    FcmProvider.setFetchClient(mockFetchProjectError as any);
    const resProjectErr = await FcmProvider.sendPush({
      token: safeToken,
      title: 'Test',
      body: 'Should not deactivate token on project 404',
    });
    expect(resProjectErr.success).toBe(false);
    expect(resProjectErr.errorCode).not.toBe('UNREGISTERED');

    // DB Check: Token remains ACTIVE!
    const safeRecordAfter404 = await prisma.pushDeviceToken.findUnique({ where: { token: safeToken } });
    expect(safeRecordAfter404?.isActive).toBe(true);

    // 8b: Generic Malformed Request / Payload error (INVALID_ARGUMENT for payload field, not token)
    const mockFetchPayloadError = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 400,
            message: 'Invalid JSON payload received. Unknown field: message.data.invalid_field',
            status: 'INVALID_ARGUMENT',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.BadRequest',
                fieldViolations: [{ field: 'message.data.invalid_field', description: 'Invalid key' }],
              },
            ],
          },
        }),
      } as any;
    };

    FcmProvider.setFetchClient(mockFetchPayloadError as any);
    const resPayloadErr = await FcmProvider.sendPush({
      token: badPayloadToken,
      title: 'Bad Payload Test',
      body: 'Payload is invalid, but device token itself is valid',
    });
    expect(resPayloadErr.success).toBe(false);
    expect(resPayloadErr.errorCode).toBe('INVALID_ARGUMENT');

    // DB Check: Token MUST NOT be deactivated for payload mistakes!
    const badPayloadRecord = await prisma.pushDeviceToken.findUnique({ where: { token: badPayloadToken } });
    expect(badPayloadRecord?.isActive).toBe(true);

    // 8c: Invalid Registration Token with INVALID_ARGUMENT (specifically identifying message.token)
    const mockFetchInvalidToken = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 400,
            message: 'The registration token is not a valid FCM registration token',
            status: 'INVALID_ARGUMENT',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'INVALID_ARGUMENT',
              },
              {
                '@type': 'type.googleapis.com/google.rpc.BadRequest',
                fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }],
              },
            ],
          },
        }),
      } as any;
    };

    FcmProvider.setFetchClient(mockFetchInvalidToken as any);
    const resInvalidToken = await FcmProvider.sendPush({
      token: invalidFormatToken,
      title: 'Invalid Token Test',
      body: 'Token is malformed',
    });
    expect(resInvalidToken.success).toBe(false);
    expect(resInvalidToken.errorCode).toBe('UNREGISTERED');

    // DB Check: Genuinely invalid registration token MUST be deactivated!
    const invalidFormatRecord = await prisma.pushDeviceToken.findUnique({ where: { token: invalidFormatToken } });
    expect(invalidFormatRecord?.isActive).toBe(false);

    // 8d: Genuine UNREGISTERED response (device uninstalled / expired token)
    const mockFetchUnregistered = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            code: 404,
            message: 'Requested entity was not found.',
            status: 'NOT_FOUND',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
              },
            ],
          },
        }),
      } as any;
    };

    FcmProvider.setFetchClient(mockFetchUnregistered as any);
    const resUnregistered = await FcmProvider.sendPush({
      token: unregisteredToken,
      title: 'Alert',
      body: 'Token is truly dead',
    });
    expect(resUnregistered.success).toBe(false);
    expect(resUnregistered.errorCode).toBe('UNREGISTERED');

    // DB Check: Dead token is deactivated in database
    const tokenRecordAfterUnregistered = await prisma.pushDeviceToken.findUnique({ where: { token: unregisteredToken } });
    expect(tokenRecordAfterUnregistered?.isActive).toBe(false);
  });

  // 9. Timeout Aborts Immediately Without Retrying (Preventing Duplicate Notifications)
  test('sendPush aborts immediately on request timeout without retrying to prevent duplicate delivery', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    let timeoutFetchCallCount = 0;
    const mockFetchTimeout = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }
      timeoutFetchCallCount++;
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    FcmProvider.setFetchClient(mockFetchTimeout as any);

    const timeoutRes = await FcmProvider.sendPush({
      token: 'timeout_token_test',
      title: 'Timeout',
      body: 'Should abort cleanly without retry',
    });

    expect(timeoutRes.success).toBe(false);
    expect(timeoutRes.errorCode).toBe('TIMEOUT');
    expect(timeoutRes.error).toContain('timed out');
    expect(timeoutFetchCallCount).toBe(1); // EXACTLY ONE CALL: No blind retries!

    // 9b: Auth 401 failure
    const mockFetch401 = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'bad_token', expires_in: 3600 }) } as any;
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' },
        }),
      } as any;
    };

    FcmProvider.setFetchClient(mockFetch401 as any);

    const authRes = await FcmProvider.sendPush({
      token: 'auth_fail_token',
      title: 'Auth Fail',
      body: 'Should fail with 401',
    });

    expect(authRes.success).toBe(false);
    expect(authRes.errorCode).toBe('UNAUTHENTICATED');
  });

  // 10. Persistence of In-App Notifications When Push Fails
  test('in-app notifications are persisted in database regardless of push delivery failure', async () => {
    // Mock FcmProvider to simulate total network failure
    jest.spyOn(FcmProvider, 'sendMulticast').mockRejectedValueOnce(new Error('Complete network partition'));

    const testDedupeKey = `dedupe_push_fail_${Date.now()}`;

    const notification = await NotificationService.createForUser({
      userId: testUserId,
      title: 'Persisted In-App Alert',
      message: 'This message must remain readable in worker inbox.',
      dedupeKey: testDedupeKey,
      metadata: { invoiceId: 'inv_abc_999' },
    });

    expect(notification).toBeDefined();
    expect(notification.id).toBeDefined();
    expect(notification.title).toBe('Persisted In-App Alert');
    expect(notification.message).toBe('This message must remain readable in worker inbox.');

    // Query database directly to confirm persistence
    const savedInDb = await prisma.notification.findUnique({
      where: { dedupeKey: testDedupeKey },
    });

    expect(savedInDb).not.toBeNull();
    expect(savedInDb?.userId).toBe(testUserId);
    expect(savedInDb?.isRead).toBe(false);
  });

  // 11. Multicast Dispatch Aggregation
  test('sendMulticast aggregates sent, failed, and skipped statistics across tokens', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }

      if (urlStr.includes('messages:send')) {
        const body = JSON.parse(init?.body as string);
        if (body.message.token === 'token_good') {
          return { ok: true, status: 200, json: async () => ({ name: 'projects/p/messages/msg_good' }) } as any;
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 500, message: 'Server error', status: 'INTERNAL' } }),
        } as any;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const summary = await FcmProvider.sendMulticast(
      ['token_good', 'token_fail'],
      'Multicast Alert',
      'Batch dispatch test'
    );

    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results.length).toBe(2);
  });
});
