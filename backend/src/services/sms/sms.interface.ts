export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

export type OtpSendResult = SmsSendResult;

export interface SmsProvider {
  name: string;
  sendOtp(params: {
    mobile: string;
    otpCode: string;
    templateId?: string;
    language?: string;
  }): Promise<SmsSendResult>;
}

export type OtpProvider = SmsProvider;
