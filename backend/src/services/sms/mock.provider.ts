import { SmsProvider, SmsSendResult } from './sms.interface';

export class MockSmsProvider implements SmsProvider {
  name = 'MOCK_SMS';
  public sentMessages: Array<{ mobile: string; otpCode: string; timestamp: Date }> = [];

  async sendOtp(params: {
    mobile: string;
    otpCode: string;
    templateId?: string;
  }): Promise<SmsSendResult> {
    const cleanMobile = params.mobile.replace(/\D/g, '').slice(-10);

    this.sentMessages.push({
      mobile: cleanMobile,
      otpCode: params.otpCode,
      timestamp: new Date(),
    });

    return {
      success: true,
      provider: this.name,
      messageId: `mock_msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    };
  }

  getLastOtpForMobile(mobile: string): string | undefined {
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    const msg = [...this.sentMessages].reverse().find((m) => m.mobile === cleanMobile);
    return msg?.otpCode;
  }

  clear() {
    this.sentMessages = [];
  }
}
