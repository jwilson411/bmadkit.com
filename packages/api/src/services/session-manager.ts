import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { sessionCache, SessionCacheError } from '../utils/session-cache';
import { tokenLimiter, ContextWindow } from '../utils/token-limiter';
import {
  PlanningSession,
  ConversationMessage,
  AgentState,
  SessionAnalytics,
  UserResponseRevision,
  SessionConfig,
  SessionStatus,
  AgentType,
  MessageSender,
  CreateSessionRequest,
  UpdateSessionRequest,
  CreateMessageRequest,
  UpdateMessageRequest,
  SessionQueryRequest,
  PlanningSessionSchema,
  ConversationMessageSchema,
  AgentStateSchema,
  generateSessionId,
  generateMessageId,
  calculateSessionExpiration,
  isSessionExpired,
  isSessionActive,
  calculateSessionProgress,
  estimateTokenCount,
  createDefaultSessionConfig,
  getNextAgent,
  getPreviousAgent,
  validateSessionData
} from '../models/planning-session';

export interface SessionManagerConfig {
  defaultSessionConfig: SessionConfig;
  enableDualStorage: boolean;
  enableAnalytics: boolean;
  enableRevisions: boolean;
  autoSaveInterval: number; // milliseconds
  lockTimeout: number; // milliseconds
}

export interface SessionCreateResult {
  session: PlanningSession;
  agentStates: AgentState[];
  contextWindow: ContextWindow;
}

export interface SessionUpdateResult {
  session: PlanningSession;
  updated: boolean;
  conflicts?: string[];
}

export interface MessageResult {
  message: ConversationMessage;
  contextWindow: ContextWindow;
  tokenUsage: {
    messageTokens: number;
    totalTokens: number;
    remainingTokens: number;
  };
}

export class SessionManagerError extends Error {
  constructor(
    message: string,
    public code: string,
    public sessionId?: string,
    public operation?: string
  ) {
    super(message);
    this.name = 'SessionManagerError';
  }
}

export class SessionManager {
  private config: SessionManagerConfig;
  private activeSessions = new Map<string, { lastAccess: Date; locks: Set<string> }>();
  private autoSaveTimers = new Map<string, NodeJS.Timeout>();

