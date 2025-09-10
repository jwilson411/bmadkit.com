import { createClient, RedisClientType } from 'redis';
import { getConfig } from './config';
import { logger } from './logger';

let redisClient: RedisClientType | null = null;

export const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    const config = getConfig();
    
    if (!config.REDIS_URL) {
      throw new Error('REDIS_URL is required but not provided in environment configuration');
    }

    redisClient = createClient({
      url: config.REDIS_URL,
    });

    redisClient.on('error', (error) => {
      logger.error('Redis client error', { error });
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected successfully');
    });

    redisClient.on('disconnect', () => {
      logger.warn('Redis client disconnected');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });
  }

  return redisClient;
};

export const connectRedis = async (): Promise<void> => {
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await client.connect();
      logger.info('Redis connection established successfully');
    }
  } catch (error) {
    logger.error('Failed to connect to Redis', { error });
    throw new Error('Redis connection failed');
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.disconnect();
      redisClient = null;
      logger.info('Redis connection closed successfully');
    } catch (error) {
      logger.error('Failed to disconnect from Redis', { error });
      throw new Error('Redis disconnection failed');
    }
  }
};

export const testRedisConnection = async (): Promise<boolean> => {
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await client.connect();
    }
    await client.ping();
    logger.info('Redis connection test successful');
    return true;
  } catch (error) {
    logger.error('Redis connection test failed', { error });
    return false;
  }
};

export const setCache = async (key: string, value: string, ttlSeconds?: number): Promise<void> => {
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await client.connect();
    }
    
    if (ttlSeconds) {
      await client.setEx(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
    
    logger.debug('Cache set successfully', { key, ttlSeconds });
  } catch (error) {
    logger.error('Failed to set cache', { error, key });
    throw new Error('Cache set operation failed');
  }
};

export const getCache = async (key: string): Promise<string | null> => {
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await client.connect();
    }
    
    const value = await client.get(key);
    logger.debug('Cache retrieved', { key, found: !!value });
    return value;
  } catch (error) {
    logger.error('Failed to get cache', { error, key });
    throw new Error('Cache get operation failed');
  }
};

export const deleteCache = async (key: string): Promise<void> => {
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await client.connect();
    }
    
    await client.del(key);
    logger.debug('Cache deleted successfully', { key });
  } catch (error) {
    logger.error('Failed to delete cache', { error, key });
    throw new Error('Cache delete operation failed');
  }
};