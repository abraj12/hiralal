import { SmsProvider, SmsSendResult, OtpProvider, OtpSendResult } from './sms.interface';
import { WhatsAppOtpProvider } from './whatsapp.provider';
import { MSG91SmsProvider } from './msg91.provider';
import { MockSmsProvider } from './mock.provider';
import { config } from '../../config';

export class SmsService {
  private static provider: SmsProvider | null = null;
  public static mockProvider = new MockSmsProvider();

  static getProvider(): SmsProvider {
    if (this.provider) return this.provider;

    if (config.nodeEnv === 'test') {
      this.provider = this.mockProvider;
      return this.provider;
    }

    const providerType = (
      process.env.OTP_PROVIDER ||
      process.env.SMS_PROVIDER ||
      config.sms.provider ||
      'WHATSAPP'
    ).toUpperCase();

    if (providerType === 'WHATSAPP') {
      this.provider = new WhatsAppOtpProvider();
      return this.provider;
    }

    if (providerType === 'MSG91') {
      this.provider = new MSG91SmsProvider();
      return this.provider;
    }

    if (config.isProduction) {
      this.provider = new WhatsAppOtpProvider();
      return this.provider;
    }

    // Default to mock in development if not explicitly configured
    this.provider = this.mockProvider;
    return this.provider;
  }

  static setProvider(customProvider: SmsProvider) {
    this.provider = customProvider;
  }

  static resetProvider() {
    this.provider = null;
  }

  static async sendOtp(params: {
    mobile: string;
    otpCode: string;
    templateId?: string;
    language?: string;
  }): Promise<SmsSendResult> {
    const provider = this.getProvider();
    return await provider.sendOtp(params);
  }
}

export const OtpService = SmsService;

export * from './sms.interface';
export * from './whatsapp.provider';
export * from './msg91.provider';
export * from './mock.provider';
