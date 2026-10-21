module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  // F-01: Global teardown removes seeded test admin users after the suite to prevent cross-run pollution
  globalTeardown: '<rootDir>/src/tests/setup/global-teardown.ts',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70
    },
    './src/utils/crypto.utils.ts': {
      lines: 90
    },
    './src/utils/money.utils.ts': {
      lines: 80
    },
    './src/services/auth.service.ts': {
      lines: 70
    },
    './src/services/bill.service.ts': {
      lines: 70
    },
    './src/services/payout.service.ts': {
      lines: 70
    },
    './src/services/reward.service.ts': {
      lines: 70
    }
  }
};
