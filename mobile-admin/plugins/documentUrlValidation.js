/**
 * Strict Document URL Resolver & Allowlist Validator for Hiralal Admin Mobile
 */

const ALLOWED_DOC_HOST_PATTERNS = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^(?:[a-zA-Z0-9-]+\.)*s3\.amazonaws\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*r2\.cloudflarestorage\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*r2\.dev$/,
  /^(?:[a-zA-Z0-9-]+\.)*cloudfront\.net$/,
  /^(?:[a-zA-Z0-9-]+\.)*hsspl\.algions\.in$/,
  /^(?:[a-zA-Z0-9-]+\.)*hiralalandsons\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*hiralalandsonspvtltd\.com$/,
];

function isAllowedDocumentUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  const clean = url.trim();
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    if (parsed.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      return false;
    }
    return ALLOWED_DOC_HOST_PATTERNS.some((p) => p.test(parsed.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

function resolveDocumentUrl(url, apiBase = 'https://hsspl.algions.in/api') {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  const clean = url.trim();
  if (clean.startsWith('https://')) {
    try {
      const parsed = new URL(clean);
      const isAllowed = ALLOWED_DOC_HOST_PATTERNS.some((p) => p.test(parsed.hostname.toLowerCase()));
      return isAllowed ? clean : null;
    } catch {
      return null;
    }
  }
  if (clean.startsWith('http://')) {
    if (process.env.NODE_ENV === 'production') {
      return null;
    }
    try {
      const parsed = new URL(clean);
      const isAllowed = ALLOWED_DOC_HOST_PATTERNS.some((p) => p.test(parsed.hostname.toLowerCase()));
      return isAllowed ? clean : null;
    } catch {
      return null;
    }
  }

  // Reject unsupported protocols like javascript:, file:, data:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) {
    return null;
  }

  const baseOrigin = String(apiBase).replace(/\/api(\/v1)?\/?$/, '');
  return `${baseOrigin}${clean.startsWith('/') ? '' : '/'}${clean}`;
}

module.exports = {
  ALLOWED_DOC_HOST_PATTERNS,
  isAllowedDocumentUrl,
  resolveDocumentUrl,
};
