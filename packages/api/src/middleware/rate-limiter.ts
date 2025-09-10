import { Request, Response, NextFunction } from 'express';
import LRUCache from 'lru-cache';
import { logger } from '../utils/logger.ts';
import { LLMProvider } from '../models/llm-request.ts';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  maxTokens?: number; // Max tokens per window (optional)
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  keyGenerator?: (req: Request) => string; // Custom key generator
  onLimitReached?: (req: Request, res: Response) => void; // Custom limit reached handler
  message?: string; // Custom error message
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
  totalHits: number;
}

export interface TokenBucketConfig {
  capacity: number; // Maximum tokens in bucket
  refillRate: number; // Tokens added per interval
  refillInterval: number; // Interval in milliseconds
}

/**
 * Token bucket implementation for rate limiting
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly config: TokenBucketConfig;

  constructor(config: TokenBucketConfig) {
    this.config = config;
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume tokens from the bucket
   */
  consume(tokensRequested: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokensRequested) {
      this.tokens -= tokensRequested;
      return true;
    }

    return false;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get time until next token is available
   */
  getRetryAfter(): number {
    this.refill();
    if (this.tokens >= 1) return 0;

    const tokensNeeded = 1 - this.tokens;
    return Math.ceil((tokensNeeded / this.config.refillRate) * this.config.refillInterval);
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor((timePassed / this.config.refillInterval) * this.config.refillRate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.config.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
}

/**
 * Rate limiter with sliding window and token bucket support
 */
export class RateLimiter {
  private requestCounts = new LRUCache<string, number>({ max: 10000, ttl: 3600000 }); // 1 hour TTL
  private tokenBuckets = new LRUCache<string, TokenBucket>({ max: 1000, ttl: 3600000 });
  private windowStarts = new LRUCache<string, number>({ max: 10000, ttl: 3600000 });

  constructor(private config: RateLimitConfig) {}

  /**
   * Check if request should be rate limited
   */
  checkLimit(req: Request, tokensRequested: number = 1): { allowed: boolean; info: RateLimitInfo } {
    const key = this.generateKey(req);
    const now = Date.now();
    
    // Initialize window if needed
    if (!this.windowStarts.has(key)) {
      this.windowStarts.set(key, now);
      this.requestCounts.set(key, 0);
    }

    const windowStart = this.windowStarts.get(key)!;
    const currentCount = this.requestCounts.get(key) || 0;

    // Check if window has expired
    if (now - windowStart >= this.config.windowMs) {
      this.windowStarts.set(key, now);
      this.requestCounts.set(key, 0);
      return {
        allowed: true,
        info: {
          limit: this.config.maxRequests,
          remaining: this.config.maxRequests - 1,
          resetTime: new Date(now + this.config.windowMs),
          totalHits: 1
        }
      };
    }

    // Check request limit
    if (currentCount >= this.config.maxRequests) {
      return {
        allowed: false,
        info: {
          limit: this.config.maxRequests,
          remaining: 0,
          resetTime: new Date(windowStart + this.config.windowMs),
          totalHits: currentCount
        }
      };
    }

    // Check token limit if configured
    if (this.config.maxTokens && tokensRequested > 0) {
      const tokenKey = `${key}:tokens`;
      let bucket = this.tokenBuckets.get(tokenKey);
      
      if (!bucket) {
        bucket = new TokenBucket({
          capacity: this.config.maxTokens,
          refillRate: this.config.maxTokens / (this.config.windowMs / 1000), // refill over window
          refillInterval: 1000 // 1 second
        });
        this.tokenBuckets.set(tokenKey, bucket);
      }

      if (!bucket.consume(tokensRequested)) {
        return {
          allowed: false,
          info: {
            limit: this.config.maxTokens,
            remaining: Math.floor(bucket.getTokens()),
            resetTime: new Date(now + bucket.getRetryAfter()),
            totalHits: currentCount
          }
        };
      }
    }

    // Update request count
    this.requestCounts.set(key, currentCount + 1);

    return {
      allowed: true,
      info: {
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests - (currentCount + 1),
        resetTime: new Date(windowStart + this.config.windowMs),
        totalHits: currentCount + 1
      }
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(req: Request): void {
    const key = this.generateKey(req);
    this.requestCounts.delete(key);
    this.windowStarts.delete(key);
    this.tokenBuckets.delete(`${key}:tokens`);
  }

  private generateKey(req: Request): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(req);
    }

    // Default key generation based on IP and user ID
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = (req as any).user?.id || 'anonymous';
    return `${ip}:${userId}`;
  }
}

/**
 * Create rate limiting middleware for LLM requests
 */
export function createLLMRateLimiter(provider: LLMProvider, config: Partial<RateLimitConfig> = {}) {
  const rateLimiter = new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 60, // 60 requests per minute
    maxTokens: 100000, // 100k tokens per minute
    message: `Rate limit exceeded for ${provider} provider`,
    ...config
  });

  return (req: Request, res: Response, next: NextFunction) => {
    // Estimate token count from request
    const requestBody = req.body || {};
    const messages = requestBody.messages || [];
    const estimatedTokens = messages.reduce((total: number, msg: any) => {
      return total + Math.ceil((msg.content || '').length / 4);
    }, 0);

    const { allowed, info } = rateLimiter.checkLimit(req, estimatedTokens);

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': info.limit.toString(),
      'X-RateLimit-Remaining': info.remaining.toString(),
      'X-RateLimit-Reset': info.resetTime.getTime().toString(),
      'X-RateLimit-Provider': provider
    });

    if (!allowed) {
      const retryAfter = Math.ceil((info.resetTime.getTime() - Date.now()) / 1000);
      res.set('Retry-After', retryAfter.toString());

      logger.warn('Rate limit exceeded', {
        provider,
        ip: req.ip,
        userId: (req as any).user?.id,
        limit: info.limit,
        current: info.totalHits,
        resetTime: info.resetTime
      });

      if (config.onLimitReached) {
        config.onLimitReached(req, res);
      } else {
        res.status(429).json({
          success: false,
          error: {
            message: config.message || `Rate limit exceeded for ${provider} provider`,
            code: 'RATE_LIMIT_EXCEEDED',
            provider,
            limit: info.limit,
            remaining: info.remaining,
            resetTime: info.resetTime,
            retryAfter
          }
        });
      }
      return;
    }

    logger.debug('Rate limit check passed', {
      provider,
      limit: info.limit,
      remaining: info.remaining,
      estimatedTokens
    });

    next();
  };
}

