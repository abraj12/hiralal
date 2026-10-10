export interface PanVerificationResult {
  isValid: boolean;
  panNumber: string;
  panName: string;
  providerRequestId?: string;
  providerStatus?: string;
  rejectionReason?: string;
}

export interface KycProvider {
  name: string;
  verifyPan(params: {
    panNumber: string;
    panName: string;
    userId: string;
    consent?: boolean;
    consentText?: string;
    requestId?: string;
  }): Promise<PanVerificationResult>;
}
