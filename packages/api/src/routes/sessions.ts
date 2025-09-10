import { Router } from 'express';
import { sessionController } from '../controllers/session-controller';
import { authenticateToken } from '../middleware/auth';
import { validateContentType } from '../middleware/validation';
import { logger } from '../utils/logger';

const router = Router();

// Apply authentication and content type validation to all routes
router.use(authenticateToken);
router.use(validateContentType(['application/json']));

// Request logging middleware
router.use((req: any, res, next) => {
  req.sessionRequestId = `session_req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('Session API request', {
    requestId: req.sessionRequestId,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    sessionId: req.params.sessionId,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  next();
});

/**
 * @route   POST /api/v1/sessions
 * @desc    Create a new planning session
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    await sessionController.createSession(req, res);
  } catch (error) {
    logger.error('Session creation endpoint error', {
      requestId: (req as any).sessionRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Internal server error during session creation',
          requestId: (req as any).sessionRequestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/sessions/:sessionId
 * @desc    Get session details
 * @access  Private (Owner or Admin)
 * @query   includeMessages? - Include conversation messages
 * @query   includeAgentStates? - Include agent states
 */
router.get('/:sessionId', async (req, res) => {
  try {
    await sessionController.getSession(req, res);
  } catch (error) {
    logger.error('Get session endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to retrieve session',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   PUT /api/v1/sessions/:sessionId
 * @desc    Update session details
 * @access  Private (Owner or Admin)
 */
router.put('/:sessionId', async (req, res) => {
  try {
    await sessionController.updateSession(req, res);
  } catch (error) {
    logger.error('Update session endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to update session',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   DELETE /api/v1/sessions/:sessionId
 * @desc    Delete a session
 * @access  Private (Owner or Admin)
 */
router.delete('/:sessionId', async (req, res) => {
  try {
    await sessionController.deleteSession(req, res);
  } catch (error) {
    logger.error('Delete session endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to delete session',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   POST /api/v1/sessions/:sessionId/messages
 * @desc    Add message to session
 * @access  Private (Owner or Admin)
 */
router.post('/:sessionId/messages', async (req, res) => {
  try {
    await sessionController.addMessage(req, res);
  } catch (error) {
    logger.error('Add message endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to add message',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   PUT /api/v1/sessions/:sessionId/messages/:messageId
 * @desc    Revise a message
 * @access  Private (Owner or Admin)
 */
router.put('/:sessionId/messages/:messageId', async (req, res) => {
  try {
    await sessionController.reviseMessage(req, res);
  } catch (error) {
    logger.error('Revise message endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      messageId: req.params.messageId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to revise message',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   POST /api/v1/sessions/:sessionId/pause
 * @desc    Pause a session
 * @access  Private (Owner or Admin)
 */
router.post('/:sessionId/pause', async (req, res) => {
  try {
    await sessionController.pauseSession(req, res);
  } catch (error) {
    logger.error('Pause session endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to pause session',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   POST /api/v1/sessions/:sessionId/resume
 * @desc    Resume a paused session
 * @access  Private (Owner or Admin)
 */
router.post('/:sessionId/resume', async (req, res) => {
  try {
    await sessionController.resumeSession(req, res);
  } catch (error) {
    logger.error('Resume session endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to resume session',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   POST /api/v1/sessions/:sessionId/complete
 * @desc    Complete a session
 * @access  Private (Owner or Admin)
 */
router.post('/:sessionId/complete', async (req, res) => {
  try {
    await sessionController.completeSession(req, res);
  } catch (error) {
    logger.error('Complete session endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to complete session',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/sessions/:sessionId/analytics
 * @desc    Get session analytics
 * @access  Private (Owner or Admin)
 */
router.get('/:sessionId/analytics', async (req, res) => {
  try {
    await sessionController.getSessionAnalytics(req, res);
  } catch (error) {
    logger.error('Session analytics endpoint error', {
      requestId: (req as any).sessionRequestId,
      sessionId: req.params.sessionId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to get session analytics',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/sessions/health
 * @desc    Get session system health (Admin only)
 * @access  Private (Admin)
 */
router.get('/health', async (req, res) => {
  try {
    await sessionController.getSystemHealth(req, res);
  } catch (error) {
    logger.error('Session health endpoint error', {
      requestId: (req as any).sessionRequestId,
      error: (error as Error).message,
      userId: (req as any).user?.id
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to get system health',
          requestId: (req as any).sessionRequestId
        }
      });
    }
  }
});

/**
 * @route   GET /api/v1/sessions/status
 * @desc    Get session management system status (public monitoring endpoint)
 * @access  Public
 */
router.get('/status', (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        status: 'operational',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        features: {
          sessionManagement: true,
          conversationHistory: true,
          messageRevisions: true,
          sessionResumption: true,
          tokenLimiting: true,
          backgroundCleanup: true,
          dualStorage: true
        }
      }
    });
  } catch (error) {
    logger.error('Session status endpoint error', {
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

// Global error handler for session routes
router.use((error: Error, req: any, res: any, next: any) => {
  logger.error('Unhandled error in session routes', {
    requestId: req.sessionRequestId,
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    sessionId: req.params?.sessionId
  });

  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error in session management',
        requestId: req.sessionRequestId,
        timestamp: new Date().toISOString()
      }
    });
  }
});

export default router;