import dotenv from 'dotenv';
import fs from 'fs';
import { createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
dotenv.config();

export interface AppConfig {
  serviceRole: 'api' | 'worker' | 'migration' | 'cron';
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  isSensitiveEnv: boolean;
  databaseUrl: string;
  encryptionKey: string;
  fieldEncryptionKey: string;
  storageHmacSecret: string;
  otpHmacSecret: string;
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
  whatsapp: {
    apiUrl: string;
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
    businessAccountId: string;
    templateName: string;
    templateLanguage: string;
    buttonType: string;
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
  auth: {
    lockoutSeconds: number;
    maxFailedAttempts: number;
  };
  authLockoutSeconds: number;
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
const isSensitiveEnv = ['production', 'staging', 'uat'].includes(nodeEnv) || isProduction;
const rawRole = (process.env.SERVICE_ROLE || 'api').toLowerCase();
const ALLOWED_ROLES = ['api', 'worker', 'migration', 'cron'] as const;
type ServiceRole = typeof ALLOWED_ROLES[number];

if (!ALLOWED_ROLES.includes(rawRole as any)) {
  throw new Error(`[FATAL] Invalid SERVICE_ROLE "${rawRole}". Allowed roles: ${ALLOWED_ROLES.join(', ')}`);
}
const serviceRole = rawRole as ServiceRole;

/**
 * Calculates Shannon entropy for a given string to measure information density and detect repetitive/trivial keys.
 */
export function calculateShannonEntropy(str: string): number {
  if (!str) return 0;
  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

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
    'xyz',
    'abc',
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
  if (isPlaceholderCredential(value)) {
    return true;
  }
  const trimmed = value.trim();
  // Check for repetitive/low-entropy keys on secret/key/password variables
  const isKeyVar = /secret|key|password/i.test(name);
  if (isKeyVar && trimmed.length >= 16) {
    const uniqueChars = new Set(trimmed).size;
    const entropy = calculateShannonEntropy(trimmed);
    // Keys >= 16 chars should have at least 5 distinct characters and entropy >= 2.0
    if (uniqueChars < 5 || entropy < 2.0) {
      return true;
    }
  }
  return false;
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
    'OTP_HMAC_SECRET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'SIGNCARE_BASE_URL',
    'SIGNCARE_API_KEY',
    'SIGNCARE_APP_ID',
    'RAZORPAYX_KEY_ID',
    'RAZORPAYX_KEY_SECRET',
    'RAZORPAYX_ACCOUNT_NUMBER',
    'RAZORPAYX_WEBHOOK_SECRET',
    ...(
      (env.OTP_PROVIDER || (env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_PHONE_NUMBER_ID ? 'WHATSAPP' : (env.MSG91_AUTH_KEY ? 'MSG91' : 'WHATSAPP'))).toUpperCase() === 'MSG91'
        ? ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID']
        : ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TEMPLATE_NAME']
    ),
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
    if (!env.BILL_ADMIN_PREFIX || !env.BILL_ADMIN_PREFIX.trim() || !env.OPERATIONS_ADMIN_PREFIX || !env.OPERATIONS_ADMIN_PREFIX.trim()) {
      throw new Error('[FATAL] BILL_ADMIN_PREFIX and OPERATIONS_ADMIN_PREFIX must be explicitly configured in production.');
    }
    const p1 = env.BILL_ADMIN_PREFIX.trim().toUpperCase();
    const p2 = env.OPERATIONS_ADMIN_PREFIX.trim().toUpperCase();
    if (p1 === p2) {
      throw new Error('[FATAL] BILL_ADMIN_PREFIX and OPERATIONS_ADMIN_PREFIX must be distinct non-empty prefixes.');
    }
    if (['XYZ', 'ABC'].includes(p1) || ['XYZ', 'ABC'].includes(p2)) {
      throw new Error('[FATAL] Insecure default admin prefixes (XYZ, ABC) are rejected in production.');
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
    validateProductionSignCare(env);
    validateProductionFcm(env, 'api');
  } else if (role === 'worker') {
    validateProductionFcm(env, 'worker');
  }
}

export function validatePlayIntegrityPrivateKey(configuredValue: string | undefined): void {
  const pem = configuredValue?.replace(/\\n/g, '\n').trim();

  if (!pem) {
    throw new Error('[FATAL] Play Integrity private key is missing or malformed.');
  }

  if (isPlaceholderCredential(pem)) {
    throw new Error('[FATAL] Play Integrity private key contains an insecure placeholder or example value.');
  }

  if (!pem.includes('PRIVATE KEY')) {
    throw new Error('[FATAL] Play Integrity private key is missing or malformed.');
  }

  try {
    const key = createPrivateKey(pem);

    if (key.asymmetricKeyType !== 'rsa') {
      throw new Error('Unexpected key type.');
    }
  } catch (err: any) {
    if (err.message === 'Unexpected key type.') {
      throw new Error('[FATAL] Play Integrity private key must be an RSA private key.');
    }
    throw new Error('[FATAL] Play Integrity private key is invalid or unusable.');
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

  validatePlayIntegrityPrivateKey(privateKey);

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

function isPrivateOrLoopbackIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;
    if (parts[0] === 127) return true; // 127.0.0.0/8 loopback
    if (parts[0] === 10) return true; // 10.0.0.0/8 private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12 private
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16 private
    if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 link-local
    if (parts[0] === 0) return true; // 0.0.0.0/8 current network
    if (parts[0] >= 224) return true; // 224.0.0.0/4 multicast & reserved
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true; // loopback
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true; // unspecified
    if (/^fe[89ab]/i.test(lower)) return true; // fe80::/10 link-local
    if (/^f[cd]/i.test(lower)) return true; // fc00::/7 unique-local
    if (lower.startsWith('::ffff:')) {
      const v4Part = lower.slice(7);
      if (isIP(v4Part) === 4) {
        return isPrivateOrLoopbackIp(v4Part);
      }
    }
    return false;
  }
  return false;
}

export function validateProductionSignCare(env: Record<string, string | undefined>): void {
  const baseUrl = env.SIGNCARE_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error('[FATAL] Explicit SIGNCARE_BASE_URL is required in production.');
  }

  if (isPlaceholderCredential(baseUrl)) {
    throw new Error('[FATAL] SIGNCARE_BASE_URL contains an insecure placeholder or example value.');
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('[FATAL] SIGNCARE_BASE_URL is not a valid parseable URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('[FATAL] SIGNCARE_BASE_URL must use https: protocol.');
  }

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('[FATAL] SIGNCARE_BASE_URL contains forbidden URL components.');
  }

  if (parsed.search) {
    throw new Error('[FATAL] SIGNCARE_BASE_URL contains forbidden URL query parameters.');
  }

  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[|\]$/g, '');

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIP(hostname) ||
    isPrivateOrLoopbackIp(hostname)
  ) {
    throw new Error(
      `[FATAL] SIGNCARE_BASE_URL cannot use localhost, loopback, or private IP endpoints (${rawHostname}) in production.`
    );
  }

  if (
    hostname.includes('uat') ||
    hostname.includes('sandbox') ||
    hostname.includes('staging') ||
    hostname.includes('dev.') ||
    hostname.startsWith('dev-') ||
    hostname.includes('test')
  ) {
    throw new Error(
      `[FATAL] SIGNCARE_BASE_URL cannot use localhost, loopback, or UAT/sandbox endpoints (${rawHostname}) in production.`
    );
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error(`[FATAL] SIGNCARE_BASE_URL cannot use non-standard port (${parsed.port}) in production.`);
  }

  const APPROVED_SIGNCARE_HOSTS = ['api.signcare.in'];
  if (!APPROVED_SIGNCARE_HOSTS.includes(hostname)) {
    throw new Error(
      `[FATAL] SIGNCARE_BASE_URL host "${rawHostname}" is not on the approved production allowlist (https://api.signcare.in).`
    );
  }

  const apiKey = env.SIGNCARE_API_KEY?.trim();
  const appId = env.SIGNCARE_APP_ID?.trim();
  if (!apiKey || isPlaceholderCredential(apiKey)) {
    throw new Error('[FATAL] Valid SIGNCARE_API_KEY is required in production.');
  }
  if (!appId || isPlaceholderCredential(appId)) {
    throw new Error('[FATAL] Valid SIGNCARE_APP_ID is required in production.');
  }
}

