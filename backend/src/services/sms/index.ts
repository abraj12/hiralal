import { SmsProvider, SmsSendResult } from './sms.interface';
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

    if (config.isProduction || config.sms.provider === 'MSG91') {
      this.provider = new MSG91SmsProvider();
      return this.provider;
    }

    // Default to mock in development if MSG91 is not explicitly configured
    this.provider = this.mockProvider;
    return this.provider;
  }

  static setProvider(customProvider: SmsProvider) {
    this.provider = customProvider;
  }

  static async sendOtp(params: {
    mobile: string;
    otpCode: string;
    templateId?: string;
  }): Promise<SmsSendResult> {
    const provider = this.getProvider();
    return await provider.sendOtp(params);
  }
}

export * from './sms.interface';
export * from './msg91.provider';
export * from './mock.provider';
