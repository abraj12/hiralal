import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/hiralal_rewards?schema=public',

  jwt: {
    secret: process.env.JWT_SECRET || 'hiralal_super_secret_jwt_key_2026_rewards_secure',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'hiralal_refresh_token_secret_2026_secure',
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'hiralal-invoices-private',
    endpoint: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL || '',
  },

  razorpayx: {
    keyId: process.env.RAZORPAYX_KEY_ID || '',
    keySecret: process.env.RAZORPAYX_KEY_SECRET || '',
    accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || '',
    webhookSecret: process.env.RAZORPAYX_WEBHOOK_SECRET || '',
  },

  kyc: {
    provider: (process.env.KYC_PROVIDER || 'SUREPASS').toUpperCase(),
    apiKey: process.env.KYC_API_KEY || '',
    apiSecret: process.env.KYC_API_SECRET || '',
  },

  sms: {
    provider: (process.env.SMS_GATEWAY_PROVIDER || 'FAST2SMS').toUpperCase(),
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || 'HIRALAL',
  },

  rewards: {
    defaultPercentage: parseFloat(process.env.DEFAULT_REWARD_PERCENTAGE || '0.5'),
    monthlyPoolCap: parseFloat(process.env.MONTHLY_REWARD_POOL_CAP || '50000'),
    minRedemptionAmount: parseFloat(process.env.MIN_REDEMPTION_AMOUNT || '500'),
    maxRedemptionAmount: parseFloat(process.env.MAX_REDEMPTION_AMOUNT || '10000'),
  },
};
