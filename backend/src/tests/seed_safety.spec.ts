import { assertDemoSeedAllowed } from '../prisma/seed';

describe('Phase 3 — Database Seeding Safety & Production Guard', () => {
  it('fails closed and throws error when NODE_ENV is production, even if ENABLE_DEMO_SEED=true', () => {
    expect(() => assertDemoSeedAllowed('production', 'true')).toThrow('Demo seed is disabled in production.');
  });

  it('fails closed when ENABLE_DEMO_SEED is not true in non-production environments', () => {
    expect(() => assertDemoSeedAllowed('development', undefined)).toThrow('Set ENABLE_DEMO_SEED=true to provision demo users.');
    expect(() => assertDemoSeedAllowed('development', 'false')).toThrow('Set ENABLE_DEMO_SEED=true to provision demo users.');
  });

  it('allows demo seeding only when explicitly requested in non-production (ENABLE_DEMO_SEED=true)', () => {
    expect(() => assertDemoSeedAllowed('development', 'true')).not.toThrow();
    expect(() => assertDemoSeedAllowed('test', 'true')).not.toThrow();
  });
});
