import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hiralal_rewards?schema=public',

  jwt: {
    secret: process.env.JWT_SECRET || 'hiralal_super_secret_jwt_key_2026_rewards_secure',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'hiralal_refresh_token_secret_2026_secure',
  },

  r2: {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID || 'cf_acc_hiralal_sales_r2',
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || 'r2_access_key_placeholder',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || 'r2_secret_key_placeholder',
    bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'hiralal-invoices-private',
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://storage.hiralalandsons.com',
  },

  razorpayx: {
    keyId: process.env.RAZORPAYX_KEY_ID || 'rzp_test_hiralal2026',
    keySecret: process.env.RAZORPAYX_KEY_SECRET || 'rzp_secret_hiralal2026',
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || '2323230041123456',
    webhookSecret: process.env.RAZORPAYX_WEBHOOK_SECRET || 'webhook_secret_hiralal_rzpx_2026',
  },

  kyc: {
    provider: process.env.KYC_PROVIDER || 'MOCK',
    apiKey: process.env.KYC_API_KEY || 'kyc_api_key_placeholder',
  },

  sms: {
    provider: process.env.SMS_GATEWAY_PROVIDER || 'MOCK',
    apiKey: process.env.SMS_API_KEY || 'sms_api_key_placeholder',
  },

  rewards: {
    defaultPercentage: parseFloat(process.env.DEFAULT_REWARD_PERCENTAGE || '0.5'),
    monthlyPoolCap: parseFloat(process.env.MONTHLY_REWARD_POOL_CAP || '50000'),
    minRedemptionAmount: parseFloat(process.env.MIN_REDEMPTION_AMOUNT || '500'),
  },
};
