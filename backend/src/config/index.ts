import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  serviceRole: 'api' | 'worker' | 'migration' | 'cron';
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
  admin: {
    billAdminPrefix: string;
    operationsAdminPrefix: string;
    accessTokenExpiresIn: string;
    accessSecret: string;
    billAdminMobile?: string;
    operationsAdminMobile?: string;
    billAdminInitialPassword?: string;
    operationsAdminInitialPassword?: string;
  };
  otp: {
    ttlSeconds: number;
  };
  timezone: string;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const rawRole = (process.env.SERVICE_ROLE || 'api').toLowerCase();
const ALLOWED_ROLES = ['api', 'worker', 'migration', 'cron'] as const;
type ServiceRole = typeof ALLOWED_ROLES[number];

if (!ALLOWED_ROLES.includes(rawRole as any)) {
  throw new Error(`[FATAL] Invalid SERVICE_ROLE "${rawRole}". Allowed roles: ${ALLOWED_ROLES.join(', ')}`);
}
const serviceRole = rawRole as ServiceRole;

/**
 * Helper to identify unsafe example, placeholder, or low-entropy default values.
 * Never prints secret values in errors or logs.
 */
export function isUnsafeProductionValue(name: string, value: string | undefined): boolean {
  if (!value || !value.trim()) {
    return true;
  }

  const normalized = value.trim().toLowerCase();

  const forbiddenExactValues = new Set([
    'changeme',
    'change_me',
    'your_secret_here',
    'replace_me',
    'password',
    'secret',
    'admin@123',
    'user@123',
    'change_this_to_a_strong_password_in_production',
  ]);

  if (forbiddenExactValues.has(normalized)) {
    return true;
  }

  const placeholderPatterns = [
    /^your[-_ ]/,
    /^replace[-_ ]/,
    /^change[-_ ]/,
    /^example[-_ ]/,
    /^placeholder(?:[-_ ]|$)/,
    /^generate(?:[-_ ]|$)/,
    /<[^>]+>/,
    /sample_dev_only/,
    /dev_access_secret/,
    /dev_refresh_secret/,
    /change_this/,
    /replace_with_/,
  ];

  return placeholderPatterns.some((pattern) => pattern.test(normalized));
}

export function validateProductionConfig(role: ServiceRole = serviceRole, env: Record<string, string | undefined> = process.env): void {
  const commonVars = [
    'DATABASE_URL',
    'ENCRYPTION_KEY',
    'FIELD_ENCRYPTION_KEY',
  ];

  const apiOnlyVars = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_ADMIN_ACCESS_SECRET',
    'BILL_ADMIN_PREFIX',
    'OPERATIONS_ADMIN_PREFIX',
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

  const workerOnlyVars = [
    'RAZORPAYX_KEY_ID',
    'RAZORPAYX_KEY_SECRET',
    'RAZORPAYX_ACCOUNT_NUMBER',
  ];

  let mandatoryVars: string[] = [...commonVars];
  if (role === 'api') {
    mandatoryVars = [...mandatoryVars, ...apiOnlyVars];
  } else if (role === 'worker') {
    mandatoryVars = [...mandatoryVars, ...workerOnlyVars];
  }

  const missing = mandatoryVars.filter((v) => !env[v] || env[v]?.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `[FATAL] Production startup halted for role "${role}". Missing required environment variables: ${missing.join(', ')}`
    );
  }

  for (const v of mandatoryVars) {
    const val = env[v];
    if (isUnsafeProductionValue(v, val)) {
      throw new Error(
        `[FATAL] Production startup halted for role "${role}". Environment variable "${v}" contains an insecure placeholder or example value.`
      );
    }
  }

  // Ensure cryptographic keys are at least 32 characters
  if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length < 32) {
    throw new Error('[FATAL] ENCRYPTION_KEY must be at least 32 characters for AES-256 encryption.');
  }

  if (env.FIELD_ENCRYPTION_KEY && env.FIELD_ENCRYPTION_KEY.length < 32) {
    throw new Error('[FATAL] FIELD_ENCRYPTION_KEY must be at least 32 characters for AES-256 encryption.');
  }

  if (role === 'api') {
    if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET.length < 32) {
      throw new Error('[FATAL] JWT_ACCESS_SECRET must be at least 32 characters for secure signing.');
    }
    if (env.JWT_REFRESH_SECRET && env.JWT_REFRESH_SECRET.length < 32) {
      throw new Error('[FATAL] JWT_REFRESH_SECRET must be at least 32 characters for secure signing.');
    }
    if (env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      throw new Error('[FATAL] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets.');
    }
    if (env.STORAGE_HMAC_SECRET && env.STORAGE_HMAC_SECRET.length < 16) {
      throw new Error('[FATAL] STORAGE_HMAC_SECRET must be at least 16 characters for HMAC signing.');
    }
    if (env.JWT_ADMIN_ACCESS_SECRET) {
      if (env.JWT_ADMIN_ACCESS_SECRET.length < 32) {
        throw new Error('[FATAL] JWT_ADMIN_ACCESS_SECRET must be at least 32 characters for secure signing.');
      }
      if (env.JWT_ACCESS_SECRET && env.JWT_ADMIN_ACCESS_SECRET === env.JWT_ACCESS_SECRET) {
        throw new Error('[FATAL] JWT_ADMIN_ACCESS_SECRET and JWT_ACCESS_SECRET must be distinct secrets.');
      }
      if (env.JWT_REFRESH_SECRET && env.JWT_ADMIN_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
        throw new Error('[FATAL] JWT_ADMIN_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets.');
      }
    }
    if (env.OTP_TTL_SECONDS) {
      const ttl = parseInt(env.OTP_TTL_SECONDS, 10);
      if (isNaN(ttl) || ttl <= 0 || ttl > 300) {
        throw new Error('[FATAL] OTP_TTL_SECONDS must be between 1 and 300 seconds (5 minutes maximum).');
      }
    }
    if (env.BILL_ADMIN_PREFIX && env.OPERATIONS_ADMIN_PREFIX) {
      const p1 = env.BILL_ADMIN_PREFIX.trim().toUpperCase();
      const p2 = env.OPERATIONS_ADMIN_PREFIX.trim().toUpperCase();
      if (!p1 || !p2 || p1 === p2) {
        throw new Error('[FATAL] BILL_ADMIN_PREFIX and OPERATIONS_ADMIN_PREFIX must be distinct non-empty prefixes.');
      }
    }
    if (env.BILL_ADMIN_MOBILE && env.OPERATIONS_ADMIN_MOBILE) {
      const m1 = env.BILL_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      const m2 = env.OPERATIONS_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      if (m1 && m2 && m1 === m2) {
        throw new Error('[FATAL] BILL_ADMIN_MOBILE and OPERATIONS_ADMIN_MOBILE must be distinct mobile numbers.');
      }
    }
    if (env.ADMIN_INITIAL_PASSWORD && env.ADMIN_INITIAL_PASSWORD.length < 8) {
      throw new Error('[FATAL] ADMIN_INITIAL_PASSWORD must be at least 8 characters.');
    }
  }
}

