import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationChain } from 'express-validator';
import { z } from 'zod';
import { logger } from '../utils/logger';

export const handleValidationErrors = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('Validation failed', {
      errors: errors.array(),
      correlationId: req.headers['x-correlation-id'],
      path: req.path
    });

    res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        correlationId: req.headers['x-correlation-id'],
        timestamp: new Date().toISOString(),
        details: errors.array().map(error => ({
          field: error.type === 'field' ? error.path : undefined,
          message: error.msg,
          value: error.type === 'field' ? error.value : undefined
        }))
      }
    });
    return;
  }

  next();
};

export const validateUUID = (field: string) => {
  return param(field).isUUID().withMessage(`${field} must be a valid UUID`);
};

export const validateEmail = (field: string = 'email') => {
  return body(field)
    .isEmail()
    .withMessage('Must be a valid email address')
    .normalizeEmail();
};

export const validatePassword = (field: string = 'password') => {
  return body(field)
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character');
};

export const validateProjectInput = () => {
  return body('projectInput')
    .isString()
    .withMessage('Project input must be a string')
    .isLength({ min: 10, max: 5000 })
    .withMessage('Project input must be between 10 and 5000 characters')
    .trim();
};

export const validateSessionId = () => {
  return validateUUID('sessionId');
};

export const validatePagination = () => {
  return [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt()
  ];
};

export const sanitizeHtml = (field: string) => {
  return body(field)
    .customSanitizer((value) => {
      if (typeof value !== 'string') return value;
      
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    });
};

export const validateContentType = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentType = req.headers['content-type'];
    
    if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
      logger.warn('Invalid content type', {
        contentType,
        allowedTypes,
        correlationId: req.headers['x-correlation-id']
      });

      res.status(415).json({
        success: false,
        error: {
          message: 'Unsupported content type',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          correlationId: req.headers['x-correlation-id'],
          timestamp: new Date().toISOString(),
          details: {
            received: contentType,
            allowed: allowedTypes
          }
        }
      });
      return;
    }

    next();
  };
};

export const validateRequestSize = (maxSizeBytes: number = 1024 * 1024) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      logger.warn('Request too large', {
        contentLength,
        maxSizeBytes,
        correlationId: req.headers['x-correlation-id']
      });

      res.status(413).json({
        success: false,
        error: {
          message: 'Request entity too large',
          code: 'PAYLOAD_TOO_LARGE',
          correlationId: req.headers['x-correlation-id'],
          timestamp: new Date().toISOString(),
          details: {
            maxSizeBytes,
            receivedBytes: parseInt(contentLength)
          }
        }
      });
      return;
    }

    next();
  };
};

export const validateRequest = <T>(schema: z.ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('Request validation failed', {
          errors: error.errors,
          correlationId: req.headers['x-correlation-id'],
          path: req.path
        });

        res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            correlationId: req.headers['x-correlation-id'],
            timestamp: new Date().toISOString(),
            details: error.errors
          }
        });
        return;
      }

      next(error);
    }
  };
};