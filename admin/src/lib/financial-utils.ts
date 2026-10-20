/**
 * Live Financial Calculation Utilities for Invoice Verification
 * Computes reverse GST and effective-dated reward values with paise precision.
 */
export function calculateBillFinancials(
  grossAmount: number,
  gstIncluded: boolean,
  selectedGstRate: number,
  rewardPercentage: number | null
) {
  const gstAmount = gstIncluded && selectedGstRate > 0
    ? Math.round(((grossAmount * selectedGstRate) / (100 + selectedGstRate)) * 100) / 100
    : 0.0;

  const eligibleRewardAmount = Math.max(0, Math.round((grossAmount - gstAmount) * 100) / 100);

  const calculatedReward = rewardPercentage !== null
    ? Math.round(eligibleRewardAmount * (rewardPercentage / 100) * 100) / 100
    : 0.0;

  return {
    gstAmount,
    eligibleRewardAmount,
    calculatedReward,
  };
}

/**
 * Sanitizes external document preview URLs to strictly allow https: protocols.
 * Prevents javascript: or dangerous protocol injection (SEC-HIGH-12).
 */
export function safeDocumentUrl(url: string | undefined | null): string {
  if (!url) return '#';
  const trimmed = url.trim();
  // Reject protocol-relative URLs (e.g. //attacker.com) to prevent open redirects (Finding G-02)
  if (trimmed.startsWith('//')) {
    return '#';
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://localhost') || trimmed.startsWith('/')) {
    return trimmed;
  }
  return '#';
}
