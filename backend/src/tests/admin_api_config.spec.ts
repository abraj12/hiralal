import { getAdminApiBase } from '../utils/adminApi.utils';

describe('Phase 4 — Admin Panel Production API URL & Hardening', () => {
  it('defaults to same-origin /api reverse proxy route when NEXT_PUBLIC_API_URL is unset', () => {
    expect(getAdminApiBase(undefined, 'production')).toBe('/api');
  });

  it('rejects insecure plain HTTP remote URLs in production and falls back to /api', () => {
    expect(getAdminApiBase('http://api.insecure-remote.hiralal.com/api', 'production')).toBe('/api');
  });

  it('accepts secure HTTPS URLs in production', () => {
    expect(getAdminApiBase('https://api.hiralalandsons.com/api', 'production')).toBe('https://api.hiralalandsons.com/api');
  });

  it('accepts relative same-origin paths in production', () => {
    expect(getAdminApiBase('/api', 'production')).toBe('/api');
  });

  it('permits localhost or 127.0.0.1 in non-production development environments', () => {
    expect(getAdminApiBase('http://localhost:5000/api', 'development')).toBe('http://localhost:5000/api');
  });
});
