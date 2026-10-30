import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env.test if it exists, otherwise load .env
const testEnvPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath, override: true });
} else {
  dotenv.config();
}

// Force test environment
process.env.NODE_ENV = 'test';

// Ensure DATABASE_URL points to test database ending in _test
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('_test')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/(\/hiralal_rewards)(\?|$)/, '$1_test$2');
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:1234@localhost:5432/hiralal_rewards_test?schema=public';
}
