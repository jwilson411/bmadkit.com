import { logger } from './logger';
import { 
  ConversationMessage, 
  AgentType, 
  MessageSender,
  estimateTokenCount 
} from '../models/planning-session';

export interface TokenLimiterConfig {
  maxContextTokens: number; // Maximum tokens for context window
  maxMessageTokens: number; // Maximum tokens per message
  reservedTokens: number; // Reserved tokens for system prompts
  summarizationThreshold: number; // Token count to trigger summarization
  compressionRatio: number; // Target compression ratio for summarization
  retainRecentMessages: number; // Always retain N recent messages
  retainSystemMessages: boolean; // Always retain system messages
  prioritizeUserMessages: boolean; // Give priority to user messages
  enableSummarization: boolean; // Enable automatic summarization
  enableContextOptimization: boolean; // Enable context optimization
}

export interface ContextWindow {
  messages: ConversationMessage[];
  totalTokens: number;
  summarizedTokens: number;
  retainedMessages: number;
  summary?: string;
  optimizationApplied: boolean;
}

export interface TokenStats {
  totalMessages: number;
  totalTokens: number;
  averageTokensPerMessage: number;
  largestMessage: number;
  userMessages: number;
  agentMessages: number;
  systemMessages: number;
  distribution: Record<MessageSender, number>;
}

export interface SummarizationOptions {
  preserveUserInputs: boolean;
  preserveAgentOutputs: boolean;
  preserveTransitions: boolean;
  maxSummaryTokens: number;
  summaryStyle: 'bullet' | 'narrative' | 'structured';
}

export class TokenLimiterError extends Error {
  constructor(
    message: string,
    public operation: string,
    public tokenCount?: number,
    public limit?: number
  ) {
    super(message);
    this.name = 'TokenLimiterError';
  }
}

export class TokenLimiter {
  private config: TokenLimiterConfig;

  constructor(config: Partial<TokenLimiterConfig> = {}) {
    this.config = {
      maxContextTokens: 8000, // Conservative limit for most models
      maxMessageTokens: 2000,
      reservedTokens: 1000, // For system prompts and instructions
      summarizationThreshold: 6000,
      compressionRatio: 0.3, // Compress to 30% of original
      retainRecentMessages: 10,
      retainSystemMessages: true,
      prioritizeUserMessages: true,
      enableSummarization: true,
      enableContextOptimization: true,
      ...config
    };

    logger.debug('TokenLimiter initialized', {
      maxContextTokens: this.config.maxContextTokens,
      summarizationThreshold: this.config.summarizationThreshold,
      retainRecentMessages: this.config.retainRecentMessages
    });
  }

