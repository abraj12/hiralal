import { PrismaClient } from '@prisma/client';
import { config } from '../config';

// Global singleton for Prisma
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
  });

if (config.nodeEnv !== 'production') globalForPrisma.prisma = prisma;

let isPostgresAvailable = false;

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    isPostgresAvailable = true;
    console.log('✅ Connected to PostgreSQL database successfully.');
    return true;
  } catch (error) {
    isPostgresAvailable = false;
    console.warn('⚠️  PostgreSQL not reachable, using embedded memory/file database fallback.');
    return false;
  }
}

export function getDatabaseStatus(): boolean {
  return isPostgresAvailable;
}
