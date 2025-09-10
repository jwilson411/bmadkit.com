import { Router } from 'express';
import { llmGatewayController } from '../controllers/llm-gateway.ts';
import { authenticateToken } from '../middleware/auth.ts';
import { validateContentType } from '../middleware/validation.ts';
import { createGlobalLLMRateLimiter, createLLMRateLimiter } from '../middleware/rate-limiter.ts';
import { logger } from '../utils/logger.ts';

const router = Router();

// Apply authentication and content type validation to all routes
router.use(authenticateToken);
router.use(validateContentType(['application/json']));

// Apply global rate limiting for LLM requests
router.use(createGlobalLLMRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 120, // Total 120 requests per minute across all providers
  maxTokens: 200000, // Total 200k tokens per minute
  message: 'Global LLM rate limit exceeded - please reduce request frequency'
}));

// Request logging middleware
router.use((req: any, res, next) => {
  req.llmRequestId = `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('LLM Gateway API request', {
    requestId: req.llmRequestId,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  next();
});

/**
 * @route   POST /api/v1/llm/chat/completions
 * @desc    Send chat completion request to LLM providers with automatic failover
 * @access  Private
 * @rateLimit Provider-specific rate limiting applied
 */
router.post('/chat/completions',
  // Apply provider-specific rate limiting
  createLLMRateLimiter('openai', {
    windowMs: 60000,
    maxRequests: 60,
    maxTokens: 100000,
    keyGenerator: (req) => {
      const provider = req.body?.provider || 'openai';
      const userId = (req as any).user?.id || 'anonymous';
      return `${provider}:${userId}`;
    }
  }),
  async (req, res) => {
    try {
      await llmGatewayController.completions(req, res);
    } catch (error) {
      logger.error('LLM completion endpoint error', {
        requestId: (req as any).llmRequestId,
        error: (error as Error).message,
        userId: (req as any).user?.id
      });

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: {
            message: 'Internal server error during LLM completion',
            requestId: (req as any).llmRequestId,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }
);

/**
 * @route   GET /api/v1/llm/health
 * @desc    Get health status of LLM providers
 * @access  Private
 * @query   provider? - Specific provider to check (openai|anthropic)
 */
router.get('/health', async (req, res) => {
  try {
    await llmGatewayController.health(req, res);
  } catch (error) {
    logger.error('LLM health endpoint error', {
      requestId: (req as any).llmRequestId,
      error: (error as Error).message
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Health check failed',
          requestId: (req as any).llmRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/llm/metrics
 * @desc    Get usage metrics and performance data
 * @access  Private
 * @query   provider? - Specific provider (openai|anthropic)
 * @query   period? - Time period (hour|day|week)
 * @query   startTime? - ISO datetime string
 */
router.get('/metrics', async (req, res) => {
  try {
    await llmGatewayController.metrics(req, res);
  } catch (error) {
    logger.error('LLM metrics endpoint error', {
      requestId: (req as any).llmRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to retrieve metrics',
          requestId: (req as any).llmRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/llm/logs
 * @desc    Retrieve request/response logs (Admin only)
 * @access  Private (Admin)
 * @query   provider? - Specific provider (openai|anthropic)
 * @query   startTime - ISO datetime string
 * @query   endTime - ISO datetime string
 * @query   correlationId? - Search by correlation ID
 * @query   format? - Response format (json|csv)
 */
router.get('/logs', async (req, res) => {
  try {
    await llmGatewayController.logs(req, res);
  } catch (error) {
    logger.error('LLM logs endpoint error', {
      requestId: (req as any).llmRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to retrieve logs',
          requestId: (req as any).llmRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

/**
 * @route   POST /api/v1/llm/cache/clear
 * @desc    Clear response cache (Admin only)
 * @access  Private (Admin)
 */
router.post('/cache/clear', async (req, res) => {
  try {
    await llmGatewayController.clearCache(req, res);
  } catch (error) {
    logger.error('LLM cache clear endpoint error', {
      requestId: (req as any).llmRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to clear cache',
          requestId: (req as any).llmRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/llm/models
 * @desc    List available models for each provider
 * @access  Private
 */
router.get('/models', async (req, res) => {
  try {
    await llmGatewayController.models(req, res);
  } catch (error) {
    logger.error('LLM models endpoint error', {
      requestId: (req as any).llmRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to list models',
          requestId: (req as any).llmRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/llm/status
 * @desc    Get overall LLM Gateway status (public endpoint for monitoring)
 * @access  Public
 */
router.get('/status', (req, res) => {
  try {
    // Simple status endpoint that doesn't require full gateway initialization
    res.status(200).json({
      success: true,
      data: {
        status: 'operational',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        providers: {
          openai: {
            enabled: !!process.env.OPENAI_API_KEY,
            configured: !!process.env.OPENAI_API_KEY
          },
          anthropic: {
            enabled: !!process.env.ANTHROPIC_API_KEY,
            configured: !!process.env.ANTHROPIC_API_KEY
          }
        }
      }
    });
  } catch (error) {
    logger.error('LLM status endpoint error', {
      error: (error as Error).message
    });

    res.status(500).json({
      success: false,
      error: {
        message: 'Status check failed',
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * @route   POST /api/v1/llm/test
 * @desc    Test connection to LLM providers (Admin only)
 * @access  Private (Admin)
 */
router.post('/test', async (req, res) => {
  // Admin only
  if ((req as any).user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Admin access required to test providers',
        code: 'FORBIDDEN'
      }
    });
  }

  try {
    // Simple test message
    const testMessages = [{
      role: 'user' as const,
      content: 'Hello, this is a test message. Please respond with "Test successful".'
    }];

    await llmGatewayController.completions({
      ...req,
      body: {
        messages: testMessages,
        maxTokens: 50,
        temperature: 0
      }
    }, res);

  } catch (error) {
    logger.error('LLM test endpoint error', {
      requestId: (req as any).llmRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Provider test failed',
          details: (error as Error).message,
          requestId: (req as any).llmRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

// Global error handler for LLM Gateway routes
router.use((error: Error, req: any, res: any, next: any) => {
  logger.error('Unhandled error in LLM Gateway routes', {
    requestId: req.llmRequestId,
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  });

  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error in LLM Gateway',
        requestId: req.llmRequestId,
        timestamp: new Date().toISOString()
      }
    });
  }
});

export default router;