  constructor(config: Partial<SessionManagerConfig> = {}) {
    this.config = {
      defaultSessionConfig: createDefaultSessionConfig(),
      enableDualStorage: true,
      enableAnalytics: true,
      enableRevisions: true,
      autoSaveInterval: 30000, // 30 seconds
      lockTimeout: 300000, // 5 minutes
      ...config
    };

    logger.info('SessionManager initialized', {
      enableDualStorage: this.config.enableDualStorage,
      enableAnalytics: this.config.enableAnalytics,
      autoSaveInterval: this.config.autoSaveInterval
    });

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Create a new planning session
   */
  async createSession(request: CreateSessionRequest, config?: Partial<SessionConfig>): Promise<SessionCreateResult> {
    const sessionId = generateSessionId();
    const sessionConfig = { ...this.config.defaultSessionConfig, ...config };
    
    logger.info('Creating new session', {
      sessionId,
      userId: request.userId,
      projectName: request.projectName
    });

    try {
      // Create session object
      const now = new Date();
      const session: PlanningSession = {
        id: sessionId,
        userId: request.userId,
        projectInput: request.projectInput,
        projectName: request.projectName,
        sessionData: {},
        status: 'ACTIVE',
        currentAgent: 'ANALYST', // Start with analyst
        progressPercentage: 0,
        conversationSummary: undefined,
        totalMessages: 0,
        totalTokensUsed: 0,
        estimatedCost: 0,
        startedAt: now,
        lastActiveAt: now,
        pausedAt: undefined,
        completedAt: undefined,
        expiresAt: calculateSessionExpiration(sessionConfig),
        createdAt: now,
        updatedAt: now,
        metadata: request.metadata || {}
      };

      // Validate session data
      const validation = validateSessionData(session);
      if (!validation.valid) {
        throw new SessionManagerError(
          `Session validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR',
          sessionId,
          'createSession'
        );
      }

      // Initialize agent states
      const agentStates: AgentState[] = [
        {
          sessionId,
          agentType: 'ANALYST',
          state: {},
          isActive: true,
          startedAt: now,
          completedAt: undefined,
          progressPercentage: 0,
          context: { projectInput: request.projectInput },
          outputs: [],
          metadata: {},
          createdAt: now,
          updatedAt: now
        }
      ];

      // Create initial system message
      const initialMessage: ConversationMessage = {
        id: generateMessageId(),
        sessionId,
        sender: 'SYSTEM',
        content: `Planning session started for project: ${request.projectName || 'Untitled Project'}`,
        sequenceNumber: 0,
        tokenCount: estimateTokenCount(`Planning session started for project: ${request.projectName || 'Untitled Project'}`),
        cost: 0,
        agentContext: undefined,
        userResponseMetadata: undefined,
        isRevised: false,
        originalMessageId: undefined,
        revisionNumber: 1,
        createdAt: now,
        updatedAt: now,
        metadata: {}
      };

      // Create context window
      const contextWindow = tokenLimiter.createContextWindow([initialMessage]);

      // Store in cache
      await sessionCache.setSession(sessionId, session);
      await sessionCache.setMessages(sessionId, [initialMessage]);
      await sessionCache.setAgentStates(sessionId, agentStates);

      // Track active session
      this.trackActiveSession(sessionId);

      // Start auto-save timer
      this.startAutoSave(sessionId);

      logger.info('Session created successfully', {
        sessionId,
        userId: request.userId,
        expiresAt: session.expiresAt,
        initialTokens: contextWindow.totalTokens
      });

      return {
        session,
        agentStates,
        contextWindow
      };

    } catch (error) {
      logger.error('Failed to create session', {
        sessionId,
        error: (error as Error).message,
        stack: (error as Error).stack
      });

      throw new SessionManagerError(
        `Failed to create session: ${(error as Error).message}`,
        'CREATE_ERROR',
        sessionId,
        'createSession'
      );
    }
  }

  /**
   * Get session by ID with caching
   */
  async getSession(sessionId: string): Promise<PlanningSession | null> {
    try {
      logger.debug('Retrieving session', { sessionId });

      // Try cache first
      let session = await sessionCache.getSession(sessionId);
      
      if (session) {
        this.trackActiveSession(sessionId);
        
        // Check if session is expired
        if (isSessionExpired(session)) {
          logger.warn('Session expired', { 
            sessionId, 
            expiresAt: session.expiresAt 
          });
          
          await this.expireSession(sessionId);
          return null;
        }
        
        return session;
      }

      // TODO: Fallback to database when implemented
      logger.debug('Session not found', { sessionId });
      return null;

    } catch (error) {
      logger.error('Failed to retrieve session', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionManagerError(
        `Failed to retrieve session: ${(error as Error).message}`,
        'RETRIEVE_ERROR',
        sessionId,
        'getSession'
      );
    }
  }

  /**
   * Update session data
   */
  async updateSession(sessionId: string, updates: UpdateSessionRequest): Promise<SessionUpdateResult> {
    const lockValue = await this.acquireSessionLock(sessionId, 'update');
    
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new SessionManagerError('Session not found', 'NOT_FOUND', sessionId, 'updateSession');
      }

      // Apply updates
      const updatedSession: PlanningSession = {
        ...session,
        ...updates,
        updatedAt: new Date(),
        lastActiveAt: new Date()
      };

      // Validate updated session
      const validation = validateSessionData(updatedSession);
      if (!validation.valid) {
        throw new SessionManagerError(
          `Session validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR',
          sessionId,
          'updateSession'
        );
      }

      // Store updated session
      await sessionCache.setSession(sessionId, updatedSession);

      logger.info('Session updated successfully', {
        sessionId,
        updates: Object.keys(updates),
        status: updatedSession.status
      });

      return {
        session: updatedSession,
        updated: true
      };

    } catch (error) {
      logger.error('Failed to update session', {
        sessionId,
        error: (error as Error).message
      });
      throw error;
    } finally {
      if (lockValue) {
        await this.releaseSessionLock(sessionId, lockValue, 'update');
      }
    }
  }

  /**
   * Add message to session
   */
  async addMessage(request: CreateMessageRequest): Promise<MessageResult> {
    const lockValue = await this.acquireSessionLock(request.sessionId, 'addMessage');
    
    try {
      const session = await this.getSession(request.sessionId);
      if (!session) {
        throw new SessionManagerError('Session not found', 'NOT_FOUND', request.sessionId, 'addMessage');
      }

      if (!isSessionActive(session)) {
        throw new SessionManagerError(
          `Cannot add message to ${session.status} session`,
          'INVALID_STATE',
          request.sessionId,
          'addMessage'
        );
      }

      // Validate message content
      const validation = tokenLimiter.validateMessage(request.content);
      if (!validation.valid) {
        throw new SessionManagerError(
          `Message validation failed: ${validation.error}`,
          'MESSAGE_TOO_LONG',
          request.sessionId,
          'addMessage'
        );
      }

      // Get existing messages
      const existingMessages = await sessionCache.getMessages(request.sessionId);
      const nextSequenceNumber = existingMessages.length;

      // Create new message
      const message: ConversationMessage = {
        id: generateMessageId(),
        sessionId: request.sessionId,
        sender: request.sender,
        content: request.content,
        sequenceNumber: nextSequenceNumber,
        tokenCount: validation.tokenCount,
        cost: 0, // Will be updated when processed by LLM
        agentContext: request.agentContext,
        userResponseMetadata: request.userResponseMetadata,
        isRevised: false,
        originalMessageId: undefined,
        revisionNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: request.metadata || {}
      };

      // Add to messages array
      const allMessages = [...existingMessages, message];

      // Create optimized context window
      const contextWindow = tokenLimiter.createContextWindow(allMessages);

      // Update session stats
      const updatedSession: PlanningSession = {
        ...session,
        totalMessages: allMessages.length,
        totalTokensUsed: session.totalTokensUsed + validation.tokenCount,
        lastActiveAt: new Date(),
        updatedAt: new Date()
      };

      // Store updates
      await sessionCache.setSession(request.sessionId, updatedSession);
      await sessionCache.setMessages(request.sessionId, allMessages);

      logger.info('Message added to session', {
        sessionId: request.sessionId,
        messageId: message.id,
        sender: message.sender,
        tokenCount: validation.tokenCount,
        sequenceNumber: nextSequenceNumber
      });

      return {
        message,
        contextWindow,
        tokenUsage: {
          messageTokens: validation.tokenCount,
          totalTokens: contextWindow.totalTokens,
          remainingTokens: Math.max(0, tokenLimiter['config'].maxContextTokens - contextWindow.totalTokens)
        }
      };

    } catch (error) {
      logger.error('Failed to add message', {
        sessionId: request.sessionId,
        sender: request.sender,
        error: (error as Error).message
      });
      throw error;
    } finally {
      if (lockValue) {
        await this.releaseSessionLock(request.sessionId, lockValue, 'addMessage');
      }
    }
  }

  /**
   * Get conversation messages with context optimization
   */
  async getMessages(sessionId: string, includeContext: boolean = true): Promise<{
    messages: ConversationMessage[];
    contextWindow?: ContextWindow;
  }> {
    try {
      const messages = await sessionCache.getMessages(sessionId);
      
      if (!includeContext) {
        return { messages };
      }

      const contextWindow = tokenLimiter.createContextWindow(messages);
      
      return { messages, contextWindow };

    } catch (error) {
      logger.error('Failed to retrieve messages', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionManagerError(
        `Failed to retrieve messages: ${(error as Error).message}`,
        'RETRIEVE_ERROR',
        sessionId,
        'getMessages'
      );
    }
  }

  /**
   * Update agent state
   */
  async updateAgentState(sessionId: string, agentType: AgentType, updates: Partial<AgentState>): Promise<AgentState> {
    const lockValue = await this.acquireSessionLock(sessionId, 'updateAgent');
    
    try {
      const agentStates = await sessionCache.getAgentStates(sessionId);
      const existingStateIndex = agentStates.findIndex(state => state.agentType === agentType);
      
      let updatedState: AgentState;
      
      if (existingStateIndex >= 0) {
        // Update existing state
        updatedState = {
          ...agentStates[existingStateIndex],
          ...updates,
          updatedAt: new Date()
        };
        agentStates[existingStateIndex] = updatedState;
      } else {
        // Create new state
        updatedState = {
          sessionId,
          agentType,
          state: {},
          isActive: false,
          startedAt: undefined,
          completedAt: undefined,
          progressPercentage: 0,
          context: {},
          outputs: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          ...updates
        };
        agentStates.push(updatedState);
      }

      // Update session progress
      const session = await this.getSession(sessionId);
      if (session) {
        const newProgress = calculateSessionProgress(session.currentAgent || null, agentStates);
        await this.updateSession(sessionId, { progressPercentage: newProgress });
      }

      await sessionCache.setAgentStates(sessionId, agentStates);

      logger.info('Agent state updated', {
        sessionId,
        agentType,
        isActive: updatedState.isActive,
        progressPercentage: updatedState.progressPercentage
      });

      return updatedState;

    } catch (error) {
      logger.error('Failed to update agent state', {
        sessionId,
        agentType,
        error: (error as Error).message
      });
      throw error;
    } finally {
      if (lockValue) {
        await this.releaseSessionLock(sessionId, lockValue, 'updateAgent');
      }
    }
  }

  /**
   * Transition to next agent
   */
  async transitionToNextAgent(sessionId: string): Promise<{
    session: PlanningSession;
    previousAgent: AgentType | null;
    newAgent: AgentType | null;
    completed: boolean;
  }> {
    const lockValue = await this.acquireSessionLock(sessionId, 'transition');
    
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new SessionManagerError('Session not found', 'NOT_FOUND', sessionId, 'transitionAgent');
      }

      const currentAgent = session.currentAgent;
      const nextAgent = currentAgent ? getNextAgent(currentAgent) : null;

      if (!nextAgent) {
        // Session completed
        const completedSession = await this.updateSession(sessionId, {
          status: 'COMPLETED',
          completedAt: new Date(),
          progressPercentage: 100
        });

        logger.info('Session completed - no more agents', { sessionId });

        return {
          session: completedSession.session,
          previousAgent: currentAgent || null,
          newAgent: null,
          completed: true
        };
      }

      // Complete current agent
      if (currentAgent) {
        await this.updateAgentState(sessionId, currentAgent, {
          isActive: false,
          completedAt: new Date(),
          progressPercentage: 100
        });
      }

      // Start next agent
      await this.updateAgentState(sessionId, nextAgent, {
        isActive: true,
        startedAt: new Date(),
        progressPercentage: 0
      });

      const updatedSession = await this.updateSession(sessionId, {
        currentAgent: nextAgent
      });

      logger.info('Agent transition completed', {
        sessionId,
        from: currentAgent,
        to: nextAgent
      });

      return {
        session: updatedSession.session,
        previousAgent: currentAgent || null,
        newAgent: nextAgent,
        completed: false
      };

    } catch (error) {
      logger.error('Failed to transition agent', {
        sessionId,
        error: (error as Error).message
      });
      throw error;
    } finally {
      if (lockValue) {
        await this.releaseSessionLock(sessionId, lockValue, 'transition');
      }
    }
  }

