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
    ? Math.floor((eligibleRewardAmount * (rewardPercentage / 100) * 100) + 1e-9) / 100
    : 0.0;

  return {
    gstAmount,
    eligibleRewardAmount,
    calculatedReward,
  };
}

/**
 * Sanitizes external document preview URLs to strictly allow https: protocols or localhost.
 * Prevents javascript: or dangerous protocol injection (SEC-HIGH-12, RED-01).
 * Supports safe relative paths with query parameters and hash fragments while strictly
 * blocking directory traversal (including multi-pass percent-encoded variants) and protocol-relative prefixes.
 */
export function safeDocumentUrl(url: string | undefined | null): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (!trimmed) return '#';

  // Iteratively decode URI components (up to 5 passes) to unpack nested/double-encoded payloads (e.g., %252e%252e)
  let decoded = trimmed;
  for (let i = 0; i < 5; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return '#';
    }
  }

  // Reject backslashes completely to prevent browser protocol-relative normalization (e.g. /\attacker.com)
  if (decoded.includes('\\') || trimmed.includes('\\')) {
    return '#';
  }

  // VULN-FRONT-01 / RED-01: Reject directory traversal sequences (both raw and decoded)
  if (trimmed.includes('..') || decoded.includes('..')) {
    return '#';
  }

  // Reject protocol-relative URLs (e.g. //attacker.com or encoded %2F%2Fattacker.com)
  if (
    /^\s*[/\\]{2,}/.test(trimmed) ||
    /^\s*[/\\]{2,}/.test(decoded) ||
    trimmed.startsWith('//') ||
    decoded.startsWith('//') ||
    decoded.trimStart().startsWith('//')
  ) {
    return '#';
  }

  // Strict relative path validation - safely allows valid query strings and hash parameters (e.g. ? and #)
  if (/^(?:\/(?!\/|\\)|\?|#)[\w\-.~%!$&'()*+,;=:@/?#]*$/.test(trimmed)) {
    return trimmed;
  }

  // External URLs strictly restricted to designated Cloudflare R2 / S3 storage hosts, authorized app domains, or localhost
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://localhost') || trimmed.startsWith('http://127.0.0.1')) {
    try {
      const parsed = new URL(trimmed);
      const isHttps = parsed.protocol === 'https:';
      const isLocal = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

      if (!isHttps && !isLocal) {
        return '#';
      }

      const hostname = parsed.hostname.toLowerCase();
      const isAllowedHost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === 's3.amazonaws.com' ||
        hostname.endsWith('.s3.amazonaws.com') ||
        /\.s3[.-][\w-]+\.amazonaws\.com$/.test(hostname) ||
        hostname.endsWith('.r2.cloudflarestorage.com') ||
        hostname.endsWith('.r2.dev') ||
        hostname.endsWith('.cloudfront.net') ||
        hostname === 'hsspl.algions.in' ||
        hostname.endsWith('.hsspl.algions.in') ||
        hostname === 'hiralalandsons.com' ||
        hostname.endsWith('.hiralalandsons.com') ||
        hostname === 'hiralalandsonspvtltd.com' ||
        hostname.endsWith('.hiralalandsonspvtltd.com');

      if (isAllowedHost) {
        return trimmed;
      }
    } catch {
      return '#';
    }
  }

  return '#';
}
