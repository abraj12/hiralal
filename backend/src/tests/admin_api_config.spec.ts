import { getAdminApiBase } from '../utils/adminApi.utils';

describe('Phase 4 — Admin Panel Production API URL & Hardening', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to same-origin /api reverse proxy route when NEXT_PUBLIC_API_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    process.env.NODE_ENV = 'production';

    expect(getAdminApiBase()).toBe('/api');
  });

  it('rejects insecure plain HTTP remote URLs in production and falls back to /api', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_API_URL = 'http://api.insecure-remote.hiralal.com/api';

    expect(getAdminApiBase()).toBe('/api');
  });

  it('accepts secure HTTPS URLs in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_API_URL = 'https://api.hiralalandsons.com/api';

    expect(getAdminApiBase()).toBe('https://api.hiralalandsons.com/api');
  });

  it('accepts relative same-origin paths in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_API_URL = '/api';

    expect(getAdminApiBase()).toBe('/api');
  });

  it('permits localhost or 127.0.0.1 in non-production development environments', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:5000/api';

    expect(getAdminApiBase()).toBe('http://localhost:5000/api');
  });
});
