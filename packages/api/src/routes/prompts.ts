import { Router } from 'express';
import { PromptTestingController } from '../controllers/prompt-testing.ts';
import { authenticateToken } from '../middleware/auth.ts';
import { validateContentType } from '../middleware/validation.ts';
import { errorRecovery } from '../services/error-recovery.ts';
import { logger } from '../utils/logger.ts';

const router = Router();
const promptTestingController = new PromptTestingController();

// Apply authentication and content type validation to all routes
router.use(authenticateToken);
router.use(validateContentType(['application/json']));

// Error handling middleware for prompt routes
router.use(async (req: any, res: any, next: any) => {
  req.errorRecovery = errorRecovery;
  req.requestId = `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('Prompt API request', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    userAgent: req.get('User-Agent')
  });
  
  next();
});

/**
 * @route   POST /api/v1/prompts/test
 * @desc    Test agent prompt with execution context
 * @access  Private
 */
router.post('/test', async (req, res) => {
  try {
    await promptTestingController.testPrompt(req, res);
  } catch (error) {
    logger.error('Prompt test failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    // Attempt error recovery
    const recoveryResult = await errorRecovery.recoverFromError(error as Error, {
      operation: 'prompt-test',
      requestId: req.requestId,
      userId: req.user?.id,
      metadata: { body: req.body }
    });

    if (recoveryResult.success) {
      logger.info('Error recovery successful for prompt test', {
        requestId: req.requestId,
        strategy: recoveryResult.strategy
      });
      
      res.status(200).json({
        success: true,
        data: recoveryResult.result,
        recovered: true,
        strategy: recoveryResult.strategy,
        warnings: recoveryResult.warnings
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Prompt testing failed',
        message: (error as Error).message,
        requestId: req.requestId
      });
    }
  }
});

/**
 * @route   POST /api/v1/prompts/validate
 * @desc    Validate prompt structure and content
 * @access  Private
 */
router.post('/validate', async (req, res) => {
  try {
    await promptTestingController.validatePrompt(req, res);
  } catch (error) {
    logger.error('Prompt validation failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    const recoveryResult = await errorRecovery.recoverFromError(error as Error, {
      operation: 'prompt-validation',
      requestId: req.requestId,
      userId: req.user?.id,
      metadata: { body: req.body }
    });

    if (recoveryResult.success) {
      res.status(200).json({
        success: true,
        data: recoveryResult.result,
        recovered: true,
        strategy: recoveryResult.strategy,
        warnings: recoveryResult.warnings
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Prompt validation failed',
        message: (error as Error).message,
        requestId: req.requestId
      });
    }
  }
});

/**
 * @route   POST /api/v1/prompts/compare
 * @desc    Compare different prompt versions
 * @access  Private
 */
router.post('/compare', async (req, res) => {
  try {
    await promptTestingController.comparePrompts(req, res);
  } catch (error) {
    logger.error('Prompt comparison failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Prompt comparison failed',
      message: (error as Error).message,
      requestId: req.requestId
    });
  }
});

/**
 * @route   GET /api/v1/prompts/list
 * @desc    List all available prompts
 * @access  Private
 */
router.get('/list', async (req, res) => {
  try {
    await promptTestingController.listPrompts(req, res);
  } catch (error) {
    logger.error('Prompt listing failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    const recoveryResult = await errorRecovery.recoverFromError(error as Error, {
      operation: 'prompt-listing',
      requestId: req.requestId,
      userId: req.user?.id
    });

    if (recoveryResult.success) {
      res.status(200).json({
        success: true,
        data: recoveryResult.result,
        recovered: true,
        strategy: recoveryResult.strategy
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to list prompts',
        message: (error as Error).message,
        requestId: req.requestId
      });
    }
  }
});

/**
 * @route   GET /api/v1/prompts/metrics
 * @desc    Get system metrics and health status
 * @access  Private
 */
router.get('/metrics', async (req, res) => {
  try {
    await promptTestingController.getMetrics(req, res);
  } catch (error) {
    logger.error('Metrics retrieval failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    // For metrics, we can provide degraded service with basic health status
    try {
      const healthStatus = errorRecovery.getHealthStatus();
      res.status(200).json({
        success: true,
        data: {
          system: healthStatus,
          prompts: null,
          loader: null,
          template: null,
          version: null
        },
        degraded: true,
        message: 'Partial metrics available',
        requestId: req.requestId
      });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: 'Metrics unavailable',
        message: (error as Error).message,
        requestId: req.requestId
      });
    }
  }
});

/**
 * @route   POST /api/v1/prompts/clear-cache
 * @desc    Clear caches for development
 * @access  Private (Admin only in production)
 */
router.post('/clear-cache', async (req, res) => {
  // In production, only allow admins to clear cache
  if (process.env.NODE_ENV === 'production' && req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Admin access required to clear caches in production'
    });
  }

  try {
    await promptTestingController.clearCache(req, res);
  } catch (error) {
    logger.error('Cache clear failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Cache clear failed',
      message: (error as Error).message,
      requestId: req.requestId
    });
  }
});

/**
 * @route   GET /api/v1/prompts/health
 * @desc    Get system health status (public endpoint for monitoring)
 * @access  Public
 */
router.get('/health', (req, res) => {
  try {
    const healthStatus = errorRecovery.getHealthStatus();
    
    res.status(healthStatus.overall === 'DOWN' ? 503 : 200).json({
      success: true,
      data: healthStatus,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Health check failed', {
      error: (error as Error).message
    });

    res.status(503).json({
      success: false,
      error: 'Health check failed',
      overall: 'DOWN',
      timestamp: new Date()
    });
  }
});

/**
 * @route   POST /api/v1/prompts/circuit-breaker/reset
 * @desc    Reset circuit breaker for specific operation
 * @access  Private (Admin only)
 */
router.post('/circuit-breaker/reset', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Admin access required to reset circuit breakers'
    });
  }

  try {
    const { operation } = req.body;
    
    if (!operation || typeof operation !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid operation parameter'
      });
    }

    errorRecovery.resetCircuitBreaker(operation);
    
    logger.info('Circuit breaker reset by admin', {
      operation,
      userId: req.user.id,
      requestId: req.requestId
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker reset for operation: ${operation}`,
      requestId: req.requestId
    });
  } catch (error) {
    logger.error('Circuit breaker reset failed', {
      requestId: req.requestId,
      error: (error as Error).message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Failed to reset circuit breaker',
      message: (error as Error).message,
      requestId: req.requestId
    });
  }
});

// Global error handler for prompt routes
router.use((error: Error, req: any, res: any, next: any) => {
  logger.error('Unhandled error in prompt routes', {
    requestId: req.requestId,
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
    requestId: req.requestId
  });
});

export default router;