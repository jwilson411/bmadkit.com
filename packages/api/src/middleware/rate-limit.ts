import rateLimit from 'express-rate-limit';
import { setCache, getCache } from '../utils/redis';
import { logger } from '../utils/logger';

// Rate limiting for login attempts
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes per IP
  message: {
    success: false,
    error: {
      message: 'Too many login attempts, please try again later',
      code: 'LOGIN_RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Login rate limit exceeded', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.headers['x-correlation-id']
    });
    
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many login attempts, please try again later',
        code: 'LOGIN_RATE_LIMIT_EXCEEDED',
        correlationId: req.headers['x-correlation-id'],
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Rate limiting for registration attempts  
export const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registration attempts per hour per IP
  message: {
    success: false,
    error: {
      message: 'Too many registration attempts, please try again later',
      code: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Registration rate limit exceeded', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.headers['x-correlation-id']
    });
    
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many registration attempts, please try again later',
        code: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
        correlationId: req.headers['x-correlation-id'],
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Rate limiting for password reset requests
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset attempts per hour per IP
  message: {
    success: false,
    error: {
      message: 'Too many password reset attempts, please try again later',
      code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.headers['x-correlation-id']
    });
    
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many password reset attempts, please try again later',
        code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED',
        correlationId: req.headers['x-correlation-id'],
        timestamp: new Date().toISOString()
      }
    });
  }
});

// User-specific rate limiting using Redis
export const createUserRateLimit = (windowMs: number, maxAttempts: number, action: string) => {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id || req.body?.email || req.ip;
    const key = `rate-limit:${action}:${userId}`;
    
    try {
      const current = await getCache(key);
      const attempts = current ? parseInt(current) : 0;
      
      if (attempts >= maxAttempts) {
        logger.warn(`User rate limit exceeded for ${action}`, {
          userId,
          attempts,
          maxAttempts,
          action
        });
        
        return res.status(429).json({
          success: false,
          error: {
            message: `Too many ${action} attempts, please try again later`,
            code: `${action.toUpperCase()}_RATE_LIMIT_EXCEEDED`,
            correlationId: req.headers['x-correlation-id'],
            timestamp: new Date().toISOString()
          }
        });
      }
      
      // Increment counter
      await setCache(key, (attempts + 1).toString(), Math.floor(windowMs / 1000));
      
      next();
    } catch (error) {
      logger.error('Rate limiting error', { error, action, userId });
      // On error, allow the request to proceed
      next();
    }
  };
};

// Failed login tracking
export const trackFailedLogin = async (identifier: string): Promise<void> => {
  const key = `failed-login:${identifier}`;
  try {
    const current = await getCache(key);
    const attempts = current ? parseInt(current) : 0;
    await setCache(key, (attempts + 1).toString(), 15 * 60); // 15 minutes
    
    if (attempts + 1 >= 5) {
      logger.warn('Multiple failed login attempts detected', {
        identifier,
        attempts: attempts + 1
      });
    }
  } catch (error) {
    logger.error('Failed to track failed login', { error, identifier });
  }
};

// Clear failed login attempts on successful login
export const clearFailedLogin = async (identifier: string): Promise<void> => {
  const key = `failed-login:${identifier}`;
  try {
    await setCache(key, '0', 1); // Clear by setting to 0 with 1 second expiry
  } catch (error) {
    logger.error('Failed to clear failed login counter', { error, identifier });
  }
};

// Check if account should be temporarily locked
export const checkAccountLock = async (identifier: string): Promise<boolean> => {
  const key = `failed-login:${identifier}`;
  try {
    const current = await getCache(key);
    const attempts = current ? parseInt(current) : 0;
    return attempts >= 10; // Lock after 10 failed attempts
  } catch (error) {
    logger.error('Failed to check account lock status', { error, identifier });
    return false;
  }
};