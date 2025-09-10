import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { setCache, getCache, deleteCache } from '../utils/redis';
import { logger } from '../utils/logger';

export interface SessionData {
  sessionId: string;
  userId?: string;
  planningSessionId?: string;
  createdAt: number;
  lastAccessedAt: number;
  data?: any;
}

const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const SESSION_COOKIE_NAME = 'bmad-session';

export const sessionMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    let sessionId = req.headers['x-session-id'] as string || req.cookies?.[SESSION_COOKIE_NAME];
    let sessionData: SessionData | null = null;

    if (sessionId) {
      const cachedSession = await getCache(`session:${sessionId}`);
      if (cachedSession) {
        sessionData = JSON.parse(cachedSession);
        sessionData!.lastAccessedAt = Date.now();
      }
    }

    if (!sessionData) {
      sessionId = uuidv4();
      sessionData = {
        sessionId,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
    }

    await setCache(`session:${sessionId}`, JSON.stringify(sessionData), SESSION_TTL);

    res.setHeader('X-Session-Id', sessionId);
    if (req.headers.cookie === undefined) {
      res.cookie(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: SESSION_TTL * 1000,
      });
    }

    (req as any).session = sessionData;

    logger.debug('Session middleware processed', {
      sessionId,
      correlationId: req.headers['x-correlation-id'],
      isNewSession: !req.headers['x-session-id'] && !req.cookies?.[SESSION_COOKIE_NAME]
    });

    next();
  } catch (error) {
    logger.error('Session middleware error', { error });
    next(error);
  }
};

export const updateSession = async (sessionId: string, updates: Partial<SessionData>): Promise<void> => {
  try {
    const cachedSession = await getCache(`session:${sessionId}`);
    if (cachedSession) {
      const sessionData: SessionData = JSON.parse(cachedSession);
      const updatedSession = {
        ...sessionData,
        ...updates,
        lastAccessedAt: Date.now(),
      };
      await setCache(`session:${sessionId}`, JSON.stringify(updatedSession), SESSION_TTL);
    }
  } catch (error) {
    logger.error('Failed to update session', { error, sessionId });
    throw new Error('Session update failed');
  }
};

export const destroySession = async (sessionId: string): Promise<void> => {
  try {
    await deleteCache(`session:${sessionId}`);
    logger.info('Session destroyed successfully', { sessionId });
  } catch (error) {
    logger.error('Failed to destroy session', { error, sessionId });
    throw new Error('Session destroy failed');
  }
};