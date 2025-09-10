import { logger } from '../utils/logger';
import { sessionCache } from '../utils/session-cache';
import { tokenLimiter } from '../utils/token-limiter';
import {
  ConversationMessage,
  UserResponseRevision,
  MessageSender,
  CreateMessageRequest,
  UpdateMessageRequest,
  generateMessageId,
  estimateTokenCount
} from '../models/planning-session';
import { sessionManager } from './session-manager';

export interface ConversationHistoryConfig {
  maxRevisions: number;
  enableRevisionTracking: boolean;
  enableImpactAnalysis: boolean;
  autoArchiveThreshold: number; // days
}

export interface RevisionResult {
  revisedMessage: ConversationMessage;
  revision: UserResponseRevision;
  impactAnalysis: {
    affectedMessages: string[];
    reprocessingRequired: boolean;
    estimatedTokenImpact: number;
  };
}

export interface MessageSearchOptions {
  sender?: MessageSender;
  dateRange?: { start: Date; end: Date };
  contentSearch?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationAnalytics {
  sessionId: string;
  totalMessages: number;
  messagesByAgent: Record<MessageSender, number>;
  averageMessageLength: number;
  totalRevisions: number;
  conversationDuration: number; // milliseconds
  peakActivity: { hour: number; messageCount: number };
  responsePatterns: {
    averageUserResponseTime: number;
    averageAgentResponseTime: number;
  };
}

export class ConversationHistoryError extends Error {
  constructor(
    message: string,
    public code: string,
    public sessionId?: string,
    public messageId?: string
  ) {
    super(message);
    this.name = 'ConversationHistoryError';
  }
}

export class ConversationHistory {
  private config: ConversationHistoryConfig;

  constructor(config: Partial<ConversationHistoryConfig> = {}) {
    this.config = {
      maxRevisions: 10,
      enableRevisionTracking: true,
      enableImpactAnalysis: true,
      autoArchiveThreshold: 30, // days
      ...config
    };

    logger.info('ConversationHistory service initialized', {
      maxRevisions: this.config.maxRevisions,
      enableRevisionTracking: this.config.enableRevisionTracking,
      enableImpactAnalysis: this.config.enableImpactAnalysis
    });
  }

  /**
   * Add a new message to the conversation
   */
  async addMessage(request: CreateMessageRequest): Promise<ConversationMessage> {
    try {
      const result = await sessionManager.addMessage(request);
      
      logger.info('Message added to conversation', {
        sessionId: request.sessionId,
        messageId: result.message.id,
        sender: result.message.sender,
        tokenCount: result.tokenUsage.messageTokens
      });

      return result.message;

    } catch (error) {
      logger.error('Failed to add message to conversation', {
        sessionId: request.sessionId,
        sender: request.sender,
        error: (error as Error).message
      });
      throw new ConversationHistoryError(
        `Failed to add message: ${(error as Error).message}`,
        'ADD_MESSAGE_ERROR',
        request.sessionId
      );
    }
  }

