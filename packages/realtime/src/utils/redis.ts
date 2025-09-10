import { createClient, RedisClientType } from 'redis';
import { getConfig } from './config';
import { logger } from './logger';

let redisClient: RedisClientType | null = null;
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;

const createRedisClient = (): RedisClientType => {
  const config = getConfig();
  
  if (!config.REDIS_URL) {
    throw new Error('REDIS_URL is required for realtime service');
  }

  const client = createClient({
    url: config.REDIS_URL,
  });

  client.on('error', (error) => {
    logger.error('Redis client error in realtime service', { error });
  });

  client.on('connect', () => {
    logger.info('Redis client connected successfully in realtime service');
  });

  client.on('disconnect', () => {
    logger.warn('Redis client disconnected in realtime service');
  });

  client.on('reconnecting', () => {
    logger.info('Redis client reconnecting in realtime service...');
  });

  return client;
};

export const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
};

export const getPubClient = (): RedisClientType => {
  if (!pubClient) {
    pubClient = createRedisClient();
  }
  return pubClient;
};

export const getSubClient = (): RedisClientType => {
  if (!subClient) {
    subClient = createRedisClient();
  }
  return subClient;
};

export const connectRedis = async (): Promise<void> => {
  try {
    const client = getRedisClient();
    if (!client.isOpen && !client.isReady) {
      await client.connect();
      logger.info('Redis connection established for realtime service');
    }
  } catch (error) {
    logger.error('Failed to connect to Redis in realtime service', { error });
    throw new Error('Redis connection failed');
  }
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.disconnect();
      redisClient = null;
      logger.info('Redis connection closed for realtime service');
    } catch (error) {
      logger.error('Failed to disconnect from Redis in realtime service', { error });
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
    logger.info('Redis connection test successful for realtime service');
    return true;
  } catch (error) {
    logger.error('Redis connection test failed for realtime service', { error });
    return false;
  }
};