export function validateFcmPrivateKey(configuredValue: string | undefined): void {
  const pem = configuredValue?.replace(/\\n/g, '\n').trim();

  if (!pem) {
    throw new Error('[FATAL] FCM private key is missing or malformed.');
  }

  if (isPlaceholderCredential(pem)) {
    throw new Error('[FATAL] FCM private key contains an insecure placeholder or example value.');
  }

  if (!pem.includes('PRIVATE KEY')) {
    throw new Error('[FATAL] FCM private key is missing or malformed.');
  }

  try {
    const key = createPrivateKey(pem);

    if (key.asymmetricKeyType !== 'rsa') {
      throw new Error('Unexpected key type.');
    }
  } catch (err: any) {
    if (err.message === 'Unexpected key type.') {
      throw new Error('[FATAL] FCM private key must be an RSA private key.');
    }
    throw new Error('[FATAL] FCM private key is invalid or unusable.');
  }
}

export function validateProductionFcm(env: Record<string, string | undefined>, role: string = 'api'): void {
  const saKey = (env.FIREBASE_SERVICE_ACCOUNT_KEY || env.FCM_SERVICE_ACCOUNT_KEY)?.trim();
  const projectId = (env.FIREBASE_PROJECT_ID || env.FCM_PROJECT_ID)?.trim();
  const clientEmail = (env.FIREBASE_CLIENT_EMAIL || env.FCM_CLIENT_EMAIL)?.trim();
  const privateKey = (env.FIREBASE_PRIVATE_KEY || env.FCM_PRIVATE_KEY)?.trim();

  const hasAnyIndividual = Boolean(projectId || clientEmail || privateKey);

  // Reject mixed / inconsistent credential modes (both Mode A and Mode B configured)
  if (saKey && hasAnyIndividual) {
    throw new Error(
      '[FATAL] Inconsistent FCM credentials: configure either individual credentials (Mode A) or service-account key (Mode B), not both.'
    );
  }

  // If neither Mode A nor Mode B is configured
  if (!saKey && !hasAnyIndividual) {
    throw new Error(
      `[FATAL] Production startup halted for role "${role}". Missing required Firebase Cloud Messaging (FCM) credentials: configure either individual credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) or service-account configuration (FIREBASE_SERVICE_ACCOUNT_KEY).`
    );
  }

  // Mode B: Service Account Key (JSON string or file path)
  if (saKey) {
    if (isPlaceholderCredential(saKey)) {
      throw new Error('[FATAL] FIREBASE_SERVICE_ACCOUNT_KEY contains an insecure placeholder or example value.');
    }

    let parsed: any = null;
    if (saKey.startsWith('{')) {
      try {
        parsed = JSON.parse(saKey);
      } catch {
        throw new Error('[FATAL] FIREBASE_SERVICE_ACCOUNT_KEY contains invalid JSON.');
      }
    } else {
      if (!fs.existsSync(saKey)) {
        throw new Error('[FATAL] FIREBASE_SERVICE_ACCOUNT_KEY file does not exist at specified path.');
      }
      try {
        parsed = JSON.parse(fs.readFileSync(saKey, 'utf8'));
      } catch {
        throw new Error('[FATAL] FIREBASE_SERVICE_ACCOUNT_KEY file contains invalid JSON.');
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('[FATAL] FIREBASE_SERVICE_ACCOUNT_KEY must parse to a valid JSON object.');
    }

    const saProjectId = parsed.project_id?.trim();
    const saClientEmail = parsed.client_email?.trim();
    const saPrivateKey = parsed.private_key?.trim();
    const saTokenUri = parsed.token_uri?.trim();

    if (!saProjectId || isPlaceholderCredential(saProjectId)) {
      throw new Error('[FATAL] Service account configuration missing or invalid project_id.');
    }
    if (!saClientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(saClientEmail) || isPlaceholderCredential(saClientEmail)) {
      throw new Error('[FATAL] Service account configuration missing or invalid client_email.');
    }
    if (!saTokenUri || isPlaceholderCredential(saTokenUri) || saTokenUri !== 'https://oauth2.googleapis.com/token') {
      throw new Error('[FATAL] Service account token_uri is missing or unauthorized.');
    }

    validateFcmPrivateKey(saPrivateKey);
    return;
  }

  // Mode A: Individual triplet
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      '[FATAL] Incomplete FCM credentials: Mode A requires all three variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY).'
    );
  }

  if (isPlaceholderCredential(projectId)) {
    throw new Error('[FATAL] FIREBASE_PROJECT_ID contains an insecure placeholder or example value.');
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail) || isPlaceholderCredential(clientEmail)) {
    throw new Error('[FATAL] FIREBASE_CLIENT_EMAIL must be a valid service-account email address.');
  }

  validateFcmPrivateKey(privateKey);
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
const rawBillPrefix = normalizeAdminPrefix(process.env.BILL_ADMIN_PREFIX || (isProduction ? '' : 'XYZ'));
const rawOpsPrefix = normalizeAdminPrefix(process.env.OPERATIONS_ADMIN_PREFIX || (isProduction ? '' : 'ABC'));
if (rawBillPrefix && rawOpsPrefix && rawBillPrefix === rawOpsPrefix) {
  throw new Error('[FATAL] BILL_ADMIN_PREFIX and OPERATIONS_ADMIN_PREFIX must not collide after normalization.');
}

