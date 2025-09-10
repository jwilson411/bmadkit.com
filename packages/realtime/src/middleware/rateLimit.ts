import { Socket } from 'socket.io';
import { getRedisClient } from '../utils/redis';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';

const redis = getRedisClient();
const config = getConfig();

export class ConnectionRateLimiter {
  private readonly windowMs: number;
  private readonly maxConnections: number;

  constructor(windowMs: number = 60000, maxConnections: number = config.RATE_LIMIT_CONNECTIONS_PER_IP) {
    this.windowMs = windowMs;
    this.maxConnections = maxConnections;
  }

  async checkConnectionLimit(ip: string): Promise<boolean> {
    const key = `conn_limit:${ip}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    try {
      // Use Redis sorted set to track connections within time window
      await redis.zRemRangeByScore(key, 0, windowStart);
      const connectionCount = await redis.zCard(key);

      if (connectionCount >= this.maxConnections) {
        logger.warn('Connection rate limit exceeded', {
          ip,
          connectionCount,
          maxConnections: this.maxConnections
        });
        return false;
      }

      // Add current connection timestamp
      await redis.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
      await redis.expire(key, Math.ceil(this.windowMs / 1000));

      return true;
    } catch (error) {
      logger.error('Error checking connection rate limit', { error, ip });
      // On Redis error, allow connection to avoid service disruption
      return true;
    }
  }
}

export class MessageRateLimiter {
  private readonly windowMs: number;
  private readonly maxMessages: number;

  constructor(windowMs: number = 1000, maxMessages: number = config.RATE_LIMIT_MESSAGES_PER_SECOND) {
    this.windowMs = windowMs;
    this.maxMessages = maxMessages;
  }

  async checkMessageLimit(socketId: string, userId?: string): Promise<boolean> {
    const identifier = userId || socketId;
    const key = `msg_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    try {
      // Clean old messages
      await redis.zRemRangeByScore(key, 0, windowStart);
      const messageCount = await redis.zCard(key);

      if (messageCount >= this.maxMessages) {
        logger.warn('Message rate limit exceeded', {
          identifier,
          messageCount,
          maxMessages: this.maxMessages
        });
        return false;
      }

      // Add current message timestamp
      await redis.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
      await redis.expire(key, Math.ceil(this.windowMs / 1000));

      return true;
    } catch (error) {
      logger.error('Error checking message rate limit', { error, identifier });
      // On Redis error, allow message to avoid service disruption
      return true;
    }
  }
}

export class ConnectionSpamProtector {
  private readonly suspiciousConnectionThreshold = 20;
  private readonly suspiciousTimeWindow = 60000; // 1 minute
  private readonly banDuration = 300000; // 5 minutes

  async checkForSuspiciousActivity(ip: string): Promise<boolean> {
    const key = `spam_check:${ip}`;
    const banKey = `banned:${ip}`;
    const now = Date.now();

    try {
      // Check if IP is currently banned
      const isBanned = await redis.get(banKey);
      if (isBanned) {
        logger.warn('Blocked connection from banned IP', { ip });
        return false;
      }

      // Track connection attempts
      const windowStart = now - this.suspiciousTimeWindow;
      await redis.zRemRangeByScore(key, 0, windowStart);
      const attemptCount = await redis.zCard(key);

      // Add current attempt
      await redis.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
      await redis.expire(key, Math.ceil(this.suspiciousTimeWindow / 1000));

      // Ban IP if too many attempts
      if (attemptCount >= this.suspiciousConnectionThreshold) {
        await redis.set(banKey, '1', { EX: Math.ceil(this.banDuration / 1000) });
        
        logger.warn('IP banned for suspicious activity', {
          ip,
          attemptCount,
          banDuration: this.banDuration
        });
        
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking for suspicious activity', { error, ip });
      // On Redis error, allow connection
      return true;
    }
  }
}

// Middleware factories
export const createConnectionRateLimiter = (options?: { windowMs?: number; maxConnections?: number }) => {
  const limiter = new ConnectionRateLimiter(options?.windowMs, options?.maxConnections);
  
  return async (socket: Socket, next: (err?: Error) => void) => {
    const ip = socket.handshake.address;
    const allowed = await limiter.checkConnectionLimit(ip);
    
    if (!allowed) {
      const error = new Error('Too many connection attempts. Please try again later.');
      (error as any).code = 'RATE_LIMIT_EXCEEDED';
      return next(error);
    }
    
    next();
  };
};

export const createSpamProtection = () => {
  const protector = new ConnectionSpamProtector();
  
  return async (socket: Socket, next: (err?: Error) => void) => {
    const ip = socket.handshake.address;
    const allowed = await protector.checkForSuspiciousActivity(ip);
    
    if (!allowed) {
      const error = new Error('Connection blocked due to suspicious activity.');
      (error as any).code = 'SPAM_PROTECTION';
      return next(error);
    }
    
    next();
  };
};

export const createMessageRateLimiter = (options?: { windowMs?: number; maxMessages?: number }) => {
  const limiter = new MessageRateLimiter(options?.windowMs, options?.maxMessages);
  
  return async (socket: Socket, eventName: string, next: (err?: Error) => void) => {
    const userData = (socket as any).userData;
    const allowed = await limiter.checkMessageLimit(socket.id, userData?.userId);
    
    if (!allowed) {
      const error = new Error('Message rate limit exceeded. Please slow down.');
      (error as any).code = 'MESSAGE_RATE_LIMIT_EXCEEDED';
      
      // Emit rate limit warning to client
      socket.emit('rate_limit_warning', {
        message: 'You are sending messages too quickly. Please slow down.',
        retryAfter: 1000,
        timestamp: new Date().toISOString()
      });
      
      return next(error);
    }
    
    next();
  };
};