/**
 * Admin Panel API URL Resolution Utility
 * Enforces production-safe API routing: defaults to same-origin '/api'
 * and rejects insecure remote HTTP URLs.
 */
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
      console.warn('Insecure HTTP API URL rejected in production. Falling back to same-origin /api');
      return '/api';
    }
    return trimmed;
  }
  // Safe production default: same-origin /api reverse proxy route
  return '/api';
}
