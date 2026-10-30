const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment from .env.test if present, otherwise .env
const testEnvPath = path.resolve(__dirname, '../.env.test');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath, override: true });
} else {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// Ensure NODE_ENV is test
process.env.NODE_ENV = 'test';

// If TEST_DATABASE_URL is provided, prioritize it
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('_test')) {
  // Automatically target _test database
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/(\/hiralal_rewards)(\?|$)/, '$1_test$2');
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:1234@localhost:5432/hiralal_rewards_test?schema=public';
}

const args = process.argv.slice(2);
if (!args.includes('--runInBand')) {
  args.push('--runInBand');
}
if (!args.includes('--detectOpenHandles')) {
  args.push('--detectOpenHandles');
}
if (!args.includes('--forceExit')) {
  args.push('--forceExit');
}

const { run } = require('jest-cli');
run(args);