export function normalizeAdminPrefix(prefix: string | undefined): string {
  if (!prefix) return '';
  return prefix.trim().toUpperCase();
}

export function isValidDuration(duration: string | undefined): boolean {
  if (!duration) return false;
  return /^\d+[smhdwy]$/.test(duration.trim());
}

// Global OTP TTL validation
const rawOtpTtl = process.env.OTP_TTL_SECONDS;
if (rawOtpTtl !== undefined) {
  const parsedOtp = parseInt(rawOtpTtl, 10);
  if (isNaN(parsedOtp) || parsedOtp <= 0 || parsedOtp > 300) {
    throw new Error('[FATAL] OTP_TTL_SECONDS must not exceed 300 seconds (5 minutes maximum).');
  }
}

// Global Admin Prefix collision check
const rawBillPrefix = normalizeAdminPrefix(process.env.BILL_ADMIN_PREFIX || 'XYZ');
const rawOpsPrefix = normalizeAdminPrefix(process.env.OPERATIONS_ADMIN_PREFIX || 'ABC');
if (rawBillPrefix && rawOpsPrefix && rawBillPrefix === rawOpsPrefix) {
  throw new Error('[FATAL] BILL_ADMIN_PREFIX and OPERATIONS_ADMIN_PREFIX must not collide after normalization.');
}

// Production Fail-Fast Validation
if (isProduction) {
  validateProductionConfig(serviceRole, process.env);
}

const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000';
const allowedOrigins = allowedOriginsEnv
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const config: AppConfig = {
  serviceRole,
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
    webhookSecret:
      process.env.RAZORPAYX_WEBHOOK_SECRET ||
      (nodeEnv === 'production' ? '' : 'webhook_secret_hiralal_rzpx_2026'),
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

  admin: {
    billAdminPrefix: rawBillPrefix,
    operationsAdminPrefix: rawOpsPrefix,
    accessTokenExpiresIn: process.env.ADMIN_ACCESS_TOKEN_EXPIRES_IN || '1d',
    accessSecret: process.env.JWT_ADMIN_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET || 'dev_admin_access_secret_key_hiralal_2026',
    billAdminMobile: process.env.BILL_ADMIN_MOBILE,
    operationsAdminMobile: process.env.OPERATIONS_ADMIN_MOBILE,
    billAdminInitialPassword: process.env.BILL_ADMIN_INITIAL_PASSWORD,
    operationsAdminInitialPassword: process.env.OPERATIONS_ADMIN_INITIAL_PASSWORD,
  },

  otp: {
    ttlSeconds: (() => {
      const parsed = parseInt(process.env.OTP_TTL_SECONDS || '300', 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > 300) return 300;
      return parsed;
    })(),
  },

  timezone: 'Asia/Kolkata',
};
