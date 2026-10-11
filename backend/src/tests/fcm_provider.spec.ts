import { FcmProvider } from '../services/push/fcm.provider';
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

  // 2. Missing or Partial Credentials Without Fabricated Success
  test('sendPush with unconfigured or partial FCM credentials skips cleanly without fabricating message ID', async () => {
    // Unconfigured
    FcmProvider.overrideConfig({
      projectId: '',
      clientEmail: '',
      privateKey: '',
    });

    const res1 = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Test Notification',
      body: 'Hello Craftsman',
    });

    expect(res1.success).toBe(false);
    expect(res1.skipped).toBe(true);
    expect(res1.messageId).toBeUndefined();
    expect(res1.error).toContain('not configured');

    // Partial credentials (missing privateKey)
    FcmProvider.overrideConfig({
      projectId: 'some-project',
      clientEmail: 'some-email@project.iam.gserviceaccount.com',
      privateKey: '',
    });

    const res2 = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Partial Creds Test',
      body: 'Should also skip safely',
    });

    expect(res2.success).toBe(false);
    expect(res2.skipped).toBe(true);
    expect(res2.messageId).toBeUndefined();
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

  // 8. Device Token Deactivation ONLY for Genuine Unregistered Token, NOT on 404 Project Not Found
  test('does NOT deactivate device token when 404 is a project error, but DOES deactivate when token is UNREGISTERED', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    const safeToken = 'valid_token_should_not_deactivate';
    const deadToken = 'actual_dead_unregistered_token';

    // Seed both active tokens in DB
    await prisma.pushDeviceToken.upsert({
      where: { token: safeToken },
      update: { isActive: true },
      create: { userId: testUserId, token: safeToken, platform: 'ANDROID', isActive: true },
    });
    await prisma.pushDeviceToken.upsert({
      where: { token: deadToken },
      update: { isActive: true },
      create: { userId: testUserId, token: deadToken, platform: 'ANDROID', isActive: true },
    });

    // 8a: Simulate 404 Project Error ("Project not found" / "NOT_FOUND" without unregistered token error)
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

    // VERIFY: The token in the database remains ACTIVE!
    const tokenRecordAfterProject404 = await prisma.pushDeviceToken.findUnique({ where: { token: safeToken } });
    expect(tokenRecordAfterProject404?.isActive).toBe(true);

    // 8b: Now simulate genuine UNREGISTERED token response
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
      token: deadToken,
      title: 'Alert',
      body: 'Token is truly dead',
    });

    expect(resUnregistered.success).toBe(false);
    expect(resUnregistered.errorCode).toBe('UNREGISTERED');

    // VERIFY: Dead token is deactivated in database
    const tokenRecordAfterUnregistered = await prisma.pushDeviceToken.findUnique({ where: { token: deadToken } });
    expect(tokenRecordAfterUnregistered?.isActive).toBe(false);
  });

  // 9. Timeout and Authentication Failures
  test('sendPush handles request timeout and auth 401 error', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    // 9a: Timeout
    const mockFetchTimeout = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'test_token', expires_in: 3600 }) } as any;
      }
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    FcmProvider.setFetchClient(mockFetchTimeout as any);

    const timeoutRes = await FcmProvider.sendPush({
      token: 'timeout_token_test',
      title: 'Timeout',
      body: 'Should abort cleanly',
    });

    expect(timeoutRes.success).toBe(false);
    expect(timeoutRes.errorCode).toBe('TIMEOUT');
    expect(timeoutRes.error).toContain('timed out');

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
