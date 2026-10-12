import crypto from 'crypto';
import { isUnsafeProductionValue, validateProductionConfig } from '../config';

const validTestRsaKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).privateKey;

describe('Phase 2 — Production Secrets Validation & Safety', () => {
  describe('isUnsafeProductionValue', () => {
    it('rejects undefined, empty, or whitespace-only values', () => {
      expect(isUnsafeProductionValue('DATABASE_URL', undefined)).toBe(true);
      expect(isUnsafeProductionValue('DATABASE_URL', '')).toBe(true);
      expect(isUnsafeProductionValue('DATABASE_URL', '   ')).toBe(true);
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
      PLAY_INTEGRITY_CLIENT_EMAIL: 'play-integrity@hiralal-rewards.iam.gserviceaccount.com',
      PLAY_INTEGRITY_PRIVATE_KEY: validTestRsaKey,
      PLAY_INTEGRITY_PACKAGE_NAME: 'com.hiralal.rewards',
      PLAY_INTEGRITY_ALLOWED_CERT_DIGESTS: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      PLAY_INTEGRITY_ALLOW_MOCK: 'false',
      PLAY_INTEGRITY_REQUIRE_LICENSING: 'true',
      PLAY_INTEGRITY_ENFORCE_ACTIONS: 'true',
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
  });
});
