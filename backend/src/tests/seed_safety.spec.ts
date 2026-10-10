import { assertDemoSeedAllowed } from '../prisma/seed';

describe('Phase 3 — Database Seeding Safety & Production Guard', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails closed and throws error when NODE_ENV is production, even if ENABLE_DEMO_SEED=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEMO_SEED = 'true';

    expect(() => assertDemoSeedAllowed()).toThrow('Demo seed is disabled in production.');
  });

  it('fails closed when ENABLE_DEMO_SEED is not true in non-production environments', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_DEMO_SEED;

    expect(() => assertDemoSeedAllowed()).toThrow('Set ENABLE_DEMO_SEED=true to provision demo users.');
  });

  it('allows demo seeding only when explicitly requested in non-production (ENABLE_DEMO_SEED=true)', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEMO_SEED = 'true';

    expect(() => assertDemoSeedAllowed()).not.toThrow();
  });
});
