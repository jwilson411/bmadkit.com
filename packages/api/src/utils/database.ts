import { PrismaClient } from '@prisma/client';
import { getConfig } from './config';
import { logger } from './logger';

let prisma: PrismaClient | null = null;

export const getPrismaClient = (): PrismaClient => {
  if (!prisma) {
    const config = getConfig();
    
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL is required but not provided in environment configuration');
    }

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.DATABASE_URL
        }
      },
      log: config.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }

  return prisma;
};

export const connectDatabase = async (): Promise<void> => {
  try {
    const client = getPrismaClient();
    await client.$connect();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw new Error('Database connection failed');
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (prisma) {
    try {
      await prisma.$disconnect();
      prisma = null;
      logger.info('Database connection closed successfully');
    } catch (error) {
      logger.error('Failed to disconnect from database', { error });
      throw new Error('Database disconnection failed');
    }
  }
};

export const testDatabaseConnection = async (): Promise<boolean> => {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    logger.info('Database connection test successful');
    return true;
  } catch (error) {
    logger.error('Database connection test failed', { error });
    return false;
  }
};