import { EventEmitter } from 'events';
import { subscriptionValidator, UserSubscriptionContext } from './subscription-validator';
import { featureFlagManager, FeatureFlag, UserTier } from './feature-flag-manager';

export interface SessionMetadata {
  sessionId: string;
  userId: string;
  title: string;
  description?: string;
  category: 'planning' | 'architecture' | 'implementation' | 'analysis' | 'general';
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  duration: number; // in milliseconds
  messageCount: number;
  complexity: 'simple' | 'moderate' | 'complex';
  projectId?: string;
  collaborators?: string[];
  isArchived: boolean;
  isFavorite: boolean;
  isShared: boolean;
  sharedWith?: string[];
  accessLevel: 'private' | 'team' | 'organization' | 'public';
  version: number;
  exportCount: number;
  lastAccessedAt: Date;
}

export interface SessionMessage {
  messageId: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  messageType: 'text' | 'image' | 'file' | 'code' | 'template';
  metadata?: {
    tokens?: number;
    processingTime?: number;
    model?: string;
    temperature?: number;
    features?: string[];
  };
  attachments?: {
    type: string;
    name: string;
    size: number;
    url: string;
  }[];
  isEdited: boolean;
  editHistory?: {
    editedAt: Date;
    previousContent: string;
    reason?: string;
  }[];
}

export interface SessionSearchParams {
  userId: string;
  query?: string;
  category?: string[];
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  collaborators?: string[];
  projectId?: string;
  complexity?: string[];
  accessLevel?: string[];
  isArchived?: boolean;
  isFavorite?: boolean;
  isShared?: boolean;
  minDuration?: number;
  maxDuration?: number;
  minMessages?: number;
  maxMessages?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'duration' | 'messageCount' | 'relevance';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  includeContent?: boolean;
  includeMetadata?: boolean;
}

export interface SessionSearchResult {
  sessionId: string;
  metadata: SessionMetadata;
  relevanceScore?: number;
  matchedContent?: {
    snippet: string;
    messageId: string;
    highlightedText: string;
  }[];
  summary?: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  searchTime: number;
  aggregations?: {
    categories: { name: string; count: number }[];
    tags: { name: string; count: number }[];
    dateDistribution: { period: string; count: number }[];
    complexityDistribution: { level: string; count: number }[];
  };
  suggestions?: string[];
}

export interface SessionAnalytics {
  userId: string;
  period: '7d' | '30d' | '90d' | '1y' | 'all';
  totalSessions: number;
  totalMessages: number;
  totalDuration: number;
  averageSessionDuration: number;
  averageMessagesPerSession: number;
  categoriesBreakdown: { category: string; count: number; percentage: number }[];
  tagsCloud: { tag: string; frequency: number; trending: boolean }[];
  activityPattern: { 
    hourly: number[];
    daily: number[];
    monthly: number[];
  };
  collaborationMetrics: {
    sharedSessions: number;
    collaborators: number;
    teamSessions: number;
  };
  exportMetrics: {
    totalExports: number;
    popularFormats: { format: string; count: number }[];
    exportFrequency: number;
  };
  qualityMetrics: {
    averageComplexity: number;
    sessionCompletionRate: number;
    userSatisfactionScore?: number;
  };
}

class SessionHistoryManager extends EventEmitter {
  private readonly FREE_TIER_LIMIT = 10; // sessions
  private readonly EMAIL_CAPTURED_LIMIT = 50; // sessions
  // PREMIUM and ENTERPRISE have unlimited sessions

  constructor() {
    super();
  }

  async createSession(userId: string, sessionData: Partial<SessionMetadata>): Promise<string> {
    try {
      // Check user tier and session limits
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      await this.enforceSessionLimits(userContext);

      const sessionId = this.generateSessionId();
      const session: SessionMetadata = {
        sessionId,
        userId,
        title: sessionData.title || 'Untitled Session',
        description: sessionData.description,
        category: sessionData.category || 'general',
        tags: sessionData.tags || [],
        createdAt: new Date(),
        updatedAt: new Date(),
        duration: 0,
        messageCount: 0,
        complexity: 'simple',
        projectId: sessionData.projectId,
        collaborators: sessionData.collaborators || [],
        isArchived: false,
        isFavorite: false,
        isShared: false,
        sharedWith: [],
        accessLevel: sessionData.accessLevel || 'private',
        version: 1,
        exportCount: 0,
        lastAccessedAt: new Date()
      };

      // Save session to database (implementation would go here)
      await this.saveSessionMetadata(session);

      this.emit('sessionCreated', {
        userId,
        sessionId,
        tier: userContext.tier,
        category: session.category
      });

      return sessionId;

    } catch (error) {
      this.emit('sessionCreationError', { userId, error: error.message });
      throw error;
    }
  }

