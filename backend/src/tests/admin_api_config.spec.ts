import { getAdminApiBase } from '../utils/adminApi.utils';

describe('Phase 4 — Admin Panel Production API URL & Hardening', () => {
  it('defaults to same-origin /api/v1 reverse proxy route when NEXT_PUBLIC_API_URL is unset', () => {
    expect(getAdminApiBase(undefined, 'production')).toBe('/api/v1');
  });

  it('rejects insecure plain HTTP remote URLs in production and falls back to /api/v1', () => {
    expect(getAdminApiBase('http://api.insecure-remote.hiralal.com/api', 'production')).toBe('/api/v1');
  });

  it('accepts secure HTTPS URLs in production', () => {
    expect(getAdminApiBase('https://hsspl.algions.in/api/v1', 'production')).toBe('https://hsspl.algions.in/api/v1');
  });

  it('accepts relative same-origin paths in production', () => {
    expect(getAdminApiBase('/api/v1', 'production')).toBe('/api/v1');
  });

  it('permits localhost or 127.0.0.1 in non-production development environments', () => {
    expect(getAdminApiBase('http://localhost:5000/api', 'development')).toBe('http://localhost:5000/api');
  });
});
