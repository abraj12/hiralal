import dotenv from 'dotenv';
import fs from 'fs';
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
  fcm: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };
  playIntegrity: {
    clientEmail: string;
    privateKey: string;
    packageName: string;
    allowedCertificateDigests: string[];
    allowMock: boolean;
    requireLicensing: boolean;
    enforceActions: boolean;
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
/**
 * Shared validator to detect placeholder, example, or unset credential strings.
 * Used for production config validation as well as third-party provider provisioning checks.
 */
export function isPlaceholderCredential(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLowerCase();

  const forbiddenExactValues = new Set([
    'changeme',
    'change_me',
    'your_secret_here',
    'replace_me',
    'password',
    'secret',
    'admin@123',
    'user@123',
    'billadmin@123',
    'opsadmin@123',
    'change_this_to_a_strong_password_in_production',
  ]);

  if (forbiddenExactValues.has(normalized)) {
    return true;
  }

  const forbiddenTokens = [
    'placeholder',
    'replace_with_',
    'your_secret_here',
    'sample_dev_only',
    'dev_access_secret',
    'dev_refresh_secret',
    'change_this',
  ];

  if (forbiddenTokens.some((token) => normalized.includes(token))) {
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
  ];

  return placeholderPatterns.some((pattern) => pattern.test(normalized));
}

export function isUnsafeProductionValue(name: string, value: string | undefined): boolean {
  if (!value || !value.trim()) {
    return true;
  }
  return isPlaceholderCredential(value);
}

export function validateProductionConfig(role: ServiceRole = serviceRole, env: Record<string, string | undefined> = process.env): void {
  const commonVars = [
    'DATABASE_URL',
    'ENCRYPTION_KEY',
    'FIELD_ENCRYPTION_KEY',
  ];

  const apiOnlyVars = [
    'REDIS_PASSWORD',
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
    'BILL_ADMIN_MOBILE',
    'OPERATIONS_ADMIN_MOBILE',
    'BILL_ADMIN_INITIAL_PASSWORD',
    'OPERATIONS_ADMIN_INITIAL_PASSWORD',
  ];

  const workerOnlyVars = [
    'REDIS_PASSWORD',
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

  // Ensure database URL parses cleanly
  if (env.DATABASE_URL) {
    try {
      const parsedDbUrl = new URL(env.DATABASE_URL);
      if (!['postgresql:', 'postgres:'].includes(parsedDbUrl.protocol)) {
        throw new Error('[FATAL] DATABASE_URL must use postgresql: or postgres: protocol.');
      }
    } catch (dbErr: any) {
      if (dbErr.message?.startsWith('[FATAL]')) throw dbErr;
      throw new Error('[FATAL] DATABASE_URL is not a valid parseable database connection URL.');
    }
  }

  // Ensure cryptographic keys are at least 32 characters
  if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length < 32) {
    throw new Error('[FATAL] ENCRYPTION_KEY must be at least 32 characters for AES-256 encryption.');
  }

  if (env.FIELD_ENCRYPTION_KEY && env.FIELD_ENCRYPTION_KEY.length < 32) {
    throw new Error('[FATAL] FIELD_ENCRYPTION_KEY must be at least 32 characters for AES-256 encryption.');
  }

  // Ensure Redis password in production is at least 24 characters
  if ((role === 'api' || role === 'worker') && env.REDIS_PASSWORD) {
    if (env.REDIS_PASSWORD.length < 24) {
      throw new Error('[FATAL] REDIS_PASSWORD must be at least 24 characters.');
    }
  }

  // Ensure STORAGE_HMAC_SECRET in production is at least 32 characters
  if (role === 'api' && env.STORAGE_HMAC_SECRET) {
    if (env.STORAGE_HMAC_SECRET.length < 32) {
      throw new Error('[FATAL] STORAGE_HMAC_SECRET must be at least 32 characters for HMAC signing.');
    }
  }

  if (role === 'api') {
    // Cloudflare R2 endpoint and account validation
    if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) {
      throw new Error(
        '[FATAL] Production startup halted for role "api". Missing required R2 configuration: either R2_ENDPOINT or R2_ACCOUNT_ID must be provided.'
      );
    }

    if (env.R2_ACCOUNT_ID && isUnsafeProductionValue('R2_ACCOUNT_ID', env.R2_ACCOUNT_ID)) {
      throw new Error(
        '[FATAL] Production startup halted for role "api". Environment variable "R2_ACCOUNT_ID" contains an insecure placeholder or example value.'
      );
    }

    if (env.R2_ENDPOINT && isUnsafeProductionValue('R2_ENDPOINT', env.R2_ENDPOINT)) {
      throw new Error(
        '[FATAL] Production startup halted for role "api". Environment variable "R2_ENDPOINT" contains an insecure placeholder or example value.'
      );
    }

    const r2EndpointToValidate =
      env.R2_ENDPOINT ||
      (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');

    try {
      const parsedR2Endpoint = new URL(r2EndpointToValidate);
      if (parsedR2Endpoint.protocol !== 'https:') {
        throw new Error('[FATAL] R2_ENDPOINT must use https: protocol.');
      }
    } catch (err: any) {
      if (err.message?.startsWith('[FATAL]')) {
        throw err;
      }
      throw new Error(`[FATAL] R2_ENDPOINT is not a valid URL: ${err.message}`);
    }

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
    if (env.ADMIN_INITIAL_PASSWORD) {
      throw new Error(
        '[FATAL] ADMIN_INITIAL_PASSWORD fallback is deprecated and forbidden in production. Configure separate BILL_ADMIN_INITIAL_PASSWORD and OPERATIONS_ADMIN_INITIAL_PASSWORD.'
      );
    }
    if (env.BILL_ADMIN_MOBILE) {
      const m1 = env.BILL_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      if (m1 === '9999999991') {
        throw new Error('[FATAL] Insecure default BILL_ADMIN_MOBILE (9999999991) is rejected in production.');
      }
      if (m1.length !== 10) {
        throw new Error('[FATAL] BILL_ADMIN_MOBILE must be a valid 10-digit Indian mobile number.');
      }
    }
    if (env.OPERATIONS_ADMIN_MOBILE) {
      const m2 = env.OPERATIONS_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      if (m2 === '9999999992') {
        throw new Error('[FATAL] Insecure default OPERATIONS_ADMIN_MOBILE (9999999992) is rejected in production.');
      }
      if (m2.length !== 10) {
        throw new Error('[FATAL] OPERATIONS_ADMIN_MOBILE must be a valid 10-digit Indian mobile number.');
      }
    }
    if (env.BILL_ADMIN_MOBILE && env.OPERATIONS_ADMIN_MOBILE) {
      const m1 = env.BILL_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      const m2 = env.OPERATIONS_ADMIN_MOBILE.replace(/\D/g, '').slice(-10);
      if (m1 && m2 && m1 === m2) {
        throw new Error('[FATAL] BILL_ADMIN_MOBILE and OPERATIONS_ADMIN_MOBILE must be distinct mobile numbers.');
      }
    }
    if (env.BILL_ADMIN_INITIAL_PASSWORD && env.BILL_ADMIN_INITIAL_PASSWORD.length < 8) {
      throw new Error('[FATAL] BILL_ADMIN_INITIAL_PASSWORD must be at least 8 characters.');
    }
    if (env.OPERATIONS_ADMIN_INITIAL_PASSWORD && env.OPERATIONS_ADMIN_INITIAL_PASSWORD.length < 8) {
      throw new Error('[FATAL] OPERATIONS_ADMIN_INITIAL_PASSWORD must be at least 8 characters.');
    }
    if (
      env.BILL_ADMIN_INITIAL_PASSWORD &&
      env.OPERATIONS_ADMIN_INITIAL_PASSWORD &&
      env.BILL_ADMIN_INITIAL_PASSWORD === env.OPERATIONS_ADMIN_INITIAL_PASSWORD
    ) {
      throw new Error('[FATAL] BILL_ADMIN_INITIAL_PASSWORD and OPERATIONS_ADMIN_INITIAL_PASSWORD must be distinct passwords.');
    }

    validateProductionPlayIntegrity(env);
  }
}

export function validateProductionPlayIntegrity(env: Record<string, string | undefined>): void {
  const clientEmail = env.PLAY_INTEGRITY_CLIENT_EMAIL?.trim();
  const privateKey = env.PLAY_INTEGRITY_PRIVATE_KEY?.trim();
  const packageName = env.PLAY_INTEGRITY_PACKAGE_NAME?.trim();
  const allowMock = env.PLAY_INTEGRITY_ALLOW_MOCK?.trim();
  const requireLicensing = env.PLAY_INTEGRITY_REQUIRE_LICENSING?.trim();
  const enforceActions = env.PLAY_INTEGRITY_ENFORCE_ACTIONS?.trim();

  if (!clientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) {
    throw new Error('[FATAL] Valid Play Integrity service-account email is required.');
  }

  if (isPlaceholderCredential(clientEmail)) {
    throw new Error('[FATAL] Play Integrity service-account email contains an insecure placeholder or example value.');
  }

  if (!privateKey || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('[FATAL] Play Integrity private key is missing or malformed.');
  }

  if (isPlaceholderCredential(privateKey)) {
    throw new Error('[FATAL] Play Integrity private key contains an insecure placeholder or example value.');
  }

  if (packageName !== 'com.hiralal.rewards') {
    throw new Error('[FATAL] Play Integrity package name does not match the approved Android package.');
  }

  const rawDigests = env.PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS ?? '';
  const digests = rawDigests
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/[: -]/g, ''))
    .filter(Boolean);

  if (digests.length === 0 || digests.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error('[FATAL] A non-empty, valid SHA-256 certificate allowlist is required.');
  }

  if (allowMock !== 'false') {
    throw new Error('[FATAL] Play Integrity mocks must be disabled in production.');
  }

  if (requireLicensing !== 'true') {
    throw new Error('[FATAL] Play Integrity licensing enforcement must be enabled in production.');
  }

  if (enforceActions !== 'true') {
    throw new Error('[FATAL] Play Integrity protected-action enforcement must be enabled in production.');
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

export function parseFcmConfig(): { projectId: string; clientEmail: string; privateKey: string } {
  let projectId = process.env.FIREBASE_PROJECT_ID || process.env.FCM_PROJECT_ID || '';
  let clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.FCM_CLIENT_EMAIL || '';
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.FCM_PRIVATE_KEY || '';

  const saKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FCM_SERVICE_ACCOUNT_KEY;
  if (saKey) {
    try {
      const raw = saKey.trim();
      let parsed: any = null;
      if (raw.startsWith('{')) {
        parsed = JSON.parse(raw);
      } else if (fs.existsSync(raw)) {
        parsed = JSON.parse(fs.readFileSync(raw, 'utf8'));
      }
      if (parsed) {
        projectId = projectId || parsed.project_id || '';
        clientEmail = clientEmail || parsed.client_email || '';
        privateKey = privateKey || parsed.private_key || '';
      }
    } catch {
      // In development or test, ignore JSON parsing errors
    }
  }

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  return { projectId, clientEmail, privateKey };
}

export const config: AppConfig = {
  serviceRole,
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  isProduction,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/hiralal_rewards?schema=public',
  encryptionKey: process.env.ENCRYPTION_KEY || 'hiralal_aes256_secret_key_32bytes_sample_dev_only!',
  fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY || 'hiralal_field_aes256_32bytes_key_dev_only!',
  storageHmacSecret: process.env.STORAGE_HMAC_SECRET || '',

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

  fcm: parseFcmConfig(),

  playIntegrity: {
    clientEmail: process.env.PLAY_INTEGRITY_CLIENT_EMAIL || '',
    privateKey: (process.env.PLAY_INTEGRITY_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    packageName: process.env.PLAY_INTEGRITY_PACKAGE_NAME || 'com.hiralal.rewards',
    allowedCertificateDigests: (process.env.PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    allowMock: process.env.PLAY_INTEGRITY_ALLOW_MOCK === 'true',
    requireLicensing: isProduction
      ? process.env.PLAY_INTEGRITY_REQUIRE_LICENSING !== 'false'
      : process.env.PLAY_INTEGRITY_REQUIRE_LICENSING === 'true',
    enforceActions: process.env.PLAY_INTEGRITY_ENFORCE_ACTIONS === 'true',
  },

  timezone: 'Asia/Kolkata',
};
