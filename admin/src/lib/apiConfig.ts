export function getAdminApiBase(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.trim()) {
    const trimmed = envUrl.trim();
    // Reject insecure remote HTTP URLs in production
    if (
      process.env.NODE_ENV === 'production' &&
      trimmed.startsWith('http://') &&
      !trimmed.includes('localhost') &&
      !trimmed.includes('127.0.0.1')
    ) {
      console.warn('Insecure HTTP API URL rejected in production. Falling back to same-origin /api');
      return '/api';
    }
    return trimmed;
  }
  // Safe production default: same-origin /api reverse proxy route
  return '/api';
}
