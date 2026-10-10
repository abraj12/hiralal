import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import crypto from 'crypto';
import { config } from './config';
import { checkDatabaseConnection } from './db';
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

const app = express();

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
    if (!config.isProduction) return callback(null, true);
    if (config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
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
    'x-razorpay-signature',
    'x-razorpay-event-id',
    'x-test-rate-limit',
  ],
};
app.use(cors(corsOptions));

// JSON Body Parser with rawBody preservation for webhooks
app.use(express.json({
  limit: '15mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Static assets (logos, cards, banners for mobile and admin)
const sharedAssetsPath = path.join(__dirname, '../../shared/assets');
app.use('/assets', express.static(sharedAssetsPath));

// Health Check Endpoints
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Hiralal & Sons Rewards Management API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/live', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/ready', async (_req: Request, res: Response) => {
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
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/payment-account', paymentRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);

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
  const status = err.status || 500;
  const code =
    err.code ||
    (status === 400
      ? 'BAD_REQUEST'
      : status === 401
      ? 'UNAUTHORIZED'
      : status === 403
      ? 'FORBIDDEN'
      : 'INTERNAL_SERVER_ERROR');

  const message =
    config.isProduction && status >= 500
      ? `Internal server error. Reference ID: ${req.requestId}`
      : err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    code,
    message,
    requestId: req.requestId,
  });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, '0.0.0.0', async () => {
    console.log(`====================================================`);
    console.log(`🚀 Hiralal & Sons Rewards API running on port ${config.port}`);
    console.log(`   URL: http://localhost:${config.port}`);
    console.log(`   LAN/Emulator URL: http://0.0.0.0:${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`====================================================`);
    await checkDatabaseConnection();
    await checkRedisConnection();
  });
}
