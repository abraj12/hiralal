import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;
let lastErrorLog = 0;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  const redisOptions: any = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: true,
    enableOfflineQueue: false, // Critical: do NOT hang offline commands; fail fast so fallback kicks in
    connectTimeout: 2000,
    retryStrategy(times: number) {
      if (config.nodeEnv === 'test') {
        return null;
      }
      return Math.min(times * 500, 5000);
    },
  };

  if (config.redis.url) {
    redisClient = new Redis(config.redis.url, redisOptions);
  } else {
    redisClient = new Redis(redisOptions);
  }

  redisClient.on('error', (err) => {
    const now = Date.now();
    if (now - lastErrorLog > 30000 && config.nodeEnv !== 'test') {
      console.warn('⚠️ [REDIS OFFLINE] Redis unavailable, fallback cache active:', err.message);
      lastErrorLog = now;
    }
  });

  redisClient.on('ready', () => {
    console.log('✅ [REDIS] Connected and ready');
  });

  return redisClient;
}

export function isRedisReady(): boolean {
  if (!redisClient) {
    try {
      getRedisClient();
    } catch {
      return false;
    }
  }
  return redisClient !== null && redisClient.status === 'ready';
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (client.status !== 'ready') {
      return false;
    }
    const pong = await Promise.race([
      client.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 500)),
    ]);
    return pong === 'PONG';
  } catch (err) {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
  }
}


