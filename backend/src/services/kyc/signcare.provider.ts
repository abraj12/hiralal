import { KycProvider, PanVerificationResult } from './kyc.interface';
import { config } from '../../config';

export class SignCareKycProvider implements KycProvider {
  name = 'SIGNCARE';

  private maskPanForLog(pan: string): string {
    if (pan.length !== 10) return '••••••••••';
    return `${pan.substring(0, 3)}••••${pan.substring(7)}`;
  }

  async verifyPan(params: {
    panNumber: string;
    panName: string;
    userId: string;
    requestId?: string;
  }): Promise<PanVerificationResult> {
    const cleanPan = params.panNumber.trim().toUpperCase();
    const maskedPan = this.maskPanForLog(cleanPan);

    if (!config.signcare.apiKey || !config.signcare.appId) {
      if (config.isProduction) {
        throw new Error('SignCare KYC credentials (SIGNCARE_API_KEY, SIGNCARE_APP_ID) are required in production.');
      }
      throw new Error('SignCare provider credentials not configured.');
    }

    const url = `${config.signcare.baseUrl.replace(/\/$/, '')}/api/v1/pan/verify`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      if (config.nodeEnv !== 'test') {
        console.log(`[KYC-DISPATCH] SignCare verification initiated for PAN ${maskedPan} (reqId: ${params.requestId || 'n/a'})`);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-API-KEY': config.signcare.apiKey,
          'X-API-APP-ID': config.signcare.appId,
          'Content-Type': 'application/json',
          'X-Request-Id': params.requestId || `req-pan-${Date.now()}`,
        },
        body: JSON.stringify({
          pan: cleanPan,
          consent: 'Y',
          consent_text: 'I provide consent to verify my PAN identity for rewards payout compliance.',
        }),
        signal: controller.signal,
      });

      const responseData: any = await response.json().catch(() => null);

      if (!response.ok || !responseData) {
        const errorMsg = responseData?.message || responseData?.error || `SignCare returned HTTP ${response.status}`;
        return {
          isValid: false,
          panNumber: cleanPan,
          panName: params.panName,
          providerRequestId: responseData?.request_id || responseData?.requestId,
          rejectionReason: errorMsg,
        };
      }

      // Check SignCare success response status
      const isSuccess =
        responseData.status === 'SUCCESS' ||
        responseData.success === true ||
        responseData.data?.status === 'VALID' ||
        responseData.data?.pan_status === 'EXISTING AND VALID';

      const verifiedName = responseData.data?.full_name || responseData.data?.name || params.panName;

      return {
        isValid: isSuccess,
        panNumber: cleanPan,
        panName: verifiedName,
        providerRequestId: responseData.request_id || responseData.requestId || responseData.data?.client_id,
        providerStatus: responseData.status || (isSuccess ? 'VALID' : 'INVALID'),
        rejectionReason: isSuccess ? undefined : (responseData.message || 'PAN status is inactive or invalid with tax database'),
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('PAN verification timed out. Please try again later.');
      }
      throw new Error(`SignCare verification network error: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