  /**
   * Create optimized context window from conversation messages
   */
  createContextWindow(messages: ConversationMessage[]): ContextWindow {
    logger.debug('Creating context window', {
      inputMessages: messages.length,
      maxTokens: this.config.maxContextTokens
    });

    // Sort messages by sequence number
    const sortedMessages = [...messages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Calculate current token usage
    const totalTokens = this.calculateTotalTokens(sortedMessages);
    
    if (totalTokens <= this.config.maxContextTokens - this.config.reservedTokens) {
      // No optimization needed
      return {
        messages: sortedMessages,
        totalTokens,
        summarizedTokens: 0,
        retainedMessages: sortedMessages.length,
        optimizationApplied: false
      };
    }

    // Optimization needed
    const optimizedContext = this.optimizeContext(sortedMessages, totalTokens);
    
    logger.info('Context window optimized', {
      originalMessages: messages.length,
      originalTokens: totalTokens,
      optimizedMessages: optimizedContext.messages.length,
      optimizedTokens: optimizedContext.totalTokens,
      summarizationApplied: !!optimizedContext.summary
    });

    return optimizedContext;
  }

  /**
   * Validate message token count
   */
  validateMessage(content: string): { valid: boolean; tokenCount: number; error?: string } {
    const tokenCount = estimateTokenCount(content);
    
    if (tokenCount > this.config.maxMessageTokens) {
      return {
        valid: false,
        tokenCount,
        error: `Message exceeds maximum token limit of ${this.config.maxMessageTokens} tokens`
      };
    }

    return { valid: true, tokenCount };
  }

  /**
   * Get token statistics for messages
   */
  getTokenStats(messages: ConversationMessage[]): TokenStats {
    const stats: TokenStats = {
      totalMessages: messages.length,
      totalTokens: 0,
      averageTokensPerMessage: 0,
      largestMessage: 0,
      userMessages: 0,
      agentMessages: 0,
      systemMessages: 0,
      distribution: {
        USER: 0,
        SYSTEM: 0,
        ANALYST: 0,
        PM: 0,
        UX_EXPERT: 0,
        ARCHITECT: 0
      }
    };

    for (const message of messages) {
      const tokenCount = message.tokenCount || estimateTokenCount(message.content);
      stats.totalTokens += tokenCount;
      stats.largestMessage = Math.max(stats.largestMessage, tokenCount);
      
      if (message.sender === 'USER') {
        stats.userMessages++;
      } else if (message.sender === 'SYSTEM') {
        stats.systemMessages++;
      } else {
        stats.agentMessages++;
      }
      
      stats.distribution[message.sender]++;
    }

    stats.averageTokensPerMessage = stats.totalMessages > 0 
      ? stats.totalTokens / stats.totalMessages 
      : 0;

    return stats;
  }

  /**
   * Estimate tokens needed for agent response
   */
  estimateResponseTokens(agentType: AgentType, context: ConversationMessage[]): number {
    // Base estimation based on agent type and conversation context
    const baseEstimates = {
      ANALYST: 300,
      PM: 250,
      UX_EXPERT: 350,
      ARCHITECT: 400
    };

    const baseEstimate = baseEstimates[agentType];
    const contextComplexity = Math.min(context.length * 10, 200);
    
    return baseEstimate + contextComplexity;
  }

  /**
   * Check if context has room for estimated response
   */
  canAccommodateResponse(
    contextWindow: ContextWindow, 
    agentType: AgentType
  ): { canAccommodate: boolean; availableTokens: number; estimatedResponse: number } {
    const estimatedResponse = this.estimateResponseTokens(agentType, contextWindow.messages);
    const availableTokens = this.config.maxContextTokens - this.config.reservedTokens - contextWindow.totalTokens;
    
    return {
      canAccommodate: availableTokens >= estimatedResponse,
      availableTokens,
      estimatedResponse
    };
  }

  /**
   * Create conversation summary
   */
  async createSummary(
    messages: ConversationMessage[], 
    options: Partial<SummarizationOptions> = {}
  ): Promise<string> {
    const opts: SummarizationOptions = {
      preserveUserInputs: true,
      preserveAgentOutputs: false,
      preserveTransitions: true,
      maxSummaryTokens: Math.floor(this.config.maxContextTokens * this.config.compressionRatio),
      summaryStyle: 'structured',
      ...options
    };

    const summary = this.generateStructuredSummary(messages, opts);
    
    logger.debug('Created conversation summary', {
      originalMessages: messages.length,
      summaryLength: summary.length,
      estimatedTokens: estimateTokenCount(summary)
    });

    return summary;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TokenLimiterConfig>): void {
    this.config = { ...this.config, ...config };
    
    logger.info('TokenLimiter configuration updated', {
      maxContextTokens: this.config.maxContextTokens,
      summarizationThreshold: this.config.summarizationThreshold
    });
  }

  // Private methods

  private calculateTotalTokens(messages: ConversationMessage[]): number {
    return messages.reduce((total, message) => {
      return total + (message.tokenCount || estimateTokenCount(message.content));
    }, 0);
  }

  private optimizeContext(messages: ConversationMessage[], currentTokens: number): ContextWindow {
    if (!this.config.enableContextOptimization) {
      throw new TokenLimiterError(
        'Context exceeds token limit and optimization is disabled',
        'optimizeContext',
        currentTokens,
        this.config.maxContextTokens
      );
    }

    const targetTokens = this.config.maxContextTokens - this.config.reservedTokens;
    
    if (currentTokens <= this.config.summarizationThreshold || !this.config.enableSummarization) {
      // Use simple truncation
      return this.truncateContext(messages, targetTokens);
    }

    // Use summarization
    return this.summarizeContext(messages, targetTokens);
  }

  private truncateContext(messages: ConversationMessage[], targetTokens: number): ContextWindow {
    const recentMessages = messages.slice(-this.config.retainRecentMessages);
    let retainedMessages: ConversationMessage[] = [];
    let currentTokens = 0;

    // Always retain system messages if configured
    if (this.config.retainSystemMessages) {
      const systemMessages = messages.filter(m => m.sender === 'SYSTEM');
      for (const msg of systemMessages) {
        const msgTokens = msg.tokenCount || estimateTokenCount(msg.content);
        if (currentTokens + msgTokens <= targetTokens) {
          retainedMessages.push(msg);
          currentTokens += msgTokens;
        }
      }
    }

    // Prioritize recent messages
    for (const message of recentMessages.reverse()) {
      if (retainedMessages.find(m => m.id === message.id)) continue;
      
      const msgTokens = message.tokenCount || estimateTokenCount(message.content);
      if (currentTokens + msgTokens <= targetTokens) {
        retainedMessages.unshift(message);
        currentTokens += msgTokens;
      }
    }

    // Fill remaining space with older messages (prioritize user messages if configured)
    const remainingMessages = messages.filter(m => !retainedMessages.find(r => r.id === m.id));
    
    if (this.config.prioritizeUserMessages) {
      remainingMessages.sort((a, b) => {
        if (a.sender === 'USER' && b.sender !== 'USER') return -1;
        if (a.sender !== 'USER' && b.sender === 'USER') return 1;
        return b.sequenceNumber - a.sequenceNumber;
      });
    }

    for (const message of remainingMessages) {
      const msgTokens = message.tokenCount || estimateTokenCount(message.content);
      if (currentTokens + msgTokens <= targetTokens) {
        retainedMessages.push(message);
        currentTokens += msgTokens;
      }
    }

    // Sort by sequence number
    retainedMessages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    return {
      messages: retainedMessages,
      totalTokens: currentTokens,
      summarizedTokens: 0,
      retainedMessages: retainedMessages.length,
      optimizationApplied: true
    };
  }

  private summarizeContext(messages: ConversationMessage[], targetTokens: number): ContextWindow {
    const recentMessages = messages.slice(-this.config.retainRecentMessages);
    const recentTokens = this.calculateTotalTokens(recentMessages);
    
    if (recentTokens >= targetTokens) {
      // Even recent messages exceed limit, fall back to truncation
      return this.truncateContext(messages, targetTokens);
    }

    const messagesToSummarize = messages.slice(0, -this.config.retainRecentMessages);
    
    if (messagesToSummarize.length === 0) {
      return this.truncateContext(messages, targetTokens);
    }

    const summary = this.generateStructuredSummary(messagesToSummarize);
    const summaryTokens = estimateTokenCount(summary);
    
    if (summaryTokens + recentTokens > targetTokens) {
      logger.warn('Summary still exceeds token limit, falling back to truncation');
      return this.truncateContext(messages, targetTokens);
    }

    return {
      messages: recentMessages,
      totalTokens: summaryTokens + recentTokens,
      summarizedTokens: summaryTokens,
      retainedMessages: recentMessages.length,
      summary,
      optimizationApplied: true
    };
  }

  private generateStructuredSummary(
    messages: ConversationMessage[], 
    options?: SummarizationOptions
  ): string {
    const opts = options || {
      preserveUserInputs: true,
      preserveAgentOutputs: false,
      preserveTransitions: true,
      maxSummaryTokens: Math.floor(this.config.maxContextTokens * this.config.compressionRatio),
      summaryStyle: 'structured'
    };

    const sections = {
      userInputs: [] as string[],
      agentOutputs: [] as string[],
      agentTransitions: [] as string[],
      keyDecisions: [] as string[]
    };

    let currentAgent: AgentType | null = null;

    for (const message of messages) {
      const content = message.content.trim();
      
      if (message.sender === 'USER' && opts.preserveUserInputs) {
        sections.userInputs.push(`• ${this.truncateText(content, 100)}`);
      } else if (message.sender !== 'USER' && message.sender !== 'SYSTEM') {
        const agentType = message.sender as AgentType;
        
        if (currentAgent !== agentType && opts.preserveTransitions) {
          sections.agentTransitions.push(`→ Transitioned to ${agentType}`);
          currentAgent = agentType;
        }
        
        if (opts.preserveAgentOutputs) {
          sections.agentOutputs.push(`${agentType}: ${this.truncateText(content, 150)}`);
        }
      }
    }

    // Build summary
    const summaryParts = [];
    
    if (sections.userInputs.length > 0) {
      summaryParts.push(`**User Inputs:**\n${sections.userInputs.join('\n')}`);
    }
    
    if (sections.agentTransitions.length > 0) {
      summaryParts.push(`**Agent Flow:**\n${sections.agentTransitions.join('\n')}`);
    }
    
    if (sections.agentOutputs.length > 0) {
      summaryParts.push(`**Key Agent Outputs:**\n${sections.agentOutputs.slice(-5).join('\n')}`);
    }

    const fullSummary = `**Conversation Summary (${messages.length} messages)**\n\n${summaryParts.join('\n\n')}`;
    
    // Truncate if still too long
    const maxSummaryLength = opts.maxSummaryTokens * 4; // Rough character estimate
    if (fullSummary.length > maxSummaryLength) {
      return fullSummary.substring(0, maxSummaryLength) + '...\n\n*[Summary truncated]*';
    }
    
    return fullSummary;
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}

// Export configured instances
export const tokenLimiter = new TokenLimiter();

// Export factory function for custom configurations
export function createTokenLimiter(config: Partial<TokenLimiterConfig>): TokenLimiter {
  return new TokenLimiter(config);
}