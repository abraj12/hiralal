import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  isUnsafeProductionValue,
  calculateShannonEntropy,
  validateProductionConfig,
  validateProductionSignCare,
  validateProductionFcm,
  validateProductionPlayIntegrity,
} from '../config';

const validTestRsaKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

describe('Phase 2 — Production Secrets Validation & Safety', () => {
  describe('calculateShannonEntropy', () => {
    it('calculates zero entropy for single-character repetitive strings', () => {
      expect(calculateShannonEntropy('')).toBe(0);
      expect(calculateShannonEntropy('aaaa')).toBe(0);
      expect(calculateShannonEntropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(0);
    });

    it('calculates low entropy for alternating two-character strings', () => {
      expect(calculateShannonEntropy('abababababababab')).toBe(1);
    });

    it('calculates high entropy for random hex keys', () => {
      const hexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(calculateShannonEntropy(hexKey)).toBeGreaterThanOrEqual(4.0);
    });
  });

  describe('isUnsafeProductionValue', () => {
    it('rejects undefined, empty, or whitespace-only values', () => {
      expect(isUnsafeProductionValue('DATABASE_URL', undefined)).toBe(true);
      expect(isUnsafeProductionValue('DATABASE_URL', '')).toBe(true);
      expect(isUnsafeProductionValue('DATABASE_URL', '   ')).toBe(true);
    });

    it('rejects repetitive low-entropy secrets', () => {
      expect(isUnsafeProductionValue('JWT_ACCESS_SECRET', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
      expect(isUnsafeProductionValue('ENCRYPTION_KEY', '1234123412341234')).toBe(true);
      expect(isUnsafeProductionValue('REDIS_PASSWORD', 'bbbbbbbbbbbbbbbbbbbbbbbb')).toBe(true);
    });

    it('rejects known forbidden exact values', () => {
      const forbidden = [
        'changeme',
        'change_me',
        'your_secret_here',
        'replace_me',
        'password',
        'secret',
        'admin@123',
        'user@123',
        'change_this_to_a_strong_password_in_production',
      ];
      for (const val of forbidden) {
        expect(isUnsafeProductionValue('TEST_KEY', val)).toBe(true);
        expect(isUnsafeProductionValue('TEST_KEY', val.toUpperCase())).toBe(true);
      }
    });

    it('rejects known placeholder prefix patterns', () => {
      const placeholders = [
        'your_api_key',
        'replace_this_secret',
        'change-me-later',
        'example_password',
        'placeholder_key',
        'generate_secret_here',
        '<insert_key_here>',
        'sample_dev_only_key_12345678901234567890',
        'dev_access_secret_12345678901234567890',
        'dev_refresh_secret_12345678901234567890',
        'CLOUDFLARE_R2_ACCOUNT_ID_PLACEHOLDER',
        'REPLACE_WITH_ACCOUNT_ID',
        'change_this_value',
      ];
      for (const val of placeholders) {
        expect(isUnsafeProductionValue('TEST_KEY', val)).toBe(true);
      }
    });

    it('accepts valid high-entropy keys and hashes', () => {
      const validKeys = [
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'hiralal_postgres_production_password_2026_secure',
        'HiralalProdAdmin2026!StrongSaltKey',
        'https://production.r2.cloudflarestorage.com',
      ];
      for (const val of validKeys) {
        expect(isUnsafeProductionValue('TEST_KEY', val)).toBe(false);
      }
    });
  });

  describe('validateProductionConfig', () => {
    const validBaseEnv: Record<string, string> = {
      DATABASE_URL: 'postgresql://usr:strongpass123@db:5432/hiralal_prod?schema=public',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      FIELD_ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      JWT_ACCESS_SECRET: 'access_secret_high_entropy_32_characters_long_prod_key_1',
      JWT_REFRESH_SECRET: 'refresh_secret_high_entropy_32_characters_long_prod_key_2',
      STORAGE_HMAC_SECRET: 'hmac_signing_secret_high_entropy_2026_secure',
      R2_ACCESS_KEY_ID: 'cf_r2_prod_access_key_987654321',
      R2_SECRET_ACCESS_KEY: 'cf_r2_prod_secret_key_abcdef12345678901234567890',
      R2_BUCKET_NAME: 'hiralal-invoices-private',
      R2_ACCOUNT_ID: 'cf_prod_account_id_0123456789abcdef',
      R2_ENDPOINT: 'https://cf_prod_account_id_0123456789abcdef.r2.cloudflarestorage.com',
      SIGNCARE_BASE_URL: 'https://api.signcare.in',
      SIGNCARE_API_KEY: 'sc_live_api_key_1234567890abcdef',
      SIGNCARE_APP_ID: 'sc_live_app_id_9876543210fedcba',
      RAZORPAYX_KEY_ID: 'rzp_live_key_id_1234567890abcdef',
      RAZORPAYX_KEY_SECRET: 'rzp_live_key_sec_9876543210fedcba',
      RAZORPAYX_ACCOUNT_NUMBER: '2323230041123456',
      RAZORPAYX_WEBHOOK_SECRET: 'rzp_sec_live_webhook_signature_key_2026',
      MSG91_AUTH_KEY: 'msg91_live_auth_key_1234567890abcdef',
      MSG91_TEMPLATE_ID: 'msg91_dlt_template_id_1234567890',
      CORS_ALLOWED_ORIGINS: 'https://hsspl.algions.in',
      BILL_ADMIN_MOBILE: '9876543210',
      OPERATIONS_ADMIN_MOBILE: '9876543211',
      BILL_ADMIN_INITIAL_PASSWORD: 'BillAdmin2026!SecurePass',
      OPERATIONS_ADMIN_INITIAL_PASSWORD: 'OpsAdmin2026!SecurePass',
      JWT_ADMIN_ACCESS_SECRET: 'admin_access_secret_high_entropy_32_characters_long_prod_key_3',
      BILL_ADMIN_PREFIX: 'BADM',
      OPERATIONS_ADMIN_PREFIX: 'OADM',
      REDIS_PASSWORD: 'redis_prod_strong_secret_key_min_24_chars_2026',
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
      // F-05: Dedicated OTP HMAC secret required in production
      OTP_HMAC_SECRET: 'prod_otp_hmac_secret_minimum_32_characters_2026!',
    };

    it('passes when all production secrets are valid and high-entropy', () => {
      expect(() => validateProductionConfig('api', validBaseEnv)).not.toThrow();
      expect(() => validateProductionConfig('worker', validBaseEnv)).not.toThrow();
    });

    it('rejects ADMIN_INITIAL_PASSWORD in production', () => {
      const withLegacyAdminPassword = {
        ...validBaseEnv,
        ADMIN_INITIAL_PASSWORD: 'HiralalExecutiveAdmin2026!SecureKey',
      };
      expect(() => validateProductionConfig('api', withLegacyAdminPassword)).toThrow(
        /ADMIN_INITIAL_PASSWORD fallback is deprecated and forbidden in production/
      );
    });

    it('rejects default demo admin mobile numbers in production', () => {
      expect(() =>
        validateProductionConfig('api', { ...validBaseEnv, BILL_ADMIN_MOBILE: '9999999991' })
      ).toThrow(/Insecure default BILL_ADMIN_MOBILE/);

      expect(() =>
        validateProductionConfig('api', { ...validBaseEnv, OPERATIONS_ADMIN_MOBILE: '9999999992' })
      ).toThrow(/Insecure default OPERATIONS_ADMIN_MOBILE/);
    });

    it('rejects colliding admin mobiles and passwords', () => {
      expect(() =>
        validateProductionConfig('api', { ...validBaseEnv, OPERATIONS_ADMIN_MOBILE: '9876543210' })
      ).toThrow(/must be distinct mobile numbers/);

      expect(() =>
        validateProductionConfig('api', {
          ...validBaseEnv,
          OPERATIONS_ADMIN_INITIAL_PASSWORD: 'BillAdmin2026!SecurePass',
        })
      ).toThrow(/must be distinct passwords/);
    });

    it('throws error when a required environment variable is missing', () => {
      const incomplete = { ...validBaseEnv };
      delete incomplete.DATABASE_URL;
      expect(() => validateProductionConfig('api', incomplete)).toThrow(
        /Missing required environment variables: DATABASE_URL/
      );
    });

    it('throws error when a required environment variable contains a placeholder', () => {
      const withPlaceholder = {
        ...validBaseEnv,
        JWT_ACCESS_SECRET: 'your_secret_here',
      };
      expect(() => validateProductionConfig('api', withPlaceholder)).toThrow(
        /contains an insecure placeholder or example value/
      );
    });

    it('rejects short cryptographic keys (< 32 characters)', () => {
      const shortKey = {
        ...validBaseEnv,
        ENCRYPTION_KEY: 'short_key_16_chr',
      };
      expect(() => validateProductionConfig('api', shortKey)).toThrow(
        /ENCRYPTION_KEY must be at least 32 characters/
      );
    });

    it('rejects short STORAGE_HMAC_SECRET (< 32 characters)', () => {
      const shortHmac = {
        ...validBaseEnv,
        STORAGE_HMAC_SECRET: 'short_hmac_secret_20_ch',
      };
      expect(() => validateProductionConfig('api', shortHmac)).toThrow(
        /STORAGE_HMAC_SECRET must be at least 32 characters/
      );
    });

    it('rejects missing or short REDIS_PASSWORD (< 24 characters)', () => {
      const missingRedis = { ...validBaseEnv };
      delete missingRedis.REDIS_PASSWORD;
      expect(() => validateProductionConfig('api', missingRedis)).toThrow(
        /Missing required environment variables: REDIS_PASSWORD/
      );
      expect(() => validateProductionConfig('worker', missingRedis)).toThrow(
        /Missing required environment variables: REDIS_PASSWORD/
      );

      const shortRedis = {
        ...validBaseEnv,
        REDIS_PASSWORD: 'short_redis_pass_123',
      };
      expect(() => validateProductionConfig('api', shortRedis)).toThrow(
        /REDIS_PASSWORD must be at least 24 characters/
      );
    });

    it('rejects invalid or non-postgres DATABASE_URL', () => {
      const invalidUrl = {
        ...validBaseEnv,
        DATABASE_URL: 'mysql://usr:pass@db:3306/db',
      };
      expect(() => validateProductionConfig('api', invalidUrl)).toThrow(
        /DATABASE_URL must use postgresql: or postgres: protocol/
      );

      const malformedUrl = {
        ...validBaseEnv,
        DATABASE_URL: 'not-a-valid-uri',
      };
      expect(() => validateProductionConfig('api', malformedUrl)).toThrow(
        /DATABASE_URL is not a valid parseable database connection URL/
      );
    });

    it('rejects identical JWT access and refresh secrets', () => {
      const identicalJwt = {
        ...validBaseEnv,
        JWT_ACCESS_SECRET: 'identical_jwt_secret_32_characters_long_key_1',
        JWT_REFRESH_SECRET: 'identical_jwt_secret_32_characters_long_key_1',
      };
      expect(() => validateProductionConfig('api', identicalJwt)).toThrow(
        /JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct secrets/
      );
    });

    it('does not print secret values in exception error messages', () => {
      const secretValue = 'your_secret_confidential_token_xyz';
      const envWithSecret = {
        ...validBaseEnv,
        SIGNCARE_API_KEY: secretValue,
      };
      try {
        validateProductionConfig('api', envWithSecret);
        fail('Expected error to be thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(secretValue);
      }
    });

    describe('R2 endpoint and account configuration safety', () => {
      it('rejects when both R2_ENDPOINT and R2_ACCOUNT_ID are missing', () => {
        const env = { ...validBaseEnv };
        delete env.R2_ENDPOINT;
        delete env.R2_ACCOUNT_ID;
        expect(() => validateProductionConfig('api', env)).toThrow(
          /Missing required R2 configuration: either R2_ENDPOINT or R2_ACCOUNT_ID must be provided/
        );
      });

      it('rejects placeholder in R2_ENDPOINT', () => {
        const env = {
          ...validBaseEnv,
          R2_ENDPOINT: 'https://CLOUDFLARE_R2_ACCOUNT_ID_PLACEHOLDER.r2.cloudflarestorage.com',
        };
        expect(() => validateProductionConfig('api', env)).toThrow(
          /Environment variable "R2_ENDPOINT" contains an insecure placeholder or example value/
        );
      });

      it('rejects placeholder in R2_ACCOUNT_ID', () => {
        const env = {
          ...validBaseEnv,
          R2_ENDPOINT: '',
          R2_ACCOUNT_ID: 'CLOUDFLARE_R2_ACCOUNT_ID_PLACEHOLDER',
        };
        expect(() => validateProductionConfig('api', env)).toThrow(
          /Environment variable "R2_ACCOUNT_ID" contains an insecure placeholder or example value/
        );
      });

      it('rejects non-https R2_ENDPOINT', () => {
        const env = {
          ...validBaseEnv,
          R2_ENDPOINT: 'http://my-storage.r2.cloudflarestorage.com',
        };
        expect(() => validateProductionConfig('api', env)).toThrow(
          /R2_ENDPOINT must use https: protocol/
        );
      });

      it('rejects invalid URL in R2_ENDPOINT', () => {
        const env = {
          ...validBaseEnv,
          R2_ENDPOINT: 'invalid-endpoint-format',
        };
        expect(() => validateProductionConfig('api', env)).toThrow(
          /R2_ENDPOINT is not a valid URL/
        );
      });

      it('accepts valid R2_ACCOUNT_ID alone without R2_ENDPOINT', () => {
        const env = { ...validBaseEnv };
        delete env.R2_ENDPOINT;
        env.R2_ACCOUNT_ID = 'cf_prod_account_id_0123456789abcdef';
        expect(() => validateProductionConfig('api', env)).not.toThrow();
      });

      it('accepts valid R2_ENDPOINT alone without R2_ACCOUNT_ID', () => {
        const env = { ...validBaseEnv };
        delete env.R2_ACCOUNT_ID;
        env.R2_ENDPOINT = 'https://custom-r2.cloudflarestorage.com';
        expect(() => validateProductionConfig('api', env)).not.toThrow();
      });
    });

    describe('Test K — SignCare Production Configuration Safety', () => {
      it('rejects missing SIGNCARE_BASE_URL', () => {
        const env = { ...validBaseEnv };
        delete env.SIGNCARE_BASE_URL;
        expect(() => validateProductionSignCare(env)).toThrow(/Explicit SIGNCARE_BASE_URL is required in production/);
      });

      it('rejects placeholder SIGNCARE_BASE_URL', () => {
        const env = { ...validBaseEnv, SIGNCARE_BASE_URL: 'https://placeholder.example.com' };
        expect(() => validateProductionSignCare(env)).toThrow(/SIGNCARE_BASE_URL contains an insecure placeholder/);
      });

      it('rejects non-https SIGNCARE_BASE_URL', () => {
        const env = { ...validBaseEnv, SIGNCARE_BASE_URL: 'http://api.signcare.in' };
        expect(() => validateProductionSignCare(env)).toThrow(/SIGNCARE_BASE_URL must use https: protocol/);
      });

      it('rejects malformed URLs', () => {
        const env = { ...validBaseEnv, SIGNCARE_BASE_URL: 'not-a-valid-url' };
        expect(() => validateProductionSignCare(env)).toThrow(/SIGNCARE_BASE_URL is not a valid parseable URL/);
      });

      it('rejects localhost and loopback SIGNCARE_BASE_URL', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://localhost:8080' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://127.0.0.1:8080' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://[::1]' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
      });

      it('rejects private IPv4 and link-local addresses', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://10.0.0.1' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://192.168.1.1' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://172.16.5.1' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://169.254.169.254' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
      });

      it('rejects IPv6 unique-local and link-local addresses', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://[fe80::1]' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://[fc00::1]' })).toThrow(
          /cannot use localhost, loopback, or private IP endpoints/
        );
      });

      it('rejects UAT, sandbox, staging and dev endpoints', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://uat.signcare.in' })).toThrow(
          /cannot use localhost, loopback, or UAT\/sandbox endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://sandbox.signcare.in' })).toThrow(
          /cannot use localhost, loopback, or UAT\/sandbox endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://staging.signcare.in' })).toThrow(
          /cannot use localhost, loopback, or UAT\/sandbox endpoints/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://dev.signcare.in' })).toThrow(
          /cannot use localhost, loopback, or UAT\/sandbox endpoints/
        );
      });

      it('rejects URL credentials, fragments, query strings, and non-standard ports', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://user:pass@api.signcare.in' })).toThrow(
          /forbidden URL components/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://api.signcare.in#section' })).toThrow(
          /forbidden URL components/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://api.signcare.in?key=leak' })).toThrow(
          /forbidden URL query parameters/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://api.signcare.in:8443' })).toThrow(
          /cannot use non-standard port/
        );
      });

      it('rejects unauthorized production domains and deceptive hostnames', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://api.signcare.in.evil.com' })).toThrow(
          /not on the approved production allowlist/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_BASE_URL: 'https://unauthorized-kyc-host.com' })).toThrow(
          /not on the approved production allowlist/
        );
      });

      it('rejects missing or placeholder SIGNCARE_API_KEY and SIGNCARE_APP_ID', () => {
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_API_KEY: '' })).toThrow(
          /Valid SIGNCARE_API_KEY is required in production/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_API_KEY: 'your_api_key_placeholder' })).toThrow(
          /Valid SIGNCARE_API_KEY is required in production/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_APP_ID: '' })).toThrow(
          /Valid SIGNCARE_APP_ID is required in production/
        );
        expect(() => validateProductionSignCare({ ...validBaseEnv, SIGNCARE_APP_ID: 'replace_with_app_id' })).toThrow(
          /Valid SIGNCARE_APP_ID is required in production/
        );
      });

      it('accepts approved production endpoint https://api.signcare.in with valid credentials', () => {
        const env = { ...validBaseEnv, SIGNCARE_BASE_URL: 'https://api.signcare.in' };
        expect(() => validateProductionSignCare(env)).not.toThrow();
      });
    });

    describe('Test K — Firebase Cloud Messaging (FCM) Production Configuration Safety', () => {
      it('rejects missing FCM credentials when neither Mode A nor Mode B is present', () => {
        const env = { ...validBaseEnv };
        delete env.FIREBASE_PROJECT_ID;
        delete env.FIREBASE_CLIENT_EMAIL;
        delete env.FIREBASE_PRIVATE_KEY;
        delete env.FIREBASE_SERVICE_ACCOUNT_KEY;
        expect(() => validateProductionFcm(env)).toThrow(/Missing required Firebase Cloud Messaging \(FCM\) credentials/);
      });

      it('rejects incomplete Mode A credentials triplet', () => {
        const env1 = { ...validBaseEnv };
        delete env1.FIREBASE_PRIVATE_KEY;
        expect(() => validateProductionFcm(env1)).toThrow(/Incomplete FCM credentials: Mode A requires all three variables/);

        const env2 = { ...validBaseEnv };
        delete env2.FIREBASE_PROJECT_ID;
        expect(() => validateProductionFcm(env2)).toThrow(/Incomplete FCM credentials: Mode A requires all three variables/);

        const env3 = { ...validBaseEnv };
        delete env3.FIREBASE_CLIENT_EMAIL;
        expect(() => validateProductionFcm(env3)).toThrow(/Incomplete FCM credentials: Mode A requires all three variables/);
      });

      it('rejects mixed Mode A and Mode B credentials to prevent ambiguous config', () => {
        const env = {
          ...validBaseEnv,
          FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({
            project_id: 'sa-proj',
            client_email: 'sa@proj.iam.gserviceaccount.com',
            private_key: validTestRsaKey,
          }),
        };
        expect(() => validateProductionFcm(env)).toThrow(/Inconsistent FCM credentials/);
      });

      it('rejects placeholder values in Mode A credentials', () => {
        expect(() =>
          validateProductionFcm({ ...validBaseEnv, FIREBASE_PROJECT_ID: 'your_project_id_placeholder' })
        ).toThrow(/FIREBASE_PROJECT_ID contains an insecure placeholder/);

        expect(() =>
          validateProductionFcm({ ...validBaseEnv, FIREBASE_CLIENT_EMAIL: 'invalid-email-address' })
        ).toThrow(/FIREBASE_CLIENT_EMAIL must be a valid service-account email address/);

        expect(() =>
          validateProductionFcm({ ...validBaseEnv, FIREBASE_PRIVATE_KEY: 'not_a_pem_private_key' })
        ).toThrow(/FCM private key is missing or malformed/);
      });

      it('rejects invalid or non-RSA private key in Mode A', () => {
        expect(() =>
          validateProductionFcm({
            ...validBaseEnv,
            FIREBASE_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nINVALID_KEY_DATA\n-----END RSA PRIVATE KEY-----',
          })
        ).toThrow(/FCM private key is invalid or unusable/);
      });

      it('accepts valid Mode A triplet', () => {
        expect(() => validateProductionFcm(validBaseEnv)).not.toThrow();
      });

      it('accepts valid Mode B service-account JSON string', () => {
        const env = { ...validBaseEnv };
        delete env.FIREBASE_PROJECT_ID;
        delete env.FIREBASE_CLIENT_EMAIL;
        delete env.FIREBASE_PRIVATE_KEY;
        env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({
          project_id: 'hiralal-sa-prod',
          client_email: 'sa@hiralal-sa-prod.iam.gserviceaccount.com',
          private_key: validTestRsaKey,
          token_uri: 'https://oauth2.googleapis.com/token',
        });
        expect(() => validateProductionFcm(env)).not.toThrow();
      });

      it('rejects missing or unauthorized or placeholder token_uri in Mode B', () => {
        const env = { ...validBaseEnv };
        delete env.FIREBASE_PROJECT_ID;
        delete env.FIREBASE_CLIENT_EMAIL;
        delete env.FIREBASE_PRIVATE_KEY;

        // Unauthorized URI
        env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({
          project_id: 'hiralal-sa-prod',
          client_email: 'sa@hiralal-sa-prod.iam.gserviceaccount.com',
          private_key: validTestRsaKey,
          token_uri: 'https://evil-auth-server.com/token',
        });
        expect(() => validateProductionFcm(env)).toThrow(/token_uri is missing or unauthorized/);

        // Missing URI
        env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({
          project_id: 'hiralal-sa-prod',
          client_email: 'sa@hiralal-sa-prod.iam.gserviceaccount.com',
          private_key: validTestRsaKey,
        });
        expect(() => validateProductionFcm(env)).toThrow(/token_uri is missing or unauthorized/);

        // Non-approved Google endpoint
        env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({
          project_id: 'hiralal-sa-prod',
          client_email: 'sa@hiralal-sa-prod.iam.gserviceaccount.com',
          private_key: validTestRsaKey,
          token_uri: 'https://oauth2.googleapis.com/not-token',
        });
        expect(() => validateProductionFcm(env)).toThrow(/token_uri is missing or unauthorized/);
      });

      it('rejects malformed service-account JSON in Mode B', () => {
        const env: Record<string, string | undefined> = {
          ...validBaseEnv,
          FIREBASE_SERVICE_ACCOUNT_KEY: '{ malformed_json: true ',
        };
        delete env.FIREBASE_PROJECT_ID;
        delete env.FIREBASE_CLIENT_EMAIL;
        delete env.FIREBASE_PRIVATE_KEY;
        expect(() => validateProductionFcm(env)).toThrow(/FIREBASE_SERVICE_ACCOUNT_KEY contains invalid JSON/);
      });

      it('rejects non-existent file path in Mode B', () => {
        const env: Record<string, string | undefined> = {
          ...validBaseEnv,
          FIREBASE_SERVICE_ACCOUNT_KEY: '/nonexistent/path/to/service-account.json',
        };
        delete env.FIREBASE_PROJECT_ID;
        delete env.FIREBASE_CLIENT_EMAIL;
        delete env.FIREBASE_PRIVATE_KEY;
        expect(() => validateProductionFcm(env)).toThrow(/file does not exist at specified path/);
      });

      it('validates FCM credentials for worker service role', () => {
        const workerEnv = { ...validBaseEnv };
        delete workerEnv.FIREBASE_PROJECT_ID;
        delete workerEnv.FIREBASE_CLIENT_EMAIL;
        delete workerEnv.FIREBASE_PRIVATE_KEY;
        delete workerEnv.FIREBASE_SERVICE_ACCOUNT_KEY;

        expect(() => validateProductionFcm(workerEnv, 'worker')).toThrow(
          /Production startup halted for role "worker". Missing required Firebase Cloud Messaging/
        );
        expect(() => validateProductionConfig('worker', workerEnv)).toThrow(
          /Production startup halted for role "worker". Missing required Firebase Cloud Messaging/
        );

        // Succeeds when valid credentials are provided for worker
        expect(() => validateProductionFcm(validBaseEnv, 'worker')).not.toThrow();
        expect(() => validateProductionConfig('worker', validBaseEnv)).not.toThrow();
      });
    });

    describe('Test K — Play Integrity Fail-Closed Enforcement', () => {
      it('rejects allowMock=true in production', () => {
        const env = { ...validBaseEnv, PLAY_INTEGRITY_ALLOW_MOCK: 'true' };
        expect(() => validateProductionPlayIntegrity(env)).toThrow(/Play Integrity mocks must be disabled in production/);
      });

      it('rejects requireLicensing=false in production', () => {
        const env = { ...validBaseEnv, PLAY_INTEGRITY_REQUIRE_LICENSING: 'false' };
        expect(() => validateProductionPlayIntegrity(env)).toThrow(/Play Integrity licensing enforcement must be enabled/);
      });

      it('rejects enforceActions=false in production', () => {
        const env = { ...validBaseEnv, PLAY_INTEGRITY_ENFORCE_ACTIONS: 'false' };
        expect(() => validateProductionPlayIntegrity(env)).toThrow(/Play Integrity protected-action enforcement must be enabled/);
      });

      it('rejects invalid or empty certificate digests in production', () => {
        const env = { ...validBaseEnv, PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS: 'short_invalid_digest' };
        expect(() => validateProductionPlayIntegrity(env)).toThrow(/A non-empty, valid SHA-256 certificate allowlist is required/);
      });
    });

    describe('Test L — OTP Provider & Deployment Process Parity', () => {
      it('validates production config with WhatsApp OTP provider when configured', () => {
        const whatsappEnv: Record<string, string | undefined> = { ...validBaseEnv };
        delete whatsappEnv.MSG91_AUTH_KEY;
        delete whatsappEnv.MSG91_TEMPLATE_ID;
        whatsappEnv.OTP_PROVIDER = 'WHATSAPP';
        whatsappEnv.WHATSAPP_PHONE_NUMBER_ID = '100234567890123';
        whatsappEnv.WHATSAPP_ACCESS_TOKEN = 'EAABwzL123456789abcdefghijklmnopqrstuvwxyz';
        whatsappEnv.WHATSAPP_TEMPLATE_NAME = 'hiralal_auth_otp';

        expect(() => validateProductionConfig('api', whatsappEnv)).not.toThrow();
      });

      it('rejects WhatsApp configuration when required variables are missing', () => {
        const missingWhatsApp: Record<string, string | undefined> = { ...validBaseEnv };
        delete missingWhatsApp.MSG91_AUTH_KEY;
        delete missingWhatsApp.MSG91_TEMPLATE_ID;
        missingWhatsApp.OTP_PROVIDER = 'WHATSAPP';
        missingWhatsApp.WHATSAPP_PHONE_NUMBER_ID = '100234567890123';
        missingWhatsApp.WHATSAPP_TEMPLATE_NAME = 'hiralal_auth_otp';
        delete missingWhatsApp.WHATSAPP_ACCESS_TOKEN;

        expect(() => validateProductionConfig('api', missingWhatsApp)).toThrow(
          /Missing required environment variables: WHATSAPP_ACCESS_TOKEN/
        );
      });

      it('rejects MSG91 configuration when MSG91 variables are missing', () => {
        const msg91Env: Record<string, string | undefined> = { ...validBaseEnv, OTP_PROVIDER: 'MSG91' };
        delete msg91Env.MSG91_AUTH_KEY;

        expect(() => validateProductionConfig('api', msg91Env)).toThrow(
          /Missing required environment variables: MSG91_AUTH_KEY/
        );
      });

      it('verifies docker-compose.yml defines OTP_PROVIDER and WhatsApp environment variables', () => {
        const composePath = path.resolve(__dirname, '../../../docker-compose.yml');
        expect(fs.existsSync(composePath)).toBe(true);
        const composeContent = fs.readFileSync(composePath, 'utf-8');
        expect(composeContent).toContain('OTP_PROVIDER:');
        expect(composeContent).toContain('WHATSAPP_PHONE_NUMBER_ID:');
        expect(composeContent).toContain('WHATSAPP_ACCESS_TOKEN:');
        expect(composeContent).toContain('WHATSAPP_TEMPLATE_NAME:');
      });

      it('verifies ecosystem.config.js directs hiralal-worker to dist/worker/index.js', () => {
        const ecosystemPath = path.resolve(__dirname, '../../../ecosystem.config.js');
        expect(fs.existsSync(ecosystemPath)).toBe(true);
        const ecosystemContent = fs.readFileSync(ecosystemPath, 'utf-8');
        expect(ecosystemContent).toMatch(/name:\s*'hiralal-worker'[\s\S]*?script:\s*'dist\/worker\/index\.js'/);
      });
    });
  });
});
