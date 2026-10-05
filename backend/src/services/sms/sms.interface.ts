export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

export interface SmsProvider {
  name: string;
  sendOtp(params: {
    mobile: string;
    otpCode: string;
    templateId?: string;
  }): Promise<SmsSendResult>;
}