  /**
   * Revise a user message
   */
  async reviseMessage(
    sessionId: string, 
    messageId: string, 
    updates: UpdateMessageRequest,
    revisionReason?: string
  ): Promise<RevisionResult> {
    if (!this.config.enableRevisionTracking) {
      throw new ConversationHistoryError(
        'Message revision is disabled',
        'REVISION_DISABLED',
        sessionId,
        messageId
      );
    }

    try {
      // Get existing messages
      const messages = await sessionCache.getMessages(sessionId);
      const messageIndex = messages.findIndex(m => m.id === messageId);
      
      if (messageIndex === -1) {
        throw new ConversationHistoryError(
          'Message not found',
          'MESSAGE_NOT_FOUND',
          sessionId,
          messageId
        );
      }

      const originalMessage = messages[messageIndex];
      
      // Only allow user messages to be revised
      if (originalMessage.sender !== 'USER') {
        throw new ConversationHistoryError(
          'Only user messages can be revised',
          'INVALID_MESSAGE_TYPE',
          sessionId,
          messageId
        );
      }

      // Check revision limit
      if (originalMessage.revisionNumber >= this.config.maxRevisions) {
        throw new ConversationHistoryError(
          `Maximum revision limit (${this.config.maxRevisions}) reached`,
          'REVISION_LIMIT_EXCEEDED',
          sessionId,
          messageId
        );
      }

      // Validate new content
      const tokenValidation = tokenLimiter.validateMessage(updates.content);
      if (!tokenValidation.valid) {
        throw new ConversationHistoryError(
          `Revised message validation failed: ${tokenValidation.error}`,
          'MESSAGE_TOO_LONG',
          sessionId,
          messageId
        );
      }

      // Create revised message
      const revisedMessage: ConversationMessage = {
        ...originalMessage,
        content: updates.content,
        tokenCount: tokenValidation.tokenCount,
        userResponseMetadata: updates.userResponseMetadata || originalMessage.userResponseMetadata,
        isRevised: true,
        originalMessageId: originalMessage.originalMessageId || originalMessage.id,
        revisionNumber: originalMessage.revisionNumber + 1,
        updatedAt: new Date(),
        metadata: {
          ...originalMessage.metadata,
          ...updates.metadata,
          revisionHistory: [
            ...(originalMessage.metadata?.revisionHistory || []),
            {
              revisionNumber: originalMessage.revisionNumber,
              content: originalMessage.content,
              timestamp: originalMessage.updatedAt,
              reason: revisionReason
            }
          ]
        }
      };

      // Create revision record
      const revision: UserResponseRevision = {
        id: generateMessageId(),
        originalMessageId: originalMessage.originalMessageId || originalMessage.id,
        sessionId,
        content: updates.content,
        revisionNumber: revisedMessage.revisionNumber,
        revisionReason,
        impactAnalysis: undefined, // Will be set below
        affectedAgents: [],
        reprocessingRequired: false,
        createdAt: new Date(),
        metadata: {}
      };

      // Perform impact analysis
      const impactAnalysis = this.config.enableImpactAnalysis 
        ? await this.analyzeRevisionImpact(messages, messageIndex, revisedMessage)
        : {
            affectedMessages: [],
            reprocessingRequired: false,
            estimatedTokenImpact: 0
          };

      revision.impactAnalysis = impactAnalysis;
      revision.reprocessingRequired = impactAnalysis.reprocessingRequired;

      // Update messages array
      messages[messageIndex] = revisedMessage;

      // Store updated messages
      await sessionCache.setMessages(sessionId, messages);

      // Update session token count
      const session = await sessionManager.getSession(sessionId);
      if (session) {
        const tokenDifference = tokenValidation.tokenCount - originalMessage.tokenCount;
        await sessionManager.updateSession(sessionId, {
          totalTokensUsed: Math.max(0, session.totalTokensUsed + tokenDifference)
        });
      }

      logger.info('Message revised successfully', {
        sessionId,
        messageId,
        originalTokens: originalMessage.tokenCount,
        revisedTokens: tokenValidation.tokenCount,
        revisionNumber: revisedMessage.revisionNumber,
        reprocessingRequired: impactAnalysis.reprocessingRequired
      });

      return {
        revisedMessage,
        revision,
        impactAnalysis
      };

    } catch (error) {
      logger.error('Failed to revise message', {
        sessionId,
        messageId,
        error: (error as Error).message
      });
      
      if (error instanceof ConversationHistoryError) {
        throw error;
      }
      
      throw new ConversationHistoryError(
        `Failed to revise message: ${(error as Error).message}`,
        'REVISION_ERROR',
        sessionId,
        messageId
      );
    }
  }

