import { SmsProvider, SmsSendResult } from './sms.interface';
import { config } from '../../config';

export class MSG91SmsProvider implements SmsProvider {
  name = 'MSG91';

  private maskMobile(mobile: string): string {
    const clean = mobile.replace(/\D/g, '');
    if (clean.length < 5) return '*****';
    return `${clean.substring(0, 3)}*****${clean.slice(-2)}`;
  }

  async sendOtp(params: {
    mobile: string;
    otpCode: string;
    templateId?: string;
  }): Promise<SmsSendResult> {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);
    const maskedMobile = this.maskMobile(cleanMobile);
    const templateId = params.templateId || process.env.MSG91_TEMPLATE_ID;
    const authKey = process.env.MSG91_AUTH_KEY || config.sms.apiKey;

    if (!authKey || !templateId) {
      if (config.isProduction) {
        throw new Error('MSG91 credentials (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID) are required in production.');
      }
      return {
        success: false,
        provider: this.name,
        error: 'MSG91 credentials not configured.',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      if (config.nodeEnv !== 'test') {
        console.log(`[MSG91-DISPATCH] Dispatching OTP SMS to ${maskedMobile} (template: ${templateId})`);
      }

      // MSG91 OTP Send API v5
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', templateId);
      url.searchParams.set('mobile', `91${cleanMobile}`);
      url.searchParams.set('authkey', authKey);
      url.searchParams.set('otp', params.otpCode);
      url.searchParams.set('otp_expiry', '10'); // 10 minutes

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      const responseData: any = await response.json().catch(() => null);

      if (!response.ok || !responseData) {
        const errorMsg = responseData?.message || responseData?.error || `MSG91 returned HTTP ${response.status}`;
        console.error(`[MSG91-ERROR] Delivery to ${maskedMobile} failed: ${errorMsg}`);
        return {
          success: false,
          provider: this.name,
          error: errorMsg,
        };
      }

      const isSuccess = responseData.type === 'success' || responseData.status === 'success';

      return {
        success: isSuccess,
        provider: this.name,
        messageId: responseData.request_id || responseData.message_id || responseData.data?.request_id,
        error: isSuccess ? undefined : (responseData.message || 'SMS delivery failed at MSG91 gateway'),
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('MSG91 SMS gateway timed out.');
      }
      throw new Error(`MSG91 SMS delivery network error: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
