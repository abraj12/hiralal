module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 30,
      functions: 38,
      lines: 52
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
      lines: 75
    },
    './src/services/reward.service.ts': {
      lines: 70
    }
  }
};
