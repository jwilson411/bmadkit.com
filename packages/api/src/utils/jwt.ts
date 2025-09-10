import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getConfig } from './config';
import { logger } from './logger';
import { setCache, getCache, deleteCache } from './redis';

export interface JWTPayload {
  userId: string;
  email: string;
  subscriptionTier: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
  jti?: string; // JWT ID for token blacklisting
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const TOKEN_BLACKLIST_PREFIX = 'blacklist:';
const REFRESH_TOKEN_PREFIX = 'refresh:';

let privateKey: string | undefined;
let publicKey: string | undefined;

const getKeys = () => {
  const config = getConfig();
  
  if (!privateKey || !publicKey) {
    try {
      // Try to load RS256 keys first
      const keyPath = process.env.JWT_PRIVATE_KEY_PATH || path.join(process.cwd(), 'keys');
      
      if (fs.existsSync(path.join(keyPath, 'private.pem'))) {
        privateKey = fs.readFileSync(path.join(keyPath, 'private.pem'), 'utf8');
        publicKey = fs.readFileSync(path.join(keyPath, 'public.pem'), 'utf8');
        logger.info('Using RS256 keys for JWT signing');
      } else {
        // Fallback to HS256 with secret
        if (!config.JWT_SECRET) {
          throw new Error('JWT_SECRET is required when RS256 keys are not available');
        }
        privateKey = publicKey = config.JWT_SECRET;
        logger.info('Using HS256 secret for JWT signing');
      }
    } catch (error) {
      logger.error('Failed to load JWT keys', { error });
      throw new Error('JWT key configuration failed');
    }
  }
  
  return { privateKey, publicKey };
};

export const generateTokenPair = async (payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): Promise<TokenPair> => {
  const { privateKey } = getKeys();
  const jti = require('crypto').randomUUID();
  
  try {
    const accessTokenPayload = {
      ...payload,
      jti,
      type: 'access'
    };
    
    const refreshTokenPayload = {
      userId: payload.userId,
      jti,
      type: 'refresh'
    };

    const algorithm = privateKey.includes('BEGIN') ? 'RS256' : 'HS256';

    const accessToken = jwt.sign(accessTokenPayload, privateKey, {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      issuer: 'bmad-api',
      audience: 'bmad-client',
      algorithm,
    });

    const refreshToken = jwt.sign(refreshTokenPayload, privateKey, {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      issuer: 'bmad-api',
      audience: 'bmad-client',
      algorithm,
    });

    // Store refresh token in Redis with expiration
    await setCache(`${REFRESH_TOKEN_PREFIX}${jti}`, JSON.stringify({
      userId: payload.userId,
      createdAt: new Date().toISOString(),
    }), 7 * 24 * 60 * 60); // 7 days

    logger.debug('Token pair generated successfully', {
      userId: payload.userId,
      jti,
      accessTokenExpiresIn: ACCESS_TOKEN_EXPIRES_IN,
      refreshTokenExpiresIn: REFRESH_TOKEN_EXPIRES_IN
    });

    return { accessToken, refreshToken };
  } catch (error) {
    logger.error('Failed to generate token pair', { error, userId: payload.userId });
    throw new Error('Token generation failed');
  }
};

export const verifyAccessToken = async (token: string): Promise<JWTPayload> => {
  const { publicKey } = getKeys();
  
  try {
    const algorithm = publicKey.includes('BEGIN') ? 'RS256' : 'HS256';
    
    const decoded = jwt.verify(token, publicKey, {
      issuer: 'bmad-api',
      audience: 'bmad-client',
      algorithms: [algorithm],
    }) as JWTPayload & { type: string };

    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    // Check if token is blacklisted
    if (decoded.jti) {
      const isBlacklisted = await getCache(`${TOKEN_BLACKLIST_PREFIX}${decoded.jti}`);
      if (isBlacklisted) {
        throw new Error('Token has been revoked');
      }
    }

    logger.debug('Access token verified successfully', {
      userId: decoded.userId,
      jti: decoded.jti
    });

    return decoded;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Access token verification failed', { error: errorMessage });
    throw new Error('Invalid or expired access token');
  }
};

export const verifyRefreshToken = async (token: string): Promise<{ userId: string; jti: string }> => {
  const { publicKey } = getKeys();
  
  try {
    const algorithm = publicKey.includes('BEGIN') ? 'RS256' : 'HS256';
    
    const decoded = jwt.verify(token, publicKey, {
      issuer: 'bmad-api',
      audience: 'bmad-client',
      algorithms: [algorithm],
    }) as { userId: string; jti: string; type: string };

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if refresh token exists in Redis
    const refreshTokenData = await getCache(`${REFRESH_TOKEN_PREFIX}${decoded.jti}`);
    if (!refreshTokenData) {
      throw new Error('Refresh token not found or expired');
    }

    logger.debug('Refresh token verified successfully', {
      userId: decoded.userId,
      jti: decoded.jti
    });

    return { userId: decoded.userId, jti: decoded.jti };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Refresh token verification failed', { error: errorMessage });
    throw new Error('Invalid or expired refresh token');
  }
};

export const refreshTokenPair = async (refreshToken: string, userPayload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): Promise<TokenPair> => {
  try {
    const { userId, jti } = await verifyRefreshToken(refreshToken);
    
    if (userId !== userPayload.userId) {
      throw new Error('Token user mismatch');
    }

    // Blacklist the old refresh token
    await blacklistToken(jti);
    
    // Generate new token pair
    const newTokenPair = await generateTokenPair(userPayload);

    logger.info('Token pair refreshed successfully', {
      userId,
      oldJti: jti
    });

    return newTokenPair;
  } catch (error) {
    logger.error('Token refresh failed', { error });
    throw new Error('Token refresh failed');
  }
};

export const blacklistToken = async (jti: string): Promise<void> => {
  try {
    // Add token to blacklist with 15 minute expiration (access token lifetime)
    await setCache(`${TOKEN_BLACKLIST_PREFIX}${jti}`, 'blacklisted', 15 * 60);
    
    // Remove refresh token if it exists
    await deleteCache(`${REFRESH_TOKEN_PREFIX}${jti}`);

    logger.debug('Token blacklisted successfully', { jti });
  } catch (error) {
    logger.error('Failed to blacklist token', { error, jti });
    throw new Error('Token blacklisting failed');
  }
};

export const revokeAllUserTokens = async (userId: string): Promise<void> => {
  try {
    // This would require scanning Redis for all refresh tokens belonging to the user
    // For now, we'll implement a simple approach by tracking user sessions
    // In production, consider using a more efficient approach with user session tracking
    
    logger.info('All user tokens revoked', { userId });
    // Implementation would scan Redis keys and blacklist all user tokens
  } catch (error) {
    logger.error('Failed to revoke user tokens', { error, userId });
    throw new Error('Token revocation failed');
  }
};

export const decodeTokenWithoutVerification = (token: string): any => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

export const getTokenTTL = (token: string): number => {
  try {
    const decoded = jwt.decode(token) as { exp?: number };
    if (decoded && decoded.exp) {
      return decoded.exp - Math.floor(Date.now() / 1000);
    }
    return 0;
  } catch (error) {
    return 0;
  }
};