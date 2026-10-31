import { SmsProvider, SmsSendResult } from './sms.interface';
import { config } from '../../config';

export interface WhatsAppSendOtpParams {
  mobile: string;
  otpCode: string;
  templateId?: string;
  language?: string;
}

export class WhatsAppOtpProvider implements SmsProvider {
  name = 'WHATSAPP';

  /**
   * Masks mobile number for safe diagnostic logging (e.g. 91987*****10)
   */
  private maskMobile(mobile: string): string {
    const clean = mobile.replace(/\D/g, '');
    if (clean.length < 6) return '*****';
    return `${clean.substring(0, 5)}*****${clean.slice(-2)}`;
  }

  /**
   * Normalizes recipient mobile to WhatsApp E.164 without leading plus (e.g. 919876543210)
   */
  private normalizeMobile(mobile: string): string {
    const clean = mobile.replace(/\D/g, '');
    if (clean.length === 10) {
      // Standard 10-digit Indian mobile number
      return `91${clean}`;
    }
    if (clean.length === 12 && clean.startsWith('91')) {
      return clean;
    }
    // Return sanitized digits as fallback
    return clean;
  }

  async sendOtp(params: WhatsAppSendOtpParams): Promise<SmsSendResult> {
    const cleanMobile = this.normalizeMobile(params.mobile);
    const maskedMobile = this.maskMobile(cleanMobile);

    const apiUrl = process.env.WHATSAPP_API_URL || config.whatsapp?.apiUrl || 'https://graph.facebook.com';
    const apiVersion = process.env.WHATSAPP_API_VERSION || config.whatsapp?.apiVersion || 'v21.0';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || config.whatsapp?.phoneNumberId;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN || config.whatsapp?.accessToken;
    const templateName = params.templateId || process.env.WHATSAPP_TEMPLATE_NAME || config.whatsapp?.templateName || 'hiralal_auth_otp';
    const templateLanguage = params.language || process.env.WHATSAPP_TEMPLATE_LANGUAGE || config.whatsapp?.templateLanguage || 'en_US';
    const buttonType = (process.env.WHATSAPP_AUTH_BUTTON_TYPE || config.whatsapp?.buttonType || 'COPY_CODE').toUpperCase();

    // 1. Validate mandatory credentials (fail-closed in production)
    if (!accessToken || !phoneNumberId || !templateName) {
      if (config.isProduction) {
        throw new Error(
          'WhatsApp Business credentials (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME) are required in production.'
        );
      }
      return {
        success: false,
        provider: this.name,
        error: 'WhatsApp Business credentials not configured.',
      };
    }

    // 2. Validate clean phone number length
    if (cleanMobile.length < 10 || cleanMobile.length > 15) {
      return {
        success: false,
        provider: this.name,
        error: 'Invalid recipient phone number format for WhatsApp delivery.',
      };
    }

    // 3. Build template components according to WhatsApp Cloud API Authentication template specification
    const components: any[] = [
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: params.otpCode,
          },
        ],
      },
    ];

    // DEFECT-INT-01: Support text-only OTP templates when buttonType is 'NONE'
    if (buttonType === 'COPY_CODE') {
      components.push({
        type: 'button',
        sub_type: 'copy_code',
        index: '0',
        parameters: [
          {
            type: 'text',
            text: params.otpCode,
          },
        ],
      });
    } else if (buttonType === 'URL') {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [
          {
            type: 'text',
            text: params.otpCode,
          },
        ],
      });
    } else if (buttonType === 'NONE') {
      // Intentionally omit button component for text-only OTP templates
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanMobile,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: templateLanguage,
        },
        components,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s gateway timeout

    try {
      if (config.nodeEnv !== 'test') {
        console.log(`[WHATSAPP-DISPATCH] Dispatching OTP message to ${maskedMobile} (template: ${templateName})`);
      }

      const endpoint = `${apiUrl.replace(/\/+$/, '')}/${apiVersion}/${phoneNumberId}/messages`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseData: any = await response.json().catch(() => null);

      if (!response.ok || !responseData) {
        const errorDetails =
          responseData?.error?.message ||
          responseData?.error?.error_data?.details ||
          `WhatsApp Cloud API returned HTTP ${response.status}`;

        // Ensure token or secret material is never printed in logs
        const sanitizedError = errorDetails.replace(new RegExp(accessToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED_TOKEN]');

        console.error(`[WHATSAPP-ERROR] Delivery to ${maskedMobile} failed: ${sanitizedError}`);
        return {
          success: false,
          provider: this.name,
          error: sanitizedError,
        };
      }

      const messageId = responseData.messages?.[0]?.id;

      if (!messageId || typeof messageId !== 'string' || !messageId.trim()) {
        const errorMsg = `WhatsApp Cloud API returned HTTP ${response.status} but response payload is missing a valid message ID.`;
        console.error(`[WHATSAPP-ERROR] Delivery to ${maskedMobile} failed: ${errorMsg}`);
        return {
          success: false,
          provider: this.name,
          error: errorMsg,
        };
      }

      return {
        success: true,
        provider: this.name,
        messageId: messageId.trim(),
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('WhatsApp Business Cloud API gateway timed out.');
      }
      // Ensure token is not leaked in network error messages
      const safeMessage = err.message
        ? err.message.replace(new RegExp(accessToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED_TOKEN]')
        : 'Unknown network error';
      throw new Error(`WhatsApp Business API delivery network error: ${safeMessage}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