  async addMessage(sessionId: string, userId: string, messageData: Omit<SessionMessage, 'messageId' | 'sessionId' | 'timestamp'>): Promise<string> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      // Verify session access
      const session = await this.getSessionMetadata(sessionId, userId);
      if (!session) {
        throw new Error('Session not found or access denied');
      }

      const messageId = this.generateMessageId();
      const message: SessionMessage = {
        messageId,
        sessionId,
        timestamp: new Date(),
        isEdited: false,
        ...messageData
      };

      // Save message to database
      await this.saveMessage(message);

      // Update session metadata
      await this.updateSessionActivity(sessionId, {
        messageCount: session.messageCount + 1,
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
        complexity: this.calculateComplexity(session.messageCount + 1)
      });

      this.emit('messageAdded', {
        userId,
        sessionId,
        messageId,
        messageType: message.messageType,
        tier: userContext.tier
      });

      return messageId;

    } catch (error) {
      this.emit('messageError', { userId, sessionId, error: error.message });
      throw error;
    }
  }

  async searchSessions(params: SessionSearchParams): Promise<SessionSearchResponse> {
    const startTime = Date.now();

    try {
      const userContext = await subscriptionValidator.validateUserSubscription(params.userId);
      
      // Check search capabilities based on tier
      const searchCapabilities = await this.getSearchCapabilities(userContext);
      const enhancedParams = this.enhanceSearchParams(params, searchCapabilities);

      // Perform search based on user tier
      let results: SessionSearchResult[];
      
      if (userContext.features.includes(FeatureFlag.ADVANCED_SEARCH_CAPABILITIES)) {
        results = await this.performAdvancedSearch(enhancedParams, userContext);
      } else {
        results = await this.performBasicSearch(enhancedParams, userContext);
      }

      const searchTime = Date.now() - startTime;
      const totalCount = results.length;
      const totalPages = Math.ceil(totalCount / (params.limit || 20));

      // Generate aggregations for premium users
      let aggregations;
      let suggestions;
      
      if (userContext.features.includes(FeatureFlag.ADVANCED_SEARCH_CAPABILITIES)) {
        aggregations = await this.generateSearchAggregations(results, params);
        suggestions = await this.generateSearchSuggestions(params.query, userContext);
      }

      const response: SessionSearchResponse = {
        results: results.slice(((params.page || 1) - 1) * (params.limit || 20), (params.page || 1) * (params.limit || 20)),
        totalCount,
        totalPages,
        currentPage: params.page || 1,
        searchTime,
        aggregations,
        suggestions
      };

      this.emit('searchPerformed', {
        userId: params.userId,
        searchTime,
        resultCount: totalCount,
        tier: userContext.tier,
        query: params.query
      });

      return response;

    } catch (error) {
      this.emit('searchError', { userId: params.userId, error: error.message });
      throw error;
    }
  }

  async getSessionHistory(userId: string, options: {
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ sessions: SessionMetadata[]; totalCount: number }> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      // Apply tier-based restrictions
      let limit = options.limit || 20;
      let includeFullHistory = true;

      if (userContext.tier === UserTier.FREE) {
        limit = Math.min(limit, this.FREE_TIER_LIMIT);
        includeFullHistory = false;
      } else if (userContext.tier === UserTier.EMAIL_CAPTURED) {
        limit = Math.min(limit, this.EMAIL_CAPTURED_LIMIT);
        includeFullHistory = false;
      }

      const sessions = await this.fetchUserSessions(userId, {
        ...options,
        limit,
        includeFullHistory
      });

      this.emit('historyAccessed', {
        userId,
        sessionCount: sessions.sessions.length,
        tier: userContext.tier,
        includeFullHistory
      });

      return sessions;

    } catch (error) {
      this.emit('historyAccessError', { userId, error: error.message });
      throw error;
    }
  }

  async getSessionAnalytics(userId: string, period: '7d' | '30d' | '90d' | '1y' | 'all' = '30d'): Promise<SessionAnalytics> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);

      // Analytics features are premium
      if (!userContext.features.includes(FeatureFlag.UNLIMITED_SESSION_HISTORY)) {
        throw new Error('Session analytics require Premium subscription');
      }

      const analytics = await this.calculateSessionAnalytics(userId, period, userContext);

      this.emit('analyticsGenerated', {
        userId,
        period,
        tier: userContext.tier
      });

      return analytics;

    } catch (error) {
      this.emit('analyticsError', { userId, error: error.message });
      throw error;
    }
  }

  async categorizeSession(sessionId: string, userId: string, category?: string, tags?: string[]): Promise<void> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const session = await this.getSessionMetadata(sessionId, userId);
      
      if (!session) {
        throw new Error('Session not found or access denied');
      }

      // Auto-categorization for premium users
      if (userContext.features.includes(FeatureFlag.SESSION_CATEGORIZATION) && !category) {
        category = await this.autoCategorizeSessi n(sessionId, userContext);
      }

      // Auto-tagging for premium users
      if (userContext.features.includes(FeatureFlag.SESSION_CATEGORIZATION) && !tags) {
        tags = await this.autoTagSession(sessionId, userContext);
      }

      await this.updateSessionMetadata(sessionId, {
        category: category || session.category,
        tags: tags || session.tags,
        updatedAt: new Date()
      });

      this.emit('sessionCategorized', {
        userId,
        sessionId,
        category,
        tags,
        tier: userContext.tier
      });

    } catch (error) {
      this.emit('categorizationError', { userId, sessionId, error: error.message });
      throw error;
    }
  }

  async shareSession(sessionId: string, userId: string, shareWith: string[], accessLevel: 'read' | 'comment' | 'edit' = 'read'): Promise<void> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const session = await this.getSessionMetadata(sessionId, userId);
      
      if (!session) {
        throw new Error('Session not found or access denied');
      }

      // Session sharing limits based on tier
      let maxShareCount = 5;
      if (userContext.tier === UserTier.PREMIUM) {
        maxShareCount = 50;
      } else if (userContext.tier === UserTier.ENTERPRISE) {
        maxShareCount = 1000;
      }

      if (shareWith.length > maxShareCount) {
        throw new Error(`Tier ${userContext.tier} allows sharing with up to ${maxShareCount} users`);
      }

      await this.updateSessionMetadata(sessionId, {
        isShared: true,
        sharedWith: shareWith,
        accessLevel: accessLevel === 'read' ? 'team' : 'organization',
        updatedAt: new Date()
      });

      // Send share notifications
      await this.sendShareNotifications(sessionId, shareWith, accessLevel, userContext);

      this.emit('sessionShared', {
        userId,
        sessionId,
        shareWith,
        accessLevel,
        tier: userContext.tier
      });

    } catch (error) {
      this.emit('shareError', { userId, sessionId, error: error.message });
      throw error;
    }
  }

  async exportSession(sessionId: string, userId: string, format: 'json' | 'markdown' | 'pdf' | 'html' = 'json'): Promise<string> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const session = await this.getSessionMetadata(sessionId, userId);
      
      if (!session) {
        throw new Error('Session not found or access denied');
      }

      // Track export usage
      await subscriptionValidator.trackUsage(userId, 'exportsPerMonth', 1);

      const exportData = await this.generateExport(sessionId, format, userContext);
      
      // Update export count
      await this.updateSessionMetadata(sessionId, {
        exportCount: session.exportCount + 1,
        lastAccessedAt: new Date()
      });

      this.emit('sessionExported', {
        userId,
        sessionId,
        format,
        tier: userContext.tier
      });

      return exportData;

    } catch (error) {
      this.emit('exportError', { userId, sessionId, error: error.message });
      throw error;
    }
  }

  // Private helper methods

  private async enforceSessionLimits(userContext: UserSubscriptionContext): Promise<void> {
    const userSessionCount = await this.getUserSessionCount(userContext.userId);
    
    let sessionLimit: number | null = null;
    
    if (userContext.tier === UserTier.FREE) {
      sessionLimit = this.FREE_TIER_LIMIT;
    } else if (userContext.tier === UserTier.EMAIL_CAPTURED) {
      sessionLimit = this.EMAIL_CAPTURED_LIMIT;
    }
    // PREMIUM and ENTERPRISE have unlimited sessions

    if (sessionLimit && userSessionCount >= sessionLimit) {
      throw new Error(`Session limit reached. Upgrade to Premium for unlimited session history.`);
    }
  }

  private async getSearchCapabilities(userContext: UserSubscriptionContext): Promise<{
    advancedSearch: boolean;
    semanticSearch: boolean;
    crossSessionSearch: boolean;
    searchHistory: boolean;
    searchSuggestions: boolean;
    aggregations: boolean;
  }> {
    const hasAdvancedSearch = userContext.features.includes(FeatureFlag.ADVANCED_SEARCH_CAPABILITIES);
    const hasUnlimitedHistory = userContext.features.includes(FeatureFlag.UNLIMITED_SESSION_HISTORY);

    return {
      advancedSearch: hasAdvancedSearch,
      semanticSearch: hasAdvancedSearch,
      crossSessionSearch: hasUnlimitedHistory,
      searchHistory: hasAdvancedSearch,
      searchSuggestions: hasAdvancedSearch,
      aggregations: hasAdvancedSearch
    };
  }

  private enhanceSearchParams(params: SessionSearchParams, capabilities: any): SessionSearchParams {
    // Apply tier-based search enhancements
    const enhanced = { ...params };
    
    if (!capabilities.advancedSearch) {
      // Simplify search for non-premium users
      delete enhanced.complexity;
      delete enhanced.collaborators;
      delete enhanced.minDuration;
      delete enhanced.maxDuration;
      enhanced.limit = Math.min(enhanced.limit || 10, 10);
    }

    return enhanced;
  }

  private async performAdvancedSearch(params: SessionSearchParams, userContext: UserSubscriptionContext): Promise<SessionSearchResult[]> {
    // Implementation for advanced search with semantic search, full-text search, etc.
    // This would use Elasticsearch, Postgres full-text search, or similar
    
    const query = this.buildAdvancedSearchQuery(params);
    const results = await this.executeSearchQuery(query, userContext);
    
    return this.enhanceSearchResults(results, params, userContext);
  }

  private async performBasicSearch(params: SessionSearchParams, userContext: UserSubscriptionContext): Promise<SessionSearchResult[]> {
    // Implementation for basic search - simple text matching
    const query = this.buildBasicSearchQuery(params);
    const results = await this.executeSearchQuery(query, userContext);
    
    return results.map(result => ({
      sessionId: result.sessionId,
      metadata: result.metadata,
      relevanceScore: result.relevanceScore || 1
    }));
  }

  private buildAdvancedSearchQuery(params: SessionSearchParams): any {
    // Build Elasticsearch-style query for advanced search
    return {
      bool: {
        must: [
          ...(params.query ? [{
            multi_match: {
              query: params.query,
              fields: ['title^3', 'description^2', 'content', 'tags^2'],
              type: 'best_fields',
              fuzziness: 'AUTO'
            }
          }] : []),
          ...(params.category ? [{ terms: { category: params.category } }] : []),
          ...(params.tags ? [{ terms: { tags: params.tags } }] : []),
          { term: { userId: params.userId } }
        ],
        filter: [
          ...(params.dateRange ? [{
            range: {
              createdAt: {
                gte: params.dateRange.start,
                lte: params.dateRange.end
              }
            }
          }] : []),
          ...(params.isArchived !== undefined ? [{ term: { isArchived: params.isArchived } }] : [])
        ]
      }
    };
  }

  private buildBasicSearchQuery(params: SessionSearchParams): any {
    // Build simple SQL-style query for basic search
    const conditions = ['userId = ?'];
    const values = [params.userId];

    if (params.query) {
      conditions.push('(title ILIKE ? OR description ILIKE ?)');
      values.push(`%${params.query}%`, `%${params.query}%`);
    }

    if (params.category?.length) {
      conditions.push('category = ANY(?)');
      values.push(params.category);
    }

    if (params.isArchived !== undefined) {
      conditions.push('isArchived = ?');
      values.push(params.isArchived);
    }

    return {
      sql: `SELECT * FROM session_metadata WHERE ${conditions.join(' AND ')} ORDER BY updatedAt DESC`,
      values
    };
  }

  private async executeSearchQuery(query: any, userContext: UserSubscriptionContext): Promise<any[]> {
    // This would execute against your chosen search backend
    // For now, return mock results
    return [];
  }

  private async enhanceSearchResults(results: any[], params: SessionSearchParams, userContext: UserSubscriptionContext): Promise<SessionSearchResult[]> {
    return results.map(result => ({
      sessionId: result.sessionId,
      metadata: result.metadata,
      relevanceScore: result.relevanceScore,
      matchedContent: result.matchedContent,
      summary: result.summary
    }));
  }

  private async generateSearchAggregations(results: SessionSearchResult[], params: SessionSearchParams): Promise<any> {
    // Generate search facets and aggregations
    return {
      categories: [],
      tags: [],
      dateDistribution: [],
      complexityDistribution: []
    };
  }

  private async generateSearchSuggestions(query: string | undefined, userContext: UserSubscriptionContext): Promise<string[]> {
    // Generate search suggestions based on user history and popular queries
    return [];
  }

  private async autoCategorizeSessi n(sessionId: string, userContext: UserSubscriptionContext): Promise<string> {
    // Use ML/AI to automatically categorize session
    // This would analyze session content and return appropriate category
    return 'general';
  }

  private async autoTagSession(sessionId: string, userContext: UserSubscriptionContext): Promise<string[]> {
    // Use ML/AI to automatically tag session
    // This would analyze session content and return relevant tags
    return [];
  }

  private async calculateSessionAnalytics(userId: string, period: string, userContext: UserSubscriptionContext): Promise<SessionAnalytics> {
    // Calculate comprehensive session analytics
    return {
      userId,
      period: period as any,
      totalSessions: 0,
      totalMessages: 0,
      totalDuration: 0,
      averageSessionDuration: 0,
      averageMessagesPerSession: 0,
      categoriesBreakdown: [],
      tagsCloud: [],
      activityPattern: { hourly: [], daily: [], monthly: [] },
      collaborationMetrics: { sharedSessions: 0, collaborators: 0, teamSessions: 0 },
      exportMetrics: { totalExports: 0, popularFormats: [], exportFrequency: 0 },
      qualityMetrics: { averageComplexity: 0, sessionCompletionRate: 0 }
    };
  }

  private calculateComplexity(messageCount: number): 'simple' | 'moderate' | 'complex' {
    if (messageCount < 10) return 'simple';
    if (messageCount < 50) return 'moderate';
    return 'complex';
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Database operations (would be implemented with your chosen database)
  private async saveSessionMetadata(session: SessionMetadata): Promise<void> {
    // Save to database
  }

  private async saveMessage(message: SessionMessage): Promise<void> {
    // Save to database
  }

  private async getSessionMetadata(sessionId: string, userId: string): Promise<SessionMetadata | null> {
    // Fetch from database
    return null;
  }

  private async updateSessionMetadata(sessionId: string, updates: Partial<SessionMetadata>): Promise<void> {
    // Update in database
  }

  private async updateSessionActivity(sessionId: string, updates: Partial<SessionMetadata>): Promise<void> {
    // Update session activity metrics
  }

  private async getUserSessionCount(userId: string): Promise<number> {
    // Count user sessions from database
    return 0;
  }

  private async fetchUserSessions(userId: string, options: any): Promise<{ sessions: SessionMetadata[]; totalCount: number }> {
    // Fetch from database
    return { sessions: [], totalCount: 0 };
  }

  private async sendShareNotifications(sessionId: string, shareWith: string[], accessLevel: string, userContext: UserSubscriptionContext): Promise<void> {
    // Send share notifications
  }

  private async generateExport(sessionId: string, format: string, userContext: UserSubscriptionContext): Promise<string> {
    // Generate export in requested format
    return 'export_data';
  }
}

export const sessionHistoryManager = new SessionHistoryManager();