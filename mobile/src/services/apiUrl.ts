export function validateProductionApiUrl(
  raw: string | undefined | null
): string {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      'Production requires EXPO_PUBLIC_API_URL targeting the canonical /api/v1 endpoint.'
    );
  }

  const value = raw.trim();
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('The production API URL must use HTTPS.');
  }

  if (
    parsed.hostname.toLowerCase() !== 'hsspl.algions.in' ||
    parsed.pathname.replace(/\/+$/, '') !== '/api/v1' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'The production mobile API URL must target https://hsspl.algions.in/api/v1.'
    );
  }

  return value.replace(/\/+$/, '');
}