  /**
   * Get conversation messages with optional filtering
   */
  async getMessages(sessionId: string, options?: MessageSearchOptions): Promise<ConversationMessage[]> {
    try {
      const allMessages = await sessionCache.getMessages(sessionId);
      
      if (!options) {
        return allMessages;
      }

      let filteredMessages = allMessages;

      // Filter by sender
      if (options.sender) {
        filteredMessages = filteredMessages.filter(m => m.sender === options.sender);
      }

      // Filter by date range
      if (options.dateRange) {
        filteredMessages = filteredMessages.filter(m => 
          m.createdAt >= options.dateRange!.start && m.createdAt <= options.dateRange!.end
        );
      }

      // Filter by content search
      if (options.contentSearch) {
        const searchTerm = options.contentSearch.toLowerCase();
        filteredMessages = filteredMessages.filter(m => 
          m.content.toLowerCase().includes(searchTerm)
        );
      }

      // Apply pagination
      const offset = options.offset || 0;
      const limit = options.limit || filteredMessages.length;
      
      return filteredMessages.slice(offset, offset + limit);

    } catch (error) {
      logger.error('Failed to retrieve messages', {
        sessionId,
        error: (error as Error).message
      });
      throw new ConversationHistoryError(
        `Failed to retrieve messages: ${(error as Error).message}`,
        'RETRIEVE_ERROR',
        sessionId
      );
    }
  }

  /**
   * Get message revision history
   */
  async getMessageRevisions(sessionId: string, messageId: string): Promise<{
    current: ConversationMessage;
    revisions: Array<{
      revisionNumber: number;
      content: string;
      timestamp: Date;
      reason?: string;
    }>;
  }> {
    try {
      const messages = await sessionCache.getMessages(sessionId);
      const message = messages.find(m => m.id === messageId || m.originalMessageId === messageId);
      
      if (!message) {
        throw new ConversationHistoryError(
          'Message not found',
          'MESSAGE_NOT_FOUND',
          sessionId,
          messageId
        );
      }

      const revisions = message.metadata?.revisionHistory || [];
      
      return {
        current: message,
        revisions
      };

    } catch (error) {
      logger.error('Failed to get message revisions', {
        sessionId,
        messageId,
        error: (error as Error).message
      });
      
      if (error instanceof ConversationHistoryError) {
        throw error;
      }
      
      throw new ConversationHistoryError(
        `Failed to get revisions: ${(error as Error).message}`,
        'REVISION_RETRIEVE_ERROR',
        sessionId,
        messageId
      );
    }
  }

  /**
   * Generate conversation analytics
   */
  async getConversationAnalytics(sessionId: string): Promise<ConversationAnalytics> {
    try {
      const messages = await sessionCache.getMessages(sessionId);
      
      if (messages.length === 0) {
        throw new ConversationHistoryError(
          'No messages found for analytics',
          'NO_MESSAGES',
          sessionId
        );
      }

      // Calculate basic metrics
      const totalMessages = messages.length;
      const totalRevisions = messages.filter(m => m.isRevised).length;
      
      // Message distribution by agent
      const messagesByAgent: Record<MessageSender, number> = {
        USER: 0,
        SYSTEM: 0,
        ANALYST: 0,
        PM: 0,
        UX_EXPERT: 0,
        ARCHITECT: 0
      };

      let totalMessageLength = 0;

      for (const message of messages) {
        messagesByAgent[message.sender]++;
        totalMessageLength += message.content.length;
      }

      const averageMessageLength = totalMessageLength / totalMessages;

      // Calculate conversation duration
      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      const conversationDuration = lastMessage.createdAt.getTime() - firstMessage.createdAt.getTime();

      // Analyze peak activity (by hour)
      const hourlyActivity = new Map<number, number>();
      
      for (const message of messages) {
        const hour = message.createdAt.getHours();
        hourlyActivity.set(hour, (hourlyActivity.get(hour) || 0) + 1);
      }

      const peakActivity = Array.from(hourlyActivity.entries())
        .reduce((peak, [hour, count]) => 
          count > peak.messageCount ? { hour, messageCount: count } : peak,
          { hour: 0, messageCount: 0 }
        );

      // Calculate response patterns
      const responsePatterns = this.calculateResponsePatterns(messages);

      const analytics: ConversationAnalytics = {
        sessionId,
        totalMessages,
        messagesByAgent,
        averageMessageLength,
        totalRevisions,
        conversationDuration,
        peakActivity,
        responsePatterns
      };

      logger.debug('Generated conversation analytics', {
        sessionId,
        totalMessages,
        totalRevisions,
        conversationDuration: Math.round(conversationDuration / 1000) // seconds
      });

      return analytics;

    } catch (error) {
      logger.error('Failed to generate conversation analytics', {
        sessionId,
        error: (error as Error).message
      });
      
      if (error instanceof ConversationHistoryError) {
        throw error;
      }
      
      throw new ConversationHistoryError(
        `Failed to generate analytics: ${(error as Error).message}`,
        'ANALYTICS_ERROR',
        sessionId
      );
    }
  }

