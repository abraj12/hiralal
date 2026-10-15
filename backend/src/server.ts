import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import { config } from './config';
import { checkDatabaseConnection, checkAdminRoleIntegrity } from './db';
import { checkRedisConnection } from './redis';

// Route imports
import authRoutes from './routes/auth.routes';
import billRoutes from './routes/bill.routes';
import rewardRoutes from './routes/reward.routes';
import walletRoutes from './routes/wallet.routes';
import kycRoutes from './routes/kyc.routes';
import paymentRoutes from './routes/payment.routes';
import payoutRoutes from './routes/payout.routes';
import webhookRoutes from './routes/webhook.routes';
import adminRoutes from './routes/admin.routes';
import notificationRoutes from './routes/notification.routes';
import pushTokenRoutes from './routes/push-token.routes';

const app = express();

// Trust reverse proxy (Nginx single-hop) to correctly resolve real client IP and enforce rate limiting
app.set('trust proxy', 1);

// Request ID tracking and HTTP latency logging middleware
app.use((req: any, res: Response, next: NextFunction) => {
  const start = Date.now();
  const incomingId = req.headers['x-request-id'] as string;
  req.requestId = incomingId || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`📡 [HTTP] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS Configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Permit mobile apps, curl, server-to-server requests without Origin header
    if (!origin) return callback(null, true);
    if (config.nodeEnv === 'test') return callback(null, true);
    if (config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development or test, allow local loopback origins
    if (!config.isProduction && !config.isSensitiveEnv) {
      try {
        const parsed = new URL(origin);
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) {
          return callback(null, true);
        }
      } catch {
        // Fall through to reject invalid origin
      }
    }
    const corsErr: any = new Error(`Origin '${origin}' blocked by Hiralal CORS policy`);
    corsErr.status = 403;
    corsErr.code = 'CORS_FORBIDDEN';
    callback(corsErr);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-CSRF-Token',
    'x-csrf-token',
    'x-integrity-token',
    'x-integrity-nonce',
    'x-integrity-request-salt',
    'X-Integrity-Token',
    'X-Integrity-Nonce',
    'X-Integrity-Request-Salt',
    'x-razorpay-signature',
    'x-razorpay-event-id',
    'x-test-rate-limit',
  ],
};
app.use(cors(corsOptions));

// JSON Body Parser with rawBody preservation for webhooks
app.use(express.json({
  limit: '1mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Static assets (logos, cards, banners for mobile and admin)
const sharedAssetsPath = path.join(__dirname, '../../shared/assets');
app.use('/assets', express.static(sharedAssetsPath));

// Health Check Endpoints
const healthHandler = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Hiralal & Sons Rewards Management API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
};

const liveHandler = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

const readyHandler = async (_req: Request, res: Response) => {
  try {
    const dbOk = await checkDatabaseConnection();
    const redisOk = await checkRedisConnection();
    const isReady = config.isProduction ? (dbOk && redisOk) : dbOk;

    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'not_ready',
      checks: {
        database: dbOk ? 'healthy' : 'unhealthy',
        redis: redisOk ? 'healthy' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'unhealthy',
      error: config.isProduction ? 'Dependency check failed' : err.message,
      timestamp: new Date().toISOString(),
    });
  }
};

app.get('/health', healthHandler);
app.get('/health/live', liveHandler);
app.get('/health/ready', readyHandler);
app.get('/ready', readyHandler);

// API Routes - Canonical /api/v1 with /api backward-compatibility alias
const v1Router = express.Router();
v1Router.get('/health', healthHandler);
v1Router.get('/health/live', liveHandler);
v1Router.get('/health/ready', readyHandler);
v1Router.use('/auth', authRoutes);
v1Router.use('/bills', billRoutes);
v1Router.use('/rewards', rewardRoutes);
v1Router.use('/wallet', walletRoutes);
v1Router.use('/kyc', kycRoutes);
v1Router.use('/payment-account', paymentRoutes);
v1Router.use('/payouts', payoutRoutes);
v1Router.use('/webhooks', webhookRoutes);
v1Router.use('/admin', adminRoutes);
v1Router.use('/notifications', notificationRoutes);
v1Router.use('/push-token', pushTokenRoutes);

app.use('/api/v1', v1Router);
app.use('/api', v1Router);

// 404 Handler
app.use((req: any, res: Response) => {
  res.status(404).json({
    success: false,
    code: 'ROUTE_NOT_FOUND',
    message: `Route ${req.method} ${req.url} not found`,
    requestId: req.requestId,
  });
});

// Global Error Handler
app.use((err: any, req: any, res: Response, _next: NextFunction) => {
  console.error(`[UNHANDLED ERROR] [${req.requestId}]`, err);

  const isMulterError = err.name === 'MulterError';
  const status = isMulterError ? 400 : (err.status || 500);

  let message = err.message || 'Internal Server Error';
  if (isMulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Uploaded file exceeds the maximum allowed size limit of 10MB.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded. Only 1 invoice document per bill submission is allowed.';
    } else {
      message = `File upload rejected: ${err.message}`;
    }
  } else if (config.isProduction && status >= 500) {
    message = `Internal server error. Reference ID: ${req.requestId}`;
  }

  const code =
    err.code ||
    (status === 400
      ? 'BAD_REQUEST'
      : status === 401
      ? 'UNAUTHORIZED'
      : status === 403
      ? 'FORBIDDEN'
      : 'INTERNAL_SERVER_ERROR');

  res.status(status).json({
    success: false,
    code,
    message,
    requestId: req.requestId,
  });
});

/**
 * Boots the server after performing mandatory preflight integrity checks.
 * In production, PostgreSQL, Redis, and Two-Admin role invariants must succeed BEFORE app.listen().
 */
async function startServer(): Promise<any> {
  // 1. PostgreSQL connectivity check
  const dbOk = await checkDatabaseConnection();
  if (!dbOk) {
    throw new Error('[FATAL] Failed to connect to PostgreSQL database during startup preflight.');
  }

  // 2. Administrator role integrity & invariant checks
  await checkAdminRoleIntegrity();

  // 3. Redis connectivity check
  const redisOk = await checkRedisConnection();
  if (config.isProduction && !redisOk) {
    throw new Error('[FATAL] Failed to connect to Redis during production startup preflight.');
  }

  return new Promise((resolve) => {
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`====================================================`);
      console.log(`🚀 Hiralal & Sons Rewards API running on port ${config.port}`);
      console.log(`   URL: http://localhost:${config.port}`);
      console.log(`   LAN/Emulator URL: http://0.0.0.0:${config.port}`);
      console.log(`   Environment: ${config.nodeEnv}`);
      console.log(`====================================================`);
      resolve(server);
    });
  });
}

export { app, startServer };

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('❌ [FATAL] Server startup failed:', err.message);
    process.exit(1);
  });
}
