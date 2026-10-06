import { Request, Response, NextFunction } from 'express';
import { getRedisClient, isRedisReady, checkRedisConnection } from '../redis';
import { config } from '../config';

// In-memory fallback cache when Redis is offline or in testing
interface MemoryRecord {
  count: number;
  resetAt: number;
}
const memoryCache = new Map<string, MemoryRecord>();

export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
  getIdentifier?: (req: Request) => string;
  message?: string;
}

export function createRateLimiter(options: {
  keyPrefix: string;
  limit: number;
  windowSeconds: number;
  getIdentifier?: (req: Request) => string;
  message?: string;
}) {
  const {
    keyPrefix,
    limit,
    windowSeconds,
    getIdentifier = (req: Request) => req.ip || 'anonymous',
    message = 'Too many requests. Please try again later.',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // In test environment, allow bypassing unless testing rate limit
    if (config.nodeEnv === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const identifier = getIdentifier(req);
    const key = `ratelimit:${keyPrefix}:${identifier}`;

    try {
      if (isRedisReady()) {
        const redis = getRedisClient();
        const current = await redis.incr(key);

        if (current === 1) {
          await redis.expire(key, windowSeconds);
        }

        const ttl = await redis.ttl(key);
        res.setHeader('X-RateLimit-Limit', limit);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
        res.setHeader('X-RateLimit-Reset', ttl);

        if (current > limit) {
          res.status(429).json({
            success: false,
            code: 'RATE_LIMIT_EXCEEDED',
            message,
            retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
          });
          return;
        }

        return next();
      }
    } catch (redisErr) {
      // Degrade to memory cache
    }

    // In-memory fallback
    const now = Date.now();
    const entry = memoryCache.get(key);

    if (!entry || now > entry.resetAt) {
      memoryCache.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', limit - 1);
      return next();
    }

    entry.count += 1;
    const remainingSeconds = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
    res.setHeader('X-RateLimit-Reset', remainingSeconds);

    if (entry.count > limit) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        message,
        retryAfterSeconds: remainingSeconds,
      });
      return;
    }

    return next();
  };
}

// Pre-configured rate limiters
export const otpRequestLimiter = createRateLimiter({
  keyPrefix: 'otp:request',
  limit: config.isProduction ? 5 : 25,
  windowSeconds: 300,
  getIdentifier: (req) => req.body?.mobile || req.ip || 'anon',
  message: 'Too many OTP requests. Please wait 5 minutes before trying again.',
});

export const otpVerifyLimiter = createRateLimiter({
  keyPrefix: 'otp:verify',
  limit: config.isProduction ? 10 : 50,
  windowSeconds: 300,
  getIdentifier: (req) => req.body?.mobile || req.ip || 'anon',
  message: 'Too many verification attempts. Please wait 5 minutes before trying again.',
});

export const loginLimiter = createRateLimiter({
  keyPrefix: 'auth:login',
  limit: config.isProduction ? 15 : 60,
  windowSeconds: config.isProduction ? 900 : 180,
  getIdentifier: (req) => req.body?.mobile || req.ip || 'anon',
  message: 'Too many failed login attempts. Please wait a moment before trying again.',
});

export function clearRateLimitCache() {
  memoryCache.clear();
}

export const passwordResetLimiter = createRateLimiter({
  keyPrefix: 'auth:password_reset',
  limit: 3,
  windowSeconds: 900, // 3 attempts per 15 minutes
  getIdentifier: (req) => req.body?.mobile || req.ip || 'anon',
  message: 'Too many password reset requests. Please wait 15 minutes before trying again.',
});

export const kycLimiter = createRateLimiter({
  keyPrefix: 'kyc:verify',
  limit: 5,
  windowSeconds: 3600, // 5 attempts per hour
  getIdentifier: (req: any) => req.user?.id || req.ip || 'anon',
  message: 'KYC PAN verification limit reached. Maximum 5 attempts per hour allowed.',
});

export const payoutRedeemLimiter = createRateLimiter({
  keyPrefix: 'payout:redeem',
  limit: 3,
  windowSeconds: 60, // 3 requests per minute
  getIdentifier: (req: any) => req.user?.id || req.ip || 'anon',
  message: 'Redemption request limit reached. Please wait a minute before requesting another payout.',
});