  /**
   * Pause session
   */
  async pauseSession(sessionId: string): Promise<PlanningSession> {
    const result = await this.updateSession(sessionId, {
      status: 'PAUSED',
      pausedAt: new Date()
    });

    this.stopAutoSave(sessionId);

    logger.info('Session paused', { sessionId });
    return result.session;
  }

  /**
   * Resume session
   */
  async resumeSession(sessionId: string): Promise<PlanningSession> {
    const result = await this.updateSession(sessionId, {
      status: 'ACTIVE',
      pausedAt: undefined
    });

    this.startAutoSave(sessionId);

    logger.info('Session resumed', { sessionId });
    return result.session;
  }

  /**
   * Complete session
   */
  async completeSession(sessionId: string): Promise<PlanningSession> {
    const result = await this.updateSession(sessionId, {
      status: 'COMPLETED',
      completedAt: new Date(),
      progressPercentage: 100
    });

    this.stopAutoSave(sessionId);

    logger.info('Session completed', { sessionId });
    return result.session;
  }

  /**
   * Delete session and cleanup
   */
  async deleteSession(sessionId: string): Promise<void> {
    const lockValue = await this.acquireSessionLock(sessionId, 'delete');
    
    try {
      await sessionCache.deleteSession(sessionId);
      this.stopAutoSave(sessionId);
      this.untrackActiveSession(sessionId);

      logger.info('Session deleted', { sessionId });

    } catch (error) {
      logger.error('Failed to delete session', {
        sessionId,
        error: (error as Error).message
      });
      throw error;
    } finally {
      if (lockValue) {
        await this.releaseSessionLock(sessionId, lockValue, 'delete');
      }
    }
  }

  /**
   * Get session health status
   */
  async getSessionHealth(): Promise<{
    activeSessions: number;
    cacheStats: any;
    memoryUsage: NodeJS.MemoryUsage;
  }> {
    const cacheStats = await sessionCache.getStats();
    const memoryUsage = process.memoryUsage();

    return {
      activeSessions: this.activeSessions.size,
      cacheStats,
      memoryUsage
    };
  }

  // Private methods

  private async acquireSessionLock(sessionId: string, operation: string): Promise<string | null> {
    try {
      const lockValue = await sessionCache.acquireLock(sessionId, operation);
      if (!lockValue) {
        throw new SessionManagerError(
          `Session is locked by another operation`,
          'SESSION_LOCKED',
          sessionId,
          operation
        );
      }
      return lockValue;
    } catch (error) {
      if (error instanceof SessionCacheError || error instanceof SessionManagerError) {
        throw error;
      }
      throw new SessionManagerError(
        `Failed to acquire session lock: ${(error as Error).message}`,
        'LOCK_ERROR',
        sessionId,
        operation
      );
    }
  }

  private async releaseSessionLock(sessionId: string, lockValue: string, operation: string): Promise<void> {
    try {
      await sessionCache.releaseLock(sessionId, lockValue, operation);
    } catch (error) {
      logger.warn('Failed to release session lock', {
        sessionId,
        operation,
        error: (error as Error).message
      });
    }
  }

