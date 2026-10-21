function validateProductionApiUrl(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      'Production requires EXPO_PUBLIC_API_URL targeting the canonical /api/v1 endpoint.'
    );
  }

  const value = raw.trim();
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('The production API URL must use HTTPS.');
  }

  const expectedHost = (
    process.env.EXPO_PUBLIC_ALLOWED_API_HOST || 'hsspl.algions.in'
  )
    .toLowerCase()
    .trim();

  const allowedHosts = Array.from(new Set([expectedHost, 'hsspl.algions.in', 'hsspl.aglions.in']));

  if (
    !allowedHosts.includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname.replace(/\/+$/, '') !== '/api/v1' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      `The production mobile API URL must target https://${expectedHost}/api/v1.`
    );
  }

  return value.replace(/\/+$/, '');
}

module.exports = { validateProductionApiUrl };
