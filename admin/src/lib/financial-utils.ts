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

  // Decode URI components safely to catch obfuscated/encoded traversals or backslashes (%5C, %2F%2F)
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return '#';
  }

  // Reject backslashes completely to prevent browser protocol-relative normalization (e.g. /\attacker.com)
  if (decoded.includes('\\') || trimmed.includes('\\')) {
    return '#';
  }
  // Reject protocol-relative URLs (e.g. //attacker.com)
  if (/^[/\\]{2,}/.test(trimmed) || /^[/\\]{2,}/.test(decoded)) {
    return '#';
  }
  // Strict relative path validation
  if (/^\/(?!\/|\\)[\w\-.~%!$&'()*+,;=:@/]*$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://localhost') || trimmed.startsWith('http://127.0.0.1')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))) {
        return trimmed;
      }
    } catch {
      return '#';
    }
  }
  return '#';
}
