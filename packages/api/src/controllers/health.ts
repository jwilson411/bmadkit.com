import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../middleware/error-handler';

export const healthCheck = async (req: Request, res: Response) => {
  try {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    logger.info('Health check requested', {
      correlationId: req.headers['x-correlation-id'],
      uptime: healthData.uptime
    });

    const response: ApiResponse = {
      success: true,
      data: healthData
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error('Health check failed', { error });
    
    const response: ApiResponse = {
      success: false,
      error: {
        message: 'Health check failed',
        code: 'HEALTH_CHECK_ERROR',
        correlationId: req.headers['x-correlation-id'] as string || 'unknown',
        timestamp: new Date().toISOString()
      }
    };

    res.status(503).json(response);
  }
};