/**
 * Global rate limiter for all LLM requests
 */
export function createGlobalLLMRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const rateLimiter = new RateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 120, // Total 120 requests per minute across all providers
    maxTokens: 200000, // Total 200k tokens per minute
    keyGenerator: (req) => {
      // Global rate limiting per user/IP
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userId = (req as any).user?.id || 'anonymous';
      return `global:${ip}:${userId}`;
    },
    message: 'Global LLM rate limit exceeded',
    ...config
  });

  return (req: Request, res: Response, next: NextFunction) => {
    // Estimate token count
    const requestBody = req.body || {};
    const messages = requestBody.messages || [];
    const estimatedTokens = messages.reduce((total: number, msg: any) => {
      return total + Math.ceil((msg.content || '').length / 4);
    }, 0);

    const { allowed, info } = rateLimiter.checkLimit(req, estimatedTokens);

    // Set global rate limit headers
    res.set({
      'X-Global-RateLimit-Limit': info.limit.toString(),
      'X-Global-RateLimit-Remaining': info.remaining.toString(),
      'X-Global-RateLimit-Reset': info.resetTime.getTime().toString()
    });

    if (!allowed) {
      const retryAfter = Math.ceil((info.resetTime.getTime() - Date.now()) / 1000);
      res.set('Retry-After', retryAfter.toString());

      logger.warn('Global rate limit exceeded', {
        ip: req.ip,
        userId: (req as any).user?.id,
        limit: info.limit,
        current: info.totalHits,
        estimatedTokens
      });

      res.status(429).json({
        success: false,
        error: {
          message: 'Global LLM rate limit exceeded',
          code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
          limit: info.limit,
          remaining: info.remaining,
          resetTime: info.resetTime,
          retryAfter
        }
      });
      return;
    }

    next();
  };
}

/**
 * Adaptive rate limiter that adjusts limits based on provider health
 */
export class AdaptiveRateLimiter extends RateLimiter {
  private baseConfig: RateLimitConfig;
  private healthStatusGetter: () => Map<LLMProvider, { status: string; errorRate: number }>;

  constructor(
    baseConfig: RateLimitConfig,
    healthStatusGetter: () => Map<LLMProvider, { status: string; errorRate: number }>
  ) {
    super(baseConfig);
    this.baseConfig = baseConfig;
    this.healthStatusGetter = healthStatusGetter;
  }

  checkLimit(req: Request, tokensRequested: number = 1): { allowed: boolean; info: RateLimitInfo } {
    const provider = this.extractProvider(req);
    const adjustedConfig = this.adjustConfigForHealth(provider);
    
    // Temporarily update config
    const originalConfig = { ...this.config };
    Object.assign(this.config, adjustedConfig);
    
    const result = super.checkLimit(req, tokensRequested);
    
    // Restore original config
    Object.assign(this.config, originalConfig);
    
    return result;
  }

  private extractProvider(req: Request): LLMProvider {
    return (req.body?.provider as LLMProvider) || 'openai';
  }

  private adjustConfigForHealth(provider: LLMProvider): Partial<RateLimitConfig> {
    const healthStatus = this.healthStatusGetter();
    const providerHealth = healthStatus.get(provider);
    
    if (!providerHealth) {
      return this.baseConfig;
    }

    let adjustment = 1.0;

    // Reduce limits for unhealthy providers
    switch (providerHealth.status) {
      case 'unhealthy':
        adjustment = 0.3;
        break;
      case 'degraded':
        adjustment = 0.6;
        break;
      case 'healthy':
        adjustment = 1.0;
        break;
      default:
        adjustment = 0.5;
    }

    // Further adjust based on error rate
    if (providerHealth.errorRate > 0.1) {
      adjustment *= 0.7;
    }

    return {
      maxRequests: Math.floor(this.baseConfig.maxRequests * adjustment),
      maxTokens: this.baseConfig.maxTokens ? Math.floor(this.baseConfig.maxTokens * adjustment) : undefined
    };
  }
}