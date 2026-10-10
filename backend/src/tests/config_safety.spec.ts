import { isUnsafeProductionValue, validateProductionConfig } from '../config';

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
      SIGNCARE_API_KEY: 'sc_live_api_key_1234567890abcdef',
      SIGNCARE_APP_ID: 'sc_live_app_id_9876543210fedcba',
      RAZORPAYX_KEY_ID: 'rzp_live_key_id_1234567890abcdef',
      RAZORPAYX_KEY_SECRET: 'rzp_live_key_sec_9876543210fedcba',
      RAZORPAYX_ACCOUNT_NUMBER: '2323230041123456',
      RAZORPAYX_WEBHOOK_SECRET: 'rzp_sec_live_webhook_signature_key_2026',
      MSG91_AUTH_KEY: 'msg91_live_auth_key_1234567890abcdef',
      MSG91_TEMPLATE_ID: 'msg91_dlt_template_id_1234567890',
      CORS_ALLOWED_ORIGINS: 'https://admin.hiralalandsons.com,https://app.hiralalandsons.com',
      ADMIN_INITIAL_PASSWORD: 'HiralalExecutiveAdmin2026!SecureKey',
      JWT_ADMIN_ACCESS_SECRET: 'admin_access_secret_high_entropy_32_characters_long_prod_key_3',
      BILL_ADMIN_PREFIX: 'BADM',
      OPERATIONS_ADMIN_PREFIX: 'OADM',
    };

    it('passes when all production secrets are valid and high-entropy', () => {
      expect(() => validateProductionConfig('api', validBaseEnv)).not.toThrow();
      expect(() => validateProductionConfig('worker', validBaseEnv)).not.toThrow();
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
  });
});
