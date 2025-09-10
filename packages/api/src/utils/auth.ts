import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getConfig } from './config';
import { logger } from './logger';

export interface JWTPayload {
  userId: string;
  email: string;
  subscriptionTier: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

const JWT_EXPIRES_IN = '24h';
const BCRYPT_ROUNDS = 12;

export const generateToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  const config = getConfig();
  
  if (!config.JWT_SECRET) {
    throw new Error('JWT_SECRET is required for token generation');
  }

  try {
    const token = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'bmad-api',
      audience: 'bmad-client',
    });

    logger.debug('JWT token generated successfully', {
      userId: payload.userId,
      expiresIn: JWT_EXPIRES_IN
    });

    return token;
  } catch (error) {
    logger.error('Failed to generate JWT token', { error });
    throw new Error('Token generation failed');
  }
};

export const verifyToken = (token: string): JWTPayload => {
  const config = getConfig();
  
  if (!config.JWT_SECRET) {
    throw new Error('JWT_SECRET is required for token verification');
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      issuer: 'bmad-api',
      audience: 'bmad-client',
    }) as JWTPayload;

    logger.debug('JWT token verified successfully', {
      userId: decoded.userId
    });

    return decoded;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('JWT token verification failed', { error: errorMessage });
    throw new Error('Invalid token');
  }
};

export const hashPassword = async (password: string): Promise<string> => {
  try {
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    logger.debug('Password hashed successfully');
    
    return hashedPassword;
  } catch (error) {
    logger.error('Failed to hash password', { error });
    throw new Error('Password hashing failed');
  }
};

export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  try {
    const isValid = await bcrypt.compare(password, hashedPassword);
    
    logger.debug('Password verification completed', { isValid });
    
    return isValid;
  } catch (error) {
    logger.error('Failed to verify password', { error });
    throw new Error('Password verification failed');
  }
};

export const generateSecureToken = (length: number = 32): string => {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
};