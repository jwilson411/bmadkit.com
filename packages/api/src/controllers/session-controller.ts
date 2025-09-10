import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { sessionManager } from '../services/session-manager';
import { conversationHistory } from '../services/conversation-history';
import { sessionCleanup } from '../services/session-cleanup';
import { tokenLimiter } from '../utils/token-limiter';
import {
  CreateSessionSchema,
  UpdateSessionSchema,
  CreateMessageSchema,
  UpdateMessageSchema,
  SessionQuerySchema,
  SessionFiltersSchema,
  AgentTypeEnum,
  SessionStatusEnum,
  MessageSenderEnum
} from '../models/planning-session';

// Request validation schemas
export const SessionResumeSchema = z.object({
  sessionId: z.string().uuid(),
  resumePoint: z.enum(['current', 'last_user_message', 'agent_start']).optional(),
  validateIntegrity: z.boolean().default(true)
});

export const SessionAnalyticsRequestSchema = z.object({
  sessionId: z.string().uuid(),
  includeMessages: z.boolean().default(false),
  includeTokenUsage: z.boolean().default(true)
});

export const BulkSessionOperationSchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1).max(50),
  operation: z.enum(['pause', 'resume', 'delete', 'archive']),
  reason: z.string().optional()
});

export const MessageRevisionSchema = z.object({
  content: z.string().min(1).max(10000),
  reason: z.string().optional(),
  userResponseMetadata: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional()
});

export type SessionResumeRequest = z.infer<typeof SessionResumeSchema>;
export type SessionAnalyticsRequest = z.infer<typeof SessionAnalyticsRequestSchema>;
export type BulkSessionOperationRequest = z.infer<typeof BulkSessionOperationSchema>;
export type MessageRevisionRequest = z.infer<typeof MessageRevisionSchema>;

export class SessionController {
  /**
   * POST /api/v1/sessions
   * Create a new planning session
   */
  async createSession(req: Request, res: Response): Promise<void> {
    try {
      const validatedRequest = CreateSessionSchema.parse(req.body);
      const userId = (req as any).user?.id;

      // Add user ID from token if not provided
      if (userId && !validatedRequest.userId) {
        validatedRequest.userId = userId;
      }

      const result = await sessionManager.createSession(validatedRequest);

      logger.info('Session created via API', {
        sessionId: result.session.id,
        userId: result.session.userId,
        projectName: result.session.projectName
      });

      res.status(201).json({
        success: true,
        data: {
          session: result.session,
          agentStates: result.agentStates,
          contextWindow: {
            totalTokens: result.contextWindow.totalTokens,
            retainedMessages: result.contextWindow.retainedMessages,
            optimizationApplied: result.contextWindow.optimizationApplied
          },
          expiresAt: result.session.expiresAt,
          estimatedDuration: 2700000 // 45 minutes
        }
      });

    } catch (error) {
      logger.error('Failed to create session via API', {
        error: (error as Error).message,
        userId: (req as any).user?.id
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Invalid request data',
            details: error.errors,
            code: 'VALIDATION_ERROR'
          }
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to create session',
          code: 'CREATE_SESSION_ERROR'
        }
      });
    }
  }

  /**
   * GET /api/v1/sessions/:sessionId
   * Get session details
   */
  async getSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;
      const includeMessages = req.query.includeMessages === 'true';
      const includeAgentStates = req.query.includeAgentStates === 'true';

      const session = await sessionManager.getSession(sessionId);
      
      if (!session) {
        res.status(404).json({
          success: false,
          error: {
            message: 'Session not found',
            code: 'SESSION_NOT_FOUND'
          }
        });
        return;
      }

      // Check access permissions
      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: {
            message: 'Access denied',
            code: 'ACCESS_DENIED'
          }
        });
        return;
      }

      const responseData: any = { session };

      if (includeMessages) {
        const messages = await conversationHistory.getMessages(sessionId);
        responseData.messages = messages;
        
        // Generate context window for the messages
        const contextWindow = tokenLimiter.createContextWindow(messages);
        responseData.contextWindow = contextWindow;
      }

      if (includeAgentStates) {
        // Agent states would be retrieved here
        responseData.agentStates = [];
      }

      res.status(200).json({
        success: true,
        data: responseData
      });

    } catch (error) {
      logger.error('Failed to get session via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message,
        userId: (req as any).user?.id
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to retrieve session',
          code: 'GET_SESSION_ERROR'
        }
      });
    }
  }

  /**
   * PUT /api/v1/sessions/:sessionId
   * Update session
   */
  async updateSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;
      const updates = UpdateSessionSchema.parse(req.body);

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const result = await sessionManager.updateSession(sessionId, updates);

      logger.info('Session updated via API', {
        sessionId,
        updates: Object.keys(updates),
        userId
      });

      res.status(200).json({
        success: true,
        data: { session: result.session, updated: result.updated }
      });

    } catch (error) {
      logger.error('Failed to update session via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Invalid request data',
            details: error.errors,
            code: 'VALIDATION_ERROR'
          }
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: { message: 'Failed to update session', code: 'UPDATE_SESSION_ERROR' }
      });
    }
  }

  /**
   * POST /api/v1/sessions/:sessionId/messages
   * Add message to session
   */
  async addMessage(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;
      const messageRequest = CreateMessageSchema.parse({
        ...req.body,
        sessionId
      });

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const result = await conversationHistory.addMessage(messageRequest);

      logger.info('Message added via API', {
        sessionId,
        messageId: result.id,
        sender: result.sender,
        userId
      });

      res.status(201).json({
        success: true,
        data: {
          message: result,
          tokenUsage: {
            messageTokens: result.tokenCount,
            // Additional token usage would be calculated here
          }
        }
      });

    } catch (error) {
      logger.error('Failed to add message via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Invalid message data',
            details: error.errors,
            code: 'VALIDATION_ERROR'
          }
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: { message: 'Failed to add message', code: 'ADD_MESSAGE_ERROR' }
      });
    }
  }

  /**
   * PUT /api/v1/sessions/:sessionId/messages/:messageId
   * Revise a message
   */
  async reviseMessage(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, messageId } = req.params;
      const revisionRequest = MessageRevisionSchema.parse(req.body);

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const result = await conversationHistory.reviseMessage(
        sessionId, 
        messageId, 
        revisionRequest,
        revisionRequest.reason
      );

      logger.info('Message revised via API', {
        sessionId,
        messageId,
        revisionNumber: result.revisedMessage.revisionNumber,
        reprocessingRequired: result.impactAnalysis.reprocessingRequired,
        userId
      });

      res.status(200).json({
        success: true,
        data: {
          message: result.revisedMessage,
          revision: result.revision,
          impact: result.impactAnalysis
        }
      });

    } catch (error) {
      logger.error('Failed to revise message via API', {
        sessionId: req.params.sessionId,
        messageId: req.params.messageId,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to revise message', code: 'REVISE_MESSAGE_ERROR' }
      });
    }
  }

  /**
   * POST /api/v1/sessions/:sessionId/resume
   * Resume a paused session
   */
  async resumeSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;
      const resumeRequest = SessionResumeSchema.parse({ sessionId, ...req.body });

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      // Check if session can be resumed
      if (session.status !== 'PAUSED') {
        res.status(400).json({
          success: false,
          error: {
            message: `Cannot resume session with status: ${session.status}`,
            code: 'INVALID_SESSION_STATE'
          }
        });
        return;
      }

      // Perform integrity check if requested
      if (resumeRequest.validateIntegrity) {
        const messages = await conversationHistory.getMessages(sessionId);
        const contextWindow = tokenLimiter.createContextWindow(messages);
        
        logger.debug('Session integrity check completed', {
          sessionId,
          messageCount: messages.length,
          totalTokens: contextWindow.totalTokens,
          optimizationApplied: contextWindow.optimizationApplied
        });
      }

      const resumedSession = await sessionManager.resumeSession(sessionId);

      // Get current conversation state
      const messages = await conversationHistory.getMessages(sessionId);
      const contextWindow = tokenLimiter.createContextWindow(messages);

      logger.info('Session resumed via API', {
        sessionId,
        resumePoint: resumeRequest.resumePoint,
        messageCount: messages.length,
        userId
      });

      res.status(200).json({
        success: true,
        data: {
          session: resumedSession,
          messages: messages.slice(-10), // Return last 10 messages
          contextWindow: {
            totalTokens: contextWindow?.totalTokens || 0,
            retainedMessages: contextWindow?.retainedMessages || 0,
            summary: contextWindow?.summary
          },
          resumePoint: resumeRequest.resumePoint || 'current'
        }
      });

    } catch (error) {
      logger.error('Failed to resume session via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to resume session', code: 'RESUME_SESSION_ERROR' }
      });
    }
  }

  /**
   * POST /api/v1/sessions/:sessionId/pause
   * Pause a session
   */
  async pauseSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const pausedSession = await sessionManager.pauseSession(sessionId);

      logger.info('Session paused via API', { sessionId, userId });

      res.status(200).json({
        success: true,
        data: { session: pausedSession }
      });

    } catch (error) {
      logger.error('Failed to pause session via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to pause session', code: 'PAUSE_SESSION_ERROR' }
      });
    }
  }

  /**
   * POST /api/v1/sessions/:sessionId/complete
   * Complete a session
   */
  async completeSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const completedSession = await sessionManager.completeSession(sessionId);

      // Generate final analytics
      const analytics = await conversationHistory.getConversationAnalytics(sessionId);

      logger.info('Session completed via API', { 
        sessionId, 
        totalMessages: analytics.totalMessages,
        duration: analytics.conversationDuration,
        userId 
      });

      res.status(200).json({
        success: true,
        data: {
          session: completedSession,
          analytics: {
            totalMessages: analytics.totalMessages,
            conversationDuration: analytics.conversationDuration,
            totalRevisions: analytics.totalRevisions,
            messagesByAgent: analytics.messagesByAgent
          }
        }
      });

    } catch (error) {
      logger.error('Failed to complete session via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to complete session', code: 'COMPLETE_SESSION_ERROR' }
      });
    }
  }

  /**
   * DELETE /api/v1/sessions/:sessionId
   * Delete a session
   */
  async deleteSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      await sessionManager.deleteSession(sessionId);

      logger.info('Session deleted via API', { sessionId, userId });

      res.status(200).json({
        success: true,
        message: 'Session deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete session via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to delete session', code: 'DELETE_SESSION_ERROR' }
      });
    }
  }

  /**
   * GET /api/v1/sessions/:sessionId/analytics
   * Get session analytics
   */
  async getSessionAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.sessionId;

      // Verify session access
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({
          success: false,
          error: { message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return;
      }

      const userId = (req as any).user?.id;
      if (session.userId && session.userId !== userId && (req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Access denied', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const analytics = await conversationHistory.getConversationAnalytics(sessionId);

      res.status(200).json({
        success: true,
        data: { analytics }
      });

    } catch (error) {
      logger.error('Failed to get session analytics via API', {
        sessionId: req.params.sessionId,
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to get analytics', code: 'ANALYTICS_ERROR' }
      });
    }
  }

  /**
   * GET /api/v1/sessions/health
   * Get session system health
   */
  async getSystemHealth(req: Request, res: Response): Promise<void> {
    try {
      // Admin only
      if ((req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: { message: 'Admin access required', code: 'ACCESS_DENIED' }
        });
        return;
      }

      const [sessionHealth, queueStats, cleanupMetrics] = await Promise.all([
        sessionManager.getSessionHealth(),
        sessionCleanup.getQueueStats(),
        sessionCleanup.getMetrics()
      ]);

      res.status(200).json({
        success: true,
        data: {
          sessions: sessionHealth,
          queue: queueStats,
          cleanup: cleanupMetrics,
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Failed to get system health via API', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: { message: 'Failed to get system health', code: 'HEALTH_ERROR' }
      });
    }
  }
}

// Export singleton controller
export const sessionController = new SessionController();