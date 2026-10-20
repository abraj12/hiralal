import { WhatsAppOtpProvider } from '../services/sms/whatsapp.provider';
import { SmsService, OtpService } from '../services/sms';
import { config } from '../config';

describe('WhatsApp Business Platform Cloud API OTP Provider Tests', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const originalNodeEnv = config.nodeEnv;
  const originalIsProduction = config.isProduction;

  beforeEach(() => {
    jest.clearAllMocks();
    SmsService.resetProvider();
    process.env.WHATSAPP_API_URL = 'https://graph.facebook.com';
    process.env.WHATSAPP_API_VERSION = 'v21.0';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '100012345678901';
    process.env.WHATSAPP_ACCESS_TOKEN = 'EAABtest_secret_access_token_12345';
    process.env.WHATSAPP_TEMPLATE_NAME = 'hiralal_auth_otp';
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en_US';
    process.env.WHATSAPP_AUTH_BUTTON_TYPE = 'COPY_CODE';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    (config as any).nodeEnv = originalNodeEnv;
    (config as any).isProduction = originalIsProduction;
    SmsService.resetProvider();
  });

  describe('1. Parameter Construction & API Protocol Invariants', () => {
    it('successfully delivers OTP via WhatsApp Cloud API v21.0 with COPY_CODE button', async () => {
      let capturedUrl = '';
      let capturedOptions: any = null;

      global.fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messaging_product: 'whatsapp',
            contacts: [{ input: '919876543210', wa_id: '919876543210' }],
            messages: [{ id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSRjQ1NjIzNzg4OTAwQUJDREVFAAA=' }],
          }),
        };
      });

      const provider = new WhatsAppOtpProvider();
      const result = await provider.sendOtp({
        mobile: '9876543210',
        otpCode: '456789',
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe('WHATSAPP');
      expect(result.messageId).toBe('wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSRjQ1NjIzNzg4OTAwQUJDREVFAAA=');

      // Verify endpoint URL
      expect(capturedUrl).toBe('https://graph.facebook.com/v21.0/100012345678901/messages');

      // Verify Authorization and Content-Type headers
      expect(capturedOptions.headers['Authorization']).toBe('Bearer EAABtest_secret_access_token_12345');
      expect(capturedOptions.headers['Content-Type']).toBe('application/json');

      // Verify JSON payload structure
      const body = JSON.parse(capturedOptions.body);
      expect(body.messaging_product).toBe('whatsapp');
      expect(body.recipient_type).toBe('individual');
      expect(body.to).toBe('919876543210');
      expect(body.type).toBe('template');
      expect(body.template.name).toBe('hiralal_auth_otp');
      expect(body.template.language.code).toBe('en_US');

      // Verify authentication template components
      expect(body.template.components).toEqual([
        {
          type: 'body',
          parameters: [{ type: 'text', text: '456789' }],
        },
        {
          type: 'button',
          sub_type: 'copy_code',
          index: '0',
          parameters: [{ type: 'text', text: '456789' }],
        },
      ]);
    });

    it('normalizes 10-digit Indian mobile numbers and preserves 12-digit numbers', async () => {
      let capturedBodies: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBodies.push(JSON.parse(options.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.123' }] }),
        };
      });

      const provider = new WhatsAppOtpProvider();

      // 10-digit input
      await provider.sendOtp({ mobile: '9876543210', otpCode: '112233' });
      expect(capturedBodies[0].to).toBe('919876543210');

      // 10-digit with dashes and spaces
      await provider.sendOtp({ mobile: '98765-43210', otpCode: '112233' });
      expect(capturedBodies[1].to).toBe('919876543210');

      // Already 12-digit starting with 91
      await provider.sendOtp({ mobile: '919876543210', otpCode: '112233' });
      expect(capturedBodies[2].to).toBe('919876543210');
    });

    it('supports URL button type and NONE button type', async () => {
      let capturedBody: any;
      global.fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.123' }] }),
        };
      });

      const provider = new WhatsAppOtpProvider();

      // URL button
      process.env.WHATSAPP_AUTH_BUTTON_TYPE = 'URL';
      await provider.sendOtp({ mobile: '9876543210', otpCode: '334455' });
      expect(capturedBody.template.components[1]).toEqual({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '334455' }],
      });

      // NONE button (body only)
      process.env.WHATSAPP_AUTH_BUTTON_TYPE = 'NONE';
      await provider.sendOtp({ mobile: '9876543210', otpCode: '334455' });
      expect(capturedBody.template.components).toHaveLength(1);
      expect(capturedBody.template.components[0].type).toBe('body');
    });

    it('rejects invalid recipient mobile number lengths', async () => {
      const provider = new WhatsAppOtpProvider();
      const result = await provider.sendOtp({
        mobile: '123',
        otpCode: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient phone number format');
    });
  });

  describe('2. Error Handling & Gateway Security Invariants', () => {
    it('handles WhatsApp Cloud API error responses and extracts structured error details', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Template param name does not exist',
            type: 'OAuthException',
            code: 100,
            error_data: {
              messaging_product: 'whatsapp',
              details: 'Template hiralal_auth_otp not found in WABA',
            },
          },
        }),
      } as any);

      const provider = new WhatsAppOtpProvider();
      const result = await provider.sendOtp({
        mobile: '9876543210',
        otpCode: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.provider).toBe('WHATSAPP');
      expect(result.error).toContain('Template param name does not exist');
    });

    it('redacts access token from error strings if present in gateway error message', async () => {
      const sensitiveToken = 'EAABtest_secret_access_token_12345';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: `Invalid OAuth token: ${sensitiveToken} has expired`,
            code: 190,
          },
        }),
      } as any);

      const provider = new WhatsAppOtpProvider();
      const result = await provider.sendOtp({
        mobile: '9876543210',
        otpCode: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain(sensitiveToken);
      expect(result.error).toContain('[REDACTED_TOKEN]');
    });

    it('handles network timeouts via AbortController fail-closed', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      global.fetch = jest.fn().mockRejectedValue(abortErr);

      const provider = new WhatsAppOtpProvider();
      await expect(
        provider.sendOtp({
          mobile: '9876543210',
          otpCode: '123456',
        })
      ).rejects.toThrow('WhatsApp Business Cloud API gateway timed out.');
    });

    it('fails closed in production if WhatsApp credentials are missing', async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      (config as any).isProduction = true;

      const provider = new WhatsAppOtpProvider();
      await expect(
        provider.sendOtp({
          mobile: '9876543210',
          otpCode: '123456',
        })
      ).rejects.toThrow(/WhatsApp Business credentials.*are required in production/);
    });

    it('returns structured failure when credentials are missing in non-production mode', async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      (config as any).isProduction = false;

      const provider = new WhatsAppOtpProvider();
      const result = await provider.sendOtp({
        mobile: '9876543210',
        otpCode: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('WhatsApp Business credentials not configured');
    });

    it('rejects successful HTTP 200 response when response is missing messages or message id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '919876543210', wa_id: '919876543210' }],
          messages: [], // empty messages array
        }),
      } as any);

      const provider = new WhatsAppOtpProvider();
      const result = await provider.sendOtp({
        mobile: '9876543210',
        otpCode: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.provider).toBe('WHATSAPP');
      expect(result.error).toContain('missing a valid message ID');
      expect((result as any).messageId).toBeUndefined();
    });
  });

  describe('3. SmsService / OtpService Dispatch & Mock Invariants', () => {
    it('dispatches through SmsService and OtpService to MockProvider in test environment', async () => {
      (config as any).nodeEnv = 'test';

      const res1 = await SmsService.sendOtp({
        mobile: '9876543210',
        otpCode: '654321',
      });
      expect(res1.success).toBe(true);

      const res2 = await OtpService.sendOtp({
        mobile: '9876543210',
        otpCode: '654321',
      });
      expect(res2.success).toBe(true);
    });

    it('resolves WhatsAppOtpProvider when OTP_PROVIDER is WHATSAPP in non-test environment', async () => {
      (config as any).nodeEnv = 'development';
      process.env.OTP_PROVIDER = 'WHATSAPP';
      SmsService.resetProvider();

      const provider = SmsService.getProvider();
      expect(provider.name).toBe('WHATSAPP');
    });
  });
});
