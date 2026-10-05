import { KycProvider, PanVerificationResult } from './kyc.interface';

export class MockKycProvider implements KycProvider {
  name = 'MOCK_KYC';

  async verifyPan(params: {
    panNumber: string;
    panName: string;
    userId: string;
    requestId?: string;
  }): Promise<PanVerificationResult> {
    const cleanPan = params.panNumber.trim().toUpperCase();

    if (cleanPan.startsWith('ERROR')) {
      throw new Error('SignCare verification network error: Gateway timeout');
    }

    if (cleanPan.startsWith('FAILP')) {
      return {
        isValid: false,
        panNumber: cleanPan,
        panName: params.panName,
        rejectionReason: 'PAN is invalid or not registered in the tax database',
      };
    }

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(cleanPan)) {
      return {
        isValid: false,
        panNumber: cleanPan,
        panName: params.panName,
        rejectionReason: 'Invalid PAN syntax format',
      };
    }

    return {
      isValid: true,
      panNumber: cleanPan,
      panName: params.panName || 'VERIFIED USER',
      providerRequestId: `mock-req-${Date.now()}`,
      providerStatus: 'VALID',
    };
  }
}
