import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface ApiResponse {
  success: boolean;
  data?: any;
  error?: {
    message: string;
    code: string;
    correlationId: string;
    timestamp: string;
    details?: any;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const correlationId = req.headers['x-correlation-id'] as string || 'unknown';
  
  logger.error('API Error', {
    error: error.message,
    stack: error.stack,
    correlationId,
    url: req.url,
    method: req.method
  });

  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';

  const response: ApiResponse = {
    success: false,
    error: {
      message: error.message,
      code,
      correlationId,
      timestamp: new Date().toISOString()
    }
  };

  res.status(statusCode).json(response);
};