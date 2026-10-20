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

export function normalizeIdentifier(val: string | undefined): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  // Preserve uppercase alphanumeric prefix for admin identifiers so admins and craftsmen sharing phone numbers do not collide
  const adminMatch = trimmed.match(/^([A-Za-z]+)\s*([0-9]+)$/);
  if (adminMatch) {
    const prefix = adminMatch[1].toUpperCase();
    const digits = adminMatch[2];
    const phone = digits.length >= 10 ? digits.slice(-10) : digits;
    return `${prefix}:${phone}`;
  }
  const clean = trimmed.replace(/\D/g, '');
  if (clean.length >= 10) {
    return clean.slice(-10);
  }
  return trimmed.toLowerCase();
}

/**
 * Derives rate limit identifier. If mobile/identifier is missing,
 * strictly falls back to ip:${req.ip} instead of masking client IP with 'anon'.
 */
export function requestIdentifier(req: Request, explicitVal?: string): string {
  const extracted = explicitVal || req.body?.identifier || req.body?.mobile || req.body?.username;
  const normalized = normalizeIdentifier(extracted);
  if (normalized) {
    return `id:${normalized}`;
  }
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `ip:${ip}`;
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
    getIdentifier = (req: Request) => `ip:${req.ip || 'unknown'}`,
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

        // Atomic INCR + conditional EXPIRE via Lua script (F-06: fixes non-atomic race condition).
        // If the process crashes between INCR and EXPIRE, the key could persist forever.
        // This Lua script executes both operations atomically in a single round-trip.
        const luaScript = `
          local current = redis.call('INCR', KEYS[1])
          if current == 1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
          end
          return current
        `;
        const current = await (redis as any).eval(luaScript, 1, key, String(windowSeconds)) as number;

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
      } else if (config.isProduction) {
        // In production, security-sensitive auth routes fail closed if Redis is down
        res.status(503).json({
          success: false,
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Rate limiting service is temporarily unavailable. Please retry shortly.',
        });
        return;
      }
    } catch (redisErr) {
      if (config.isProduction) {
        res.status(503).json({
          success: false,
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Rate limiting service encountered an error. Please retry shortly.',
        });
        return;
      }
    }

    // In-memory fallback for non-production environments
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

// 1. OTP Request Limiters (both IP and Identifier)
export const otpRequestLimiter = createRateLimiter({
  keyPrefix: 'otp:request:id',
  limit: config.isProduction ? 5 : 25,
  windowSeconds: 300,
  getIdentifier: (req) => requestIdentifier(req),
  message: 'Too many OTP requests for this mobile. Please wait 5 minutes before trying again.',
});

export const otpRequestIpLimiter = createRateLimiter({
  keyPrefix: 'otp:request:ip',
  limit: config.isProduction ? 15 : 60,
  windowSeconds: 300,
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many OTP requests from this network. Please wait 5 minutes before trying again.',
});

// 2. OTP Verify Limiters (both IP and Identifier)
export const otpVerifyLimiter = createRateLimiter({
  keyPrefix: 'otp:verify:id',
  limit: config.isProduction ? 10 : 50,
  windowSeconds: 300,
  getIdentifier: (req) => requestIdentifier(req),
  message: 'Too many verification attempts for this mobile. Please wait 5 minutes before trying again.',
});

export const otpVerifyIpLimiter = createRateLimiter({
  keyPrefix: 'otp:verify:ip',
  limit: config.isProduction ? 30 : 100,
  windowSeconds: 300,
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many verification attempts from this network. Please wait 5 minutes before trying again.',
});

// 3. Login Limiters (both IP and Identifier)
export const loginLimiter = createRateLimiter({
  keyPrefix: 'auth:login:id',
  limit: config.isProduction ? 15 : 60,
  windowSeconds: config.isProduction ? 900 : 180,
  getIdentifier: (req) => requestIdentifier(req),
  message: 'Too many failed login attempts for this account. Please wait a moment before trying again.',
});

export const loginIpLimiter = createRateLimiter({
  keyPrefix: 'auth:login:ip',
  limit: config.isProduction ? 30 : 120,
  windowSeconds: config.isProduction ? 900 : 180,
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many login attempts from this network. Please wait a moment before trying again.',
});

export function clearRateLimitCache() {
  memoryCache.clear();
}

export const passwordResetLimiter = createRateLimiter({
  keyPrefix: 'auth:password_reset',
  limit: 3,
  windowSeconds: 900, // 3 attempts per 15 minutes
  getIdentifier: (req) => requestIdentifier(req),
  message: 'Too many password reset requests. Please wait 15 minutes before trying again.',
});

export const passwordResetCompleteLimiter = createRateLimiter({
  keyPrefix: 'auth:password_reset_complete:id',
  limit: config.isProduction ? 5 : 20,
  windowSeconds: 900, // 5 attempts per 15 minutes per mobile/identifier
  getIdentifier: (req) => requestIdentifier(req),
  message: 'Too many password reset completion attempts for this mobile. Please wait 15 minutes.',
});

export const passwordResetCompleteIpLimiter = createRateLimiter({
  keyPrefix: 'auth:password_reset_complete:ip',
  limit: config.isProduction ? 15 : 60,
  windowSeconds: 900, // 15 attempts per 15 minutes per IP
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many password reset completion attempts from this network. Please wait 15 minutes.',
});

export const kycLimiter = createRateLimiter({
  keyPrefix: 'kyc:verify',
  limit: 5,
  windowSeconds: 3600, // 5 attempts per hour
  getIdentifier: (req: any) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || 'unknown'}`),
  message: 'KYC PAN verification limit reached. Maximum 5 attempts per hour allowed.',
});

export const payoutRedeemLimiter = createRateLimiter({
  keyPrefix: 'payout:redeem',
  limit: 3,
  windowSeconds: 60, // 3 requests per minute
  getIdentifier: (req: any) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || 'unknown'}`),
  message: 'Redemption request limit reached. Please wait a minute before requesting another payout.',
});

export const adminLoginLimiter = createRateLimiter({
  keyPrefix: 'auth:admin_login_ip',
  limit: 5,
  windowSeconds: 900, // 5 attempts per 15 minutes by IP
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many admin login attempts from this IP. Please wait 15 minutes.',
});

export const adminAccountLoginLimiter = createRateLimiter({
  keyPrefix: 'auth:admin_login_user',
  limit: 5,
  windowSeconds: 900, // 5 attempts per 15 minutes by username/identifier
  getIdentifier: (req) => requestIdentifier(req),
  message: 'Too many admin login attempts for this account. Please wait 15 minutes.',
});

export const integrityNonceLimiter = createRateLimiter({
  keyPrefix: 'integrity:nonce',
  limit: config.isProduction ? 30 : 120,
  windowSeconds: 300, // 30 requests per 5 minutes
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many integrity nonce requests. Please wait before retrying.',
});

export const integrityVerifyLimiter = createRateLimiter({
  keyPrefix: 'integrity:verify',
  limit: config.isProduction ? 15 : 60,
  windowSeconds: 300, // 15 verification attempts per 5 minutes
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many integrity verification attempts. Please wait before retrying.',
});

export const billUploadLimiter = createRateLimiter({
  keyPrefix: 'bill:upload',
  limit: config.isProduction ? 10 : 30,
  windowSeconds: 900, // 10 uploads per 15 minutes
  getIdentifier: (req: any) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || 'unknown'}`),
  message: 'Bill upload rate limit reached. Please wait 15 minutes before uploading more invoices.',
});

export const pushTokenLimiter = createRateLimiter({
  keyPrefix: 'push:register',
  limit: config.isProduction ? 10 : 60,
  windowSeconds: 600, // 10 requests per 10 minutes
  getIdentifier: (req: any) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip || 'unknown'}`),
  message: 'Push token registration rate limit reached. Please wait before retrying.',
});

export const registerIpLimiter = createRateLimiter({
  keyPrefix: 'auth:register:ip',
  limit: config.isProduction ? 5 : 30,
  windowSeconds: 900, // 5 registrations per 15 minutes per IP
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many registration attempts from this network. Please wait 15 minutes before trying again.',
});

export const adminPrefixesLimiter = createRateLimiter({
  keyPrefix: 'auth:admin_prefixes:ip',
  limit: config.isProduction ? 10 : 60,
  windowSeconds: 3600, // 10 requests per hour (tightened from 60/15min — F-04)
  getIdentifier: (req) => `ip:${req.ip || 'unknown'}`,
  message: 'Too many admin prefix discovery requests. Please wait before retrying.',
});