  private trackActiveSession(sessionId: string): void {
    this.activeSessions.set(sessionId, {
      lastAccess: new Date(),
      locks: new Set()
    });
  }

  private untrackActiveSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  private startAutoSave(sessionId: string): void {
    this.stopAutoSave(sessionId); // Clear any existing timer

    const timer = setInterval(async () => {
      try {
        const session = await this.getSession(sessionId);
        if (session && isSessionActive(session)) {
          // Auto-save logic would go here (sync to database)
          logger.debug('Auto-save triggered', { sessionId });
        } else {
          this.stopAutoSave(sessionId);
        }
      } catch (error) {
        logger.error('Auto-save failed', {
          sessionId,
          error: (error as Error).message
        });
      }
    }, this.config.autoSaveInterval);

    this.autoSaveTimers.set(sessionId, timer);
  }

  private stopAutoSave(sessionId: string): void {
    const timer = this.autoSaveTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.autoSaveTimers.delete(sessionId);
    }
  }

  private async expireSession(sessionId: string): Promise<void> {
    try {
      await this.updateSession(sessionId, {
        status: 'EXPIRED'
      });
      
      this.stopAutoSave(sessionId);
      this.untrackActiveSession(sessionId);

      logger.info('Session expired', { sessionId });
    } catch (error) {
      logger.error('Failed to expire session', {
        sessionId,
        error: (error as Error).message
      });
    }
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      this.performCleanup().catch(error => {
        logger.error('Cleanup failed', { error: error.message });
      });
    }, 60000); // Every minute
  }

  private async performCleanup(): Promise<void> {
    const now = Date.now();
    
    // Clean up inactive sessions
    for (const [sessionId, info] of Array.from(this.activeSessions.entries())) {
      const inactiveTime = now - info.lastAccess.getTime();
      
      if (inactiveTime > this.config.lockTimeout) {
        logger.debug('Cleaning up inactive session', { 
          sessionId, 
          inactiveTime: Math.round(inactiveTime / 1000) 
        });
        
        this.untrackActiveSession(sessionId);
      }
    }
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();