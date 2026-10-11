import { FcmProvider } from '../services/push/fcm.provider';
import { prisma } from '../db';
import crypto from 'crypto';

describe('Firebase Cloud Messaging (FCM HTTP v1) Provider Tests', () => {
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
    await prisma.pushDeviceToken.deleteMany({ where: { user: { mobile: testMobile } } });
    await prisma.user.deleteMany({ where: { mobile: testMobile } });

    const user = await prisma.user.create({
      data: {
        mobile: testMobile,
        fullName: 'Push Test User',
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

    await prisma.pushDeviceToken.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    FcmProvider.resetTokenCache();
  });

  // 1. Token Masking Safety
  test('maskToken never exposes full device token', () => {
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

  // 2. Unconfigured Provider Behavior (Development / Testing)
  test('sendPush with unconfigured FCM credentials skips safely without fabricating message ID', async () => {
    FcmProvider.overrideConfig({
      projectId: '',
      clientEmail: '',
      privateKey: '',
    });

    const res = await FcmProvider.sendPush({
      token: 'sample_token_123',
      title: 'Test Notification',
      body: 'Hello Craftsman',
    });

    expect(res.success).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.messageId).toBeUndefined();
    expect(res.error).toContain('not configured');
  });

  // 3. Genuine FCM HTTP v1 Delivery (Mocked HTTP Response)
  test('sendPush performs genuine Google OAuth2 exchange and FCM HTTP v1 request', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    let oauthCalled = false;
    let fcmCalled = false;
    let authHeaderSent = '';

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();

      if (urlStr.includes('oauth2.googleapis.com/token')) {
        oauthCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock_google_oauth2_access_token_xyz',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        } as any;
      }

      if (urlStr.includes('fcm.googleapis.com/v1/projects/hiralal-test-project/messages:send')) {
        fcmCalled = true;
        authHeaderSent = (init?.headers as any)?.Authorization || '';
        const reqBody = JSON.parse(init?.body as string);

        expect(reqBody.message.token).toBe('valid_target_device_token');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'projects/hiralal-test-project/messages/fcm_genuine_msg_987654321',
          }),
        } as any;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const result = await FcmProvider.sendPush({
      token: 'valid_target_device_token',
      title: 'Reward Approved',
      body: '₹500 credited to wallet',
      data: { billId: 'bill_123' },
    });

    expect(oauthCalled).toBe(true);
    expect(fcmCalled).toBe(true);
    expect(authHeaderSent).toBe('Bearer mock_google_oauth2_access_token_xyz');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.messageId).toBe('projects/hiralal-test-project/messages/fcm_genuine_msg_987654321');

    // Subsequent push within expiry reuses cached token (oauth should not be called again)
    oauthCalled = false;
    const result2 = await FcmProvider.sendPush({
      token: 'valid_target_device_token',
      title: 'Second Notification',
      body: 'No extra oauth call needed',
    });

    expect(oauthCalled).toBe(false); // CACHED!
    expect(result2.success).toBe(true);
  });

  // 4. Invalid Token Handling & Automatic Deactivation
  test('sendPush detects unregistered device tokens and deactivates them in database', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    const deadToken = 'dead_unregistered_token_12345';

    // Insert active token in DB
    await prisma.pushDeviceToken.upsert({
      where: { token: deadToken },
      update: { isActive: true },
      create: {
        userId: testUserId,
        token: deadToken,
        platform: 'ANDROID',
        isActive: true,
      },
    });

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
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const result = await FcmProvider.sendPush({
      token: deadToken,
      title: 'Alert',
      body: 'Your token is expired',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNREGISTERED');

    // Confirm token was automatically deactivated in database
    const dbToken = await prisma.pushDeviceToken.findUnique({ where: { token: deadToken } });
    expect(dbToken?.isActive).toBe(false);
  });

  // 5. Rate Limit (429) Retry Handling
  test('sendPush handles 429 rate limit with retry and eventual success', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    let attemptCount = 0;

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
        attemptCount++;
        if (attemptCount === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({
              error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' },
            }),
          } as any;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'projects/hiralal-test-project/messages/retry_msg_success_456',
          }),
        } as any;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const result = await FcmProvider.sendPush({
      token: 'rate_limited_token',
      title: 'Retry Test',
      body: 'Testing backoff retry',
    });

    expect(attemptCount).toBe(2);
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('projects/hiralal-test-project/messages/retry_msg_success_456');
  });

  // 6. Timeout Handling
  test('sendPush catches AbortError and returns TIMEOUT error code', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'test_token', expires_in: 3600 }),
        } as any;
      }

      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const result = await FcmProvider.sendPush({
      token: 'timeout_token',
      title: 'Timeout Test',
      body: 'Testing timeout abort',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.error).toContain('timed out');
  });

  // 7. Multicast Dispatch with Mixed Outcomes
  test('sendMulticast aggregates sent, failed, and skipped statistics across tokens', async () => {
    FcmProvider.overrideConfig({
      projectId: 'hiralal-test-project',
      clientEmail: 'fcm-service-account@hiralal-test-project.iam.gserviceaccount.com',
      privateKey: testPrivateKey,
    });

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'test_token', expires_in: 3600 }),
        } as any;
      }

      if (urlStr.includes('messages:send')) {
        const body = JSON.parse(init?.body as string);
        if (body.message.token === 'token_good') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ name: 'projects/p/messages/msg_good' }),
          } as any;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: { code: 404, message: 'Not found', status: 'NOT_FOUND' },
          }),
        } as any;
      }

      throw new Error(`Unexpected request to ${urlStr}`);
    };

    FcmProvider.setFetchClient(mockFetch as any);

    const summary = await FcmProvider.sendMulticast(
      ['token_good', 'token_bad'],
      'Multicast Alert',
      'Batch dispatch test'
    );

    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results.length).toBe(2);
  });
});
