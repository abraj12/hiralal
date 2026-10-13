export function validateProductionApiUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') {
    throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL targeting /api/v1.');
  }
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) {
    throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL.');
  }
  if (!trimmed.endsWith('/api/v1')) {
    throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL targeting /api/v1.');
  }
  return trimmed;
}
