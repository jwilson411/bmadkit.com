import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { SocketData } from '../types/events';

interface JWTPayload {
  userId: string;
  email: string;
  subscriptionTier: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

let publicKey: string | undefined;

const getPublicKey = () => {
  const config = getConfig();
  
  if (!publicKey) {
    try {
      // Try to load RS256 public key first
      const keyPath = process.env.JWT_PRIVATE_KEY_PATH || path.join(process.cwd(), '..', 'api', 'keys');
      
      if (fs.existsSync(path.join(keyPath, 'public.pem'))) {
        publicKey = fs.readFileSync(path.join(keyPath, 'public.pem'), 'utf8');
        logger.info('Using RS256 public key for Socket.IO JWT verification');
      } else {
        // Fallback to HS256 with secret
        if (!config.JWT_SECRET) {
          throw new Error('JWT_SECRET is required when RS256 keys are not available');
        }
        publicKey = config.JWT_SECRET;
        logger.info('Using HS256 secret for Socket.IO JWT verification');
      }
    } catch (error) {
      logger.error('Failed to load JWT public key for Socket.IO', { error });
      throw new Error('JWT key configuration failed for Socket.IO');
    }
  }
  
  return publicKey;
};

export const verifyJWT = async (token: string): Promise<JWTPayload> => {
  const key = getPublicKey();
  
  try {
    const algorithm = key.includes('BEGIN') ? 'RS256' : 'HS256';
    
    const decoded = jwt.verify(token, key, {
      issuer: 'bmad-api',
      audience: 'bmad-client',
      algorithms: [algorithm],
    }) as JWTPayload;

    return decoded;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('Socket.IO JWT verification failed', { error: errorMessage });
    throw new Error('Invalid or expired token');
  }
};

export const authenticateSocket = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      logger.warn('Socket connection attempted without token', {
        socketId: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      });
      return next(new Error('Authentication token required'));
    }

    // Verify JWT token
    const decoded = await verifyJWT(token as string);
    
    // Attach user data to socket
    const socketData: SocketData = {
      userId: decoded.userId,
      sessionId: decoded.sessionId,
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      clientInfo: {
        userAgent: socket.handshake.headers['user-agent'] || 'unknown',
        ip: socket.handshake.address,
        version: socket.handshake.query.version as string,
      },
    };

    (socket as any).userData = socketData;

    logger.info('Socket authenticated successfully', {
      socketId: socket.id,
      userId: decoded.userId,
      sessionId: decoded.sessionId,
      ip: socket.handshake.address
    });

    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
    logger.warn('Socket authentication failed', {
      error: errorMessage,
      socketId: socket.id,
      ip: socket.handshake.address
    });
    next(new Error('Authentication failed'));
  }
};

export const requireSessionAccess = (socket: Socket, sessionId: string): boolean => {
  const socketData = (socket as any).userData as SocketData;
  
  if (!socketData) {
    logger.warn('Socket missing user data for session access check', {
      socketId: socket.id,
      sessionId
    });
    return false;
  }

  // Check if user has access to this session
  // For now, we'll allow access if they have a valid token
  // In a full implementation, you'd check database permissions
  
  logger.debug('Session access granted', {
    socketId: socket.id,
    userId: socketData.userId,
    sessionId
  });
  
  return true;
};

export const updateSocketActivity = (socket: Socket): void => {
  const socketData = (socket as any).userData as SocketData;
  if (socketData) {
    socketData.lastActivity = new Date().toISOString();
  }
};