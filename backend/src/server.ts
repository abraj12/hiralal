import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config';
import { checkDatabaseConnection } from './db';

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

// Security middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: '*', // Allow mobile and admin frontends
  credentials: true,
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static assets (logos, cards, banners for mobile and admin)
const sharedAssetsPath = path.join(__dirname, '../../shared/assets');
app.use('/assets', express.static(sharedAssetsPath));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Hiralal & Sons Rewards Management API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
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
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found` });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, async () => {
    console.log(`====================================================`);
    console.log(`🚀 Hiralal & Sons Rewards API running on port ${config.port}`);
    console.log(`   URL: http://localhost:${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`====================================================`);
    await checkDatabaseConnection();
  });
}
