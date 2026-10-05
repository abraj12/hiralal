import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  databaseUrl: string;
  encryptionKey: string;
  fieldEncryptionKey: string;
  storageHmacSecret: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  redis: {
    url?: string;
    host: string;
    port: number;
    password?: string;
  };
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    endpoint: string;
    publicUrl?: string;
  };
  signcare: {
    baseUrl: string;
    apiKey: string;
    appId: string;
  };
  razorpayx: {
    keyId: string;
    keySecret: string;
    accountNumber: string;
    webhookSecret: string;
  };
  sms: {
    provider: string;
    apiKey: string;
    authKey: string;
    templateId: string;
    senderId: string;
  };
  cors: {
    allowedOrigins: string[];
  };
  rewards: {
    defaultPercentage: number;
    monthlyPoolCap: number;
    minRedemptionAmount: number;
    maxRedemptionAmount: number;
  };
  timezone: string;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Production Fail-Fast Validation
if (isProduction) {
  const mandatoryVars = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ENCRYPTION_KEY',
    'FIELD_ENCRYPTION_KEY',
    'STORAGE_HMAC_SECRET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'SIGNCARE_API_KEY',
    'SIGNCARE_APP_ID',
    'RAZORPAYX_KEY_ID',
    'RAZORPAYX_KEY_SECRET',
    'RAZORPAYX_ACCOUNT_NUMBER',
    'RAZORPAYX_WEBHOOK_SECRET',
    'MSG91_AUTH_KEY',
    'MSG91_TEMPLATE_ID',
    'CORS_ALLOWED_ORIGINS',
    'ADMIN_INITIAL_PASSWORD',
  ];

  const missing = mandatoryVars.filter((v) => !process.env[v] || process.env[v]?.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `[FATAL] Production startup halted. Missing required environment variables: ${missing.join(', ')}`
    );
  }

  // Ensure encryption key is 32 bytes (64 hex characters)
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
    throw new Error('[FATAL] ENCRYPTION_KEY must be at least 32 characters for AES-256 encryption.');
  }
}

const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000';
const allowedOrigins = allowedOriginsEnv
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  isProduction,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/hiralal_rewards?schema=public',
  encryptionKey: process.env.ENCRYPTION_KEY || 'hiralal_aes256_secret_key_32bytes_sample_dev_only!',
  fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY || 'hiralal_field_aes256_32bytes_key_dev_only!',
  storageHmacSecret: process.env.STORAGE_HMAC_SECRET || 'hiralal_dev_storage_hmac_secret_2026',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev_access_secret_key_hiralal_2026',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_key_hiralal_2026',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'hiralal-invoices-private',
    endpoint:
      process.env.R2_ENDPOINT ||
      (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL || '',
  },

  signcare: {
    baseUrl: process.env.SIGNCARE_BASE_URL || 'https://uat.signcare.in',
    apiKey: process.env.SIGNCARE_API_KEY || '',
    appId: process.env.SIGNCARE_APP_ID || '',
  },

  razorpayx: {
    keyId: process.env.RAZORPAYX_KEY_ID || '',
    keySecret: process.env.RAZORPAYX_KEY_SECRET || '',
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || '',
    webhookSecret: process.env.RAZORPAYX_WEBHOOK_SECRET || '',
  },

  sms: {
    provider: (process.env.SMS_PROVIDER || 'MSG91').toUpperCase(),
    apiKey: process.env.SMS_API_KEY || process.env.MSG91_AUTH_KEY || '',
    authKey: process.env.MSG91_AUTH_KEY || process.env.SMS_API_KEY || '',
    templateId: process.env.MSG91_TEMPLATE_ID || '',
    senderId: process.env.MSG91_SENDER_ID || process.env.SMS_SENDER_ID || 'HIRALAL',
  },

  cors: {
    allowedOrigins,
  },

  rewards: {
    defaultPercentage: parseFloat(process.env.DEFAULT_REWARD_PERCENTAGE || '0.5'),
    monthlyPoolCap: parseFloat(process.env.MONTHLY_REWARD_POOL_CAP || '50000'),
    minRedemptionAmount: parseFloat(process.env.MIN_REDEMPTION_AMOUNT || '500'),
    maxRedemptionAmount: parseFloat(process.env.MAX_REDEMPTION_AMOUNT || '10000'),
  },

  timezone: 'Asia/Kolkata',
};
