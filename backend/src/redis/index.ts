import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  const redisOptions: any = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: true,
    retryStrategy(times: number) {
      if (config.nodeEnv === 'test') {
        return null; // Don't loop retries in unit test environment
      }
      return Math.min(times * 100, 3000);
    },
  };

  if (config.redis.url) {
    redisClient = new Redis(config.redis.url, redisOptions);
  } else {
    redisClient = new Redis(redisOptions);
  }

  redisClient.on('error', (err) => {
    if (config.nodeEnv !== 'test') {
      console.warn('⚠️ [REDIS WARNING]', err.message);
    }
  });

  return redisClient;
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (err) {
    return false;
  }
}
