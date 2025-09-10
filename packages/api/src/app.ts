import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import passport from './config/passport';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error-handler';
import { healthCheck } from './controllers/health';
import authRoutes from './routes/auth';
import promptRoutes from './routes/prompts';
import llmGatewayRoutes from './routes/llm-gateway';
import sessionRoutes from './routes/sessions';

export const createApp = () => {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      }
    }
  }));

  // CORS configuration
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id']
  }));

  // Rate limiting
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: {
        message: 'Too many requests from this IP',
        code: 'RATE_LIMIT_EXCEEDED',
        correlationId: 'unknown',
        timestamp: new Date().toISOString()
      }
    }
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Passport middleware
  app.use(passport.initialize());

  // Correlation ID middleware
  app.use((req, _res, next) => {
    req.headers['x-correlation-id'] = req.headers['x-correlation-id'] || uuidv4();
    next();
  });

  // Request logging middleware
  app.use((req, _res, next) => {
    logger.info('Incoming request', {
      method: req.method,
      url: req.url,
      correlationId: req.headers['x-correlation-id'],
      userAgent: req.headers['user-agent']
    });
    next();
  });

  // Health check endpoint
  app.get('/health', healthCheck);
  app.get('/api/health', healthCheck);

  // API routes
  app.get('/api/v1/status', (req, res) => {
    res.json({
      success: true,
      data: {
        message: 'BMAD API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }
    });
  });

  // Authentication routes
  app.use('/api/v1/auth', authRoutes);
  
  // Prompt management routes
  app.use('/api/v1/prompts', promptRoutes);
  
  // LLM Gateway routes
  app.use('/api/v1/llm', llmGatewayRoutes);
  
  // Session management routes
  app.use('/api/v1/sessions', sessionRoutes);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: {
        message: 'Endpoint not found',
        code: 'NOT_FOUND',
        correlationId: req.headers['x-correlation-id'],
        timestamp: new Date().toISOString()
      }
    });
  });

  // Error handling middleware
  app.use(errorHandler);

  return app;
};