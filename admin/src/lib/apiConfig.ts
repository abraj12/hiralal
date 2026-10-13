export function getAdminApiBase(
  envUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL,
  nodeEnv: string | undefined = process.env.NODE_ENV
): string {
  if (envUrl && envUrl.trim()) {
    const trimmed = envUrl.trim();
    // Reject insecure remote HTTP URLs in production
    if (
      nodeEnv === 'production' &&
      trimmed.startsWith('http://') &&
      !trimmed.includes('localhost') &&
      !trimmed.includes('127.0.0.1')
    ) {
      console.warn('Insecure HTTP API URL rejected in production. Falling back to same-origin /api/v1');
      return '/api/v1';
    }
    return trimmed;
  }
  // Safe production default: same-origin /api/v1 reverse proxy route
  return '/api/v1';
}
