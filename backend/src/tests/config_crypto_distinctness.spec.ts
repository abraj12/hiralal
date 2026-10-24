import crypto from 'crypto';
import { validateProductionConfig } from '../config';

const validTestRsaKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

describe('Findings 18 & 19 Regression Suite: Crypto Secrets Distinctness & Minimum Length', () => {
  const getBaseValidEnv = () => ({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://prod_user:SecurePass123!@db.prod.internal:5432/hiralal_prod?sslmode=require',
    REDIS_PASSWORD: 'redis_secure_password_at_least_24_chars_long!',
    ENCRYPTION_KEY: 'encryption_master_key_32bytes_sample_unique_1!',
    FIELD_ENCRYPTION_KEY: 'field_encryption_key_32bytes_unique_2!!',
    BLIND_INDEX_SECRET: 'blind_index_secret_32bytes_unique_3!!',
    JWT_ACCESS_SECRET: 'jwt_access_secret_32bytes_unique_4!!',
    JWT_REFRESH_SECRET: 'jwt_refresh_secret_32bytes_unique_5!',
    JWT_ADMIN_ACCESS_SECRET: 'jwt_admin_access_secret_32bytes_6!!!',
    STORAGE_HMAC_SECRET: 'storage_hmac_secret_32bytes_unique_7!',
    OTP_HMAC_SECRET: 'otp_hmac_secret_32bytes_unique_888!',
    BILL_ADMIN_PREFIX: 'BILL_ADMIN_SECURE_PREFIX_16C',
    OPERATIONS_ADMIN_PREFIX: 'OPS_ADMIN_SECURE_PREFIX_16CH',
    R2_ACCESS_KEY_ID: 'prod_r2_access_key_unique',
    R2_SECRET_ACCESS_KEY: 'prod_r2_secret_access_key_unique',
    R2_BUCKET_NAME: 'prod-invoices-unique-bucket',
    R2_ENDPOINT: 'https://prod-account-id.r2.cloudflarestorage.com',
    SIGNCARE_BASE_URL: 'https://api.signcare.in/prod',
    SIGNCARE_API_KEY: 'signcare_prod_key_unique',
    SIGNCARE_APP_ID: 'signcare_app_id_unique',
    RAZORPAYX_KEY_ID: 'rzp_live_key_id_unique',
    RAZORPAYX_KEY_SECRET: 'rzp_live_secret_key_unique',
    RAZORPAYX_ACCOUNT_NUMBER: '2323230012345678',
    RAZORPAYX_WEBHOOK_SECRET: 'rzp_webhook_secret_key_unique',
    ALLOWED_ORIGINS: 'https://hsspl.algions.in',
    CORS_ALLOWED_ORIGINS: 'https://hsspl.algions.in',
    WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
    WHATSAPP_ACCESS_TOKEN: 'whatsapp_access_token_secure_unique',
    WHATSAPP_TEMPLATE_NAME: 'hiralal_otp_template',
    BILL_ADMIN_MOBILE: '9999900001',
    OPERATIONS_ADMIN_MOBILE: '9999900002',
    BILL_ADMIN_INITIAL_PASSWORD: 'InitialPassword@BillAdmin123!',
    OPERATIONS_ADMIN_INITIAL_PASSWORD: 'InitialPassword@OpsAdmin123!',
    FIREBASE_PROJECT_ID: 'hiralal-rewards-prod',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@hiralal-rewards-prod.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: validTestRsaKey,
    PLAY_INTEGRITY_CLIENT_EMAIL: 'play-integrity@hiralal-rewards.iam.gserviceaccount.com',
    PLAY_INTEGRITY_PRIVATE_KEY: validTestRsaKey,
    PLAY_INTEGRITY_PACKAGE_NAME: 'com.hiralal.rewards',
    PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    PLAY_INTEGRITY_ALLOW_MOCK: 'false',
    PLAY_INTEGRITY_REQUIRE_LICENSING: 'true',
    PLAY_INTEGRITY_ENFORCE_ACTIONS: 'true',
  });

  it('validates a complete, distinct set of production secrets without throwing', () => {
    const validEnv = getBaseValidEnv();
    expect(() => validateProductionConfig('api', validEnv)).not.toThrow();
  });

  it('Finding 19: rejects OTP_HMAC_SECRET shorter than 32 characters', () => {
    const env = {
      ...getBaseValidEnv(),
      OTP_HMAC_SECRET: 'short_otp_secret_16c',
    };
    expect(() => validateProductionConfig('worker', env)).toThrow(
      /OTP_HMAC_SECRET must be at least 32 characters/i
    );
  });

  it('Finding 19: rejects when OTP_HMAC_SECRET is identical to STORAGE_HMAC_SECRET', () => {
    const sharedSecret = 'shared_identical_secret_32bytes_long!!';
    const env = {
      ...getBaseValidEnv(),
      OTP_HMAC_SECRET: sharedSecret,
      STORAGE_HMAC_SECRET: sharedSecret,
    };
    expect(() => validateProductionConfig('api', env)).toThrow(
      /STORAGE_HMAC_SECRET and OTP_HMAC_SECRET must be distinct cryptographic secrets/i
    );
  });

  it('Finding 19: rejects when FIELD_ENCRYPTION_KEY is identical to BLIND_INDEX_SECRET', () => {
    const sharedSecret = 'shared_identical_secret_32bytes_long!!';
    const env = {
      ...getBaseValidEnv(),
      FIELD_ENCRYPTION_KEY: sharedSecret,
      BLIND_INDEX_SECRET: sharedSecret,
    };
    expect(() => validateProductionConfig('api', env)).toThrow(
      /FIELD_ENCRYPTION_KEY and BLIND_INDEX_SECRET must be distinct cryptographic secrets/i
    );
  });

  it('Finding 18: enforces STORAGE_HMAC_SECRET requires 32 characters, not 16', () => {
    const env = {
      ...getBaseValidEnv(),
      STORAGE_HMAC_SECRET: 'sixteen_chars_16', // 16 chars
    };
    expect(() => validateProductionConfig('api', env)).toThrow(
      /STORAGE_HMAC_SECRET must be at least 32 characters/i
    );
  });
});
