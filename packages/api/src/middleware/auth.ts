import { Request, Response, NextFunction } from 'express';
import passport from '../config/passport';
import { verifyAccessToken } from '../utils/jwt';
import { logger } from '../utils/logger';
import { getPrismaClient } from '../utils/database';

const prisma = getPrismaClient();

export interface AuthenticatedUser {
  id: string;
  email: string;
  subscriptionTier: string;
  lastLogin?: Date;
  createdAt: Date;
  preferences?: any;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

// Passport JWT authentication middleware
export const authenticateJWT = passport.authenticate('jwt', { session: false });

// Manual authentication for more control
export const authenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1] || 
                  req.headers['x-access-token'] as string ||
                  req.cookies?.['access-token'];

    if (!token) {
      logger.warn('Authentication failed: No token provided', {
        correlationId: req.headers['x-correlation-id'],
        ip: req.ip
      });
      
      res.status(401).json({
        success: false,
        error: {
          message: 'Access token required',
          code: 'UNAUTHORIZED',
          correlationId: req.headers['x-correlation-id'],
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    // Verify token using our custom JWT utilities
    const decoded = await verifyAccessToken(token);
    
    // Fetch fresh user data from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        subscriptionTier: true,
        lastLogin: true,
        createdAt: true,
        preferences: true,
      },
    });

    if (!user) {
      logger.warn('Authentication failed: User not found', {
        userId: decoded.userId,
        correlationId: req.headers['x-correlation-id']
      });
      
      res.status(401).json({
        success: false,
        error: {
          message: 'User not found',
          code: 'UNAUTHORIZED',
          correlationId: req.headers['x-correlation-id'],
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    req.user = user;
    
    logger.debug('User authenticated successfully', {
      userId: user.id,
      correlationId: req.headers['x-correlation-id']
    });
    
    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Authentication failed: Invalid token', {
      error: errorMessage,
      correlationId: req.headers['x-correlation-id'],
      ip: req.ip
    });
    
    res.status(403).json({
      success: false,
      error: {
        message: 'Invalid or expired token',
        code: 'FORBIDDEN',
        correlationId: req.headers['x-correlation-id'],
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const requireSubscription = (requiredTier: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          code: 'UNAUTHORIZED',
          correlationId: req.headers['x-correlation-id'],
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    const tierLevels = {
      'FREE': 0,
      'EMAIL_CAPTURED': 1,
      'PREMIUM': 2
    };

    const userTierLevel = tierLevels[req.user.subscriptionTier as keyof typeof tierLevels] || 0;
    const requiredTierLevel = tierLevels[requiredTier as keyof typeof tierLevels] || 0;

    if (userTierLevel < requiredTierLevel) {
      logger.warn('Subscription tier insufficient', {
        userId: req.user.userId,
        currentTier: req.user.subscriptionTier,
        requiredTier,
        correlationId: req.headers['x-correlation-id']
      });

      res.status(403).json({
        success: false,
        error: {
          message: `${requiredTier} subscription required`,
          code: 'SUBSCRIPTION_REQUIRED',
          correlationId: req.headers['x-correlation-id'],
          timestamp: new Date().toISOString(),
          details: {
            currentTier: req.user.subscriptionTier,
            requiredTier
          }
        }
      });
      return;
    }

    next();
  };
};

export const optionalAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    
    logger.debug('Optional authentication successful', {
      userId: decoded.userId,
      correlationId: req.headers['x-correlation-id']
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.debug('Optional authentication failed', {
      error: errorMessage,
      correlationId: req.headers['x-correlation-id']
    });
  }

  next();
};