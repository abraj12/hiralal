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
    consent?: boolean;
    consentText?: string;
    requestId?: string;
  }): Promise<PanVerificationResult> {
    const cleanPan = params.panNumber.trim().toUpperCase();
    const maskedPan = this.maskPanForLog(cleanPan);

    // Fail-closed consent check
    if (params.consent !== true) {
      return {
        isValid: false,
        panNumber: cleanPan,
        panName: '',
        rejectionReason: 'User informed consent is mandatory before querying tax verification database.',
      };
    }

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
          consent_text: params.consentText || 'I provide consent to verify my PAN identity for rewards payout compliance.',
        }),
        signal: controller.signal,
      });

      const responseData: any = await response.json().catch(() => null);

      if (!response.ok || !responseData) {
        const errorMsg = responseData?.message || responseData?.error || `SignCare returned HTTP ${response.status}`;
        return {
          isValid: false,
          panNumber: cleanPan,
          panName: '',
          providerRequestId: responseData?.request_id || responseData?.requestId,
          rejectionReason: errorMsg,
        };
      }

      // Check SignCare documented success response status
      const isSuccess =
        (responseData.status === 'SUCCESS' || responseData.success === true) &&
        (responseData.data?.status === 'VALID' || responseData.data?.pan_status === 'EXISTING AND VALID');

      // STRICT: Authoritative verified name MUST come from the provider, never user input
      const verifiedName = (responseData.data?.full_name || responseData.data?.name || '').trim();

      if (!isSuccess) {
        return {
          isValid: false,
          panNumber: cleanPan,
          panName: '',
          providerRequestId: responseData.request_id || responseData.requestId || responseData.data?.client_id,
          providerStatus: responseData.status || 'INVALID',
          rejectionReason: responseData.message || responseData.data?.pan_status || 'PAN status is inactive or invalid with tax database',
        };
      }

      if (!verifiedName) {
        return {
          isValid: false,
          panNumber: cleanPan,
          panName: '',
          providerRequestId: responseData.request_id || responseData.requestId || responseData.data?.client_id,
          providerStatus: responseData.status || 'INVALID',
          rejectionReason: 'Provider response missing authoritative PAN holder name.',
        };
      }

      return {
        isValid: true,
        panNumber: cleanPan,
        panName: verifiedName,
        providerRequestId: responseData.request_id || responseData.requestId || responseData.data?.client_id,
        providerStatus: responseData.status || 'VALID',
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