// Production & Sensitive Environment Fail-Fast Validation
if (isSensitiveEnv) {
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
  isSensitiveEnv,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/hiralal_rewards?schema=public',
  encryptionKey: process.env.ENCRYPTION_KEY || 'hiralal_aes256_secret_key_32bytes_sample_dev_only!',
  fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY || 'hiralal_field_aes256_32bytes_key_dev_only!',
  storageHmacSecret: process.env.STORAGE_HMAC_SECRET || '',
  otpHmacSecret: process.env.OTP_HMAC_SECRET || process.env.ENCRYPTION_KEY || 'hiralal_otp_hmac_secret_32bytes_dev!',

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
    baseUrl: process.env.SIGNCARE_BASE_URL || (isProduction ? '' : 'https://uat.signcare.in'),
    apiKey: process.env.SIGNCARE_API_KEY || '',
    appId: process.env.SIGNCARE_APP_ID || '',
  },

  razorpayx: {
    keyId: process.env.RAZORPAYX_KEY_ID || '',
    keySecret: process.env.RAZORPAYX_KEY_SECRET || '',
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || '',
    webhookSecret:
      process.env.RAZORPAYX_WEBHOOK_SECRET ||
      (isSensitiveEnv ? '' : 'webhook_secret_hiralal_rzpx_2026'),
  },

  sms: {
    provider: (process.env.OTP_PROVIDER || process.env.SMS_PROVIDER || (isProduction ? 'WHATSAPP' : 'WHATSAPP')).toUpperCase(),
    apiKey: process.env.SMS_API_KEY || process.env.MSG91_AUTH_KEY || '',
    authKey: process.env.MSG91_AUTH_KEY || process.env.SMS_API_KEY || '',
    templateId: process.env.MSG91_TEMPLATE_ID || '',
    senderId: process.env.MSG91_SENDER_ID || process.env.SMS_SENDER_ID || 'HIRALAL',
  },

  whatsapp: {
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'hiralal_auth_otp',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
    buttonType: (process.env.WHATSAPP_AUTH_BUTTON_TYPE || 'COPY_CODE').toUpperCase(),
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

  auth: {
    lockoutSeconds: parseInt(process.env.AUTH_LOCKOUT_SECONDS || '900', 10),
    maxFailedAttempts: parseInt(process.env.AUTH_MAX_FAILED_ATTEMPTS || '10', 10),
  },
  authLockoutSeconds: parseInt(process.env.AUTH_LOCKOUT_SECONDS || '900', 10),

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

  timezone: process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Kolkata',
};