  /**
   * Archive old conversations
   */
  async archiveOldConversations(olderThanDays: number = this.config.autoArchiveThreshold): Promise<{
    archived: string[];
    errors: Array<{ sessionId: string; error: string }>;
  }> {
    // This would integrate with database when implemented
    // For now, just log the operation
    logger.info('Archive operation requested', { olderThanDays });
    
    return {
      archived: [],
      errors: []
    };
  }

  // Private methods

  private async analyzeRevisionImpact(
    messages: ConversationMessage[],
    revisedMessageIndex: number,
    revisedMessage: ConversationMessage
  ): Promise<{
    affectedMessages: string[];
    reprocessingRequired: boolean;
    estimatedTokenImpact: number;
  }> {
    const affectedMessages: string[] = [];
    let reprocessingRequired = false;
    let estimatedTokenImpact = 0;

    // Find messages that come after the revised message
    const subsequentMessages = messages.slice(revisedMessageIndex + 1);
    
    // Agent responses following a user message revision typically need reprocessing
    for (const message of subsequentMessages) {
      if (message.sender !== 'USER' && message.sender !== 'SYSTEM') {
        affectedMessages.push(message.id);
        reprocessingRequired = true;
        estimatedTokenImpact += message.tokenCount || estimateTokenCount(message.content);
      }
      
      // Stop at the next user message (natural conversation boundary)
      if (message.sender === 'USER') {
        break;
      }
    }

    return {
      affectedMessages,
      reprocessingRequired,
      estimatedTokenImpact
    };
  }

  private calculateResponsePatterns(messages: ConversationMessage[]): {
    averageUserResponseTime: number;
    averageAgentResponseTime: number;
  } {
    let userResponseTimes: number[] = [];
    let agentResponseTimes: number[] = [];

    for (let i = 1; i < messages.length; i++) {
      const current = messages[i];
      const previous = messages[i - 1];
      
      const responseTime = current.createdAt.getTime() - previous.createdAt.getTime();

      if (current.sender === 'USER' && previous.sender !== 'USER') {
        userResponseTimes.push(responseTime);
      } else if (current.sender !== 'USER' && current.sender !== 'SYSTEM' && previous.sender === 'USER') {
        agentResponseTimes.push(responseTime);
      }
    }

    const averageUserResponseTime = userResponseTimes.length > 0
      ? userResponseTimes.reduce((sum, time) => sum + time, 0) / userResponseTimes.length
      : 0;

    const averageAgentResponseTime = agentResponseTimes.length > 0
      ? agentResponseTimes.reduce((sum, time) => sum + time, 0) / agentResponseTimes.length
      : 0;

    return {
      averageUserResponseTime,
      averageAgentResponseTime
    };
  }
}

// Export singleton instance
export const conversationHistory = new ConversationHistory();