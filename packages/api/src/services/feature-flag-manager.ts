import { z } from 'zod';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { config } from 'dotenv';

config();

// Feature flag types and configurations
export enum FeatureFlag {
  // Planning features
  ADVANCED_PLANNING_SESSIONS = 'advanced_planning_sessions',
  EXTENDED_SESSION_DURATION = 'extended_session_duration',
  DETAILED_QUESTIONING = 'detailed_questioning',
  
  // Processing features
  PRIORITY_PROCESSING = 'priority_processing',
  DEDICATED_INFRASTRUCTURE = 'dedicated_infrastructure',
  FASTER_LLM_RESPONSES = 'faster_llm_responses',
  
  // Template features
  TECHNICAL_ARCHITECTURE_TEMPLATES = 'technical_architecture_templates',
  IMPLEMENTATION_ROADMAP_TEMPLATES = 'implementation_roadmap_templates',
  PREMIUM_TEMPLATE_LIBRARY = 'premium_template_library',
  
  // History and search
  UNLIMITED_SESSION_HISTORY = 'unlimited_session_history',
  ADVANCED_SEARCH_CAPABILITIES = 'advanced_search_capabilities',
  SESSION_CATEGORIZATION = 'session_categorization',
  
  // Branding features
  CUSTOM_BRANDING = 'custom_branding',
  CUSTOM_LOGO_COLOR_SCHEME = 'custom_logo_color_scheme',
  WHITE_LABEL_PLATFORM = 'white_label_platform',
  
  // Premium experience
  PREMIUM_USER_SUPPORT = 'premium_user_support',
  PRIORITY_ASSISTANCE = 'priority_assistance',
  PREMIUM_UI_COMPONENTS = 'premium_ui_components'
}

export enum UserTier {
  FREE = 'free',
  EMAIL_CAPTURED = 'email_captured',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise'
}

export enum FeatureRolloutStrategy {
  ALL_USERS = 'all_users',
  PERCENTAGE_ROLLOUT = 'percentage_rollout',
  USER_LIST = 'user_list',
  TIER_BASED = 'tier_based',
  AB_TEST = 'ab_test'
}

// Feature flag schemas
export const FeatureFlagConfigSchema = z.object({
  flag: z.nativeEnum(FeatureFlag),
  enabled: z.boolean(),
  strategy: z.nativeEnum(FeatureRolloutStrategy),
  requiredTier: z.nativeEnum(UserTier).optional(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  userWhitelist: z.array(z.string()).optional(),
  userBlacklist: z.array(z.string()).optional(),
  dependencies: z.array(z.nativeEnum(FeatureFlag)).optional(),
  metadata: z.object({
    description: z.string(),
    createdBy: z.string(),
    businessJustification: z.string(),
    expectedImpact: z.string().optional(),
    rolloutPlan: z.string().optional()
  }),
  conditions: z.object({
    environments: z.array(z.string()).optional(),
    dateRange: z.object({
      startDate: z.date(),
      endDate: z.date().optional()
    }).optional(),
    customRules: z.record(z.any()).optional()
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastEvaluatedAt: z.date().optional()
});

export const UserContextSchema = z.object({
  userId: z.string(),
  userTier: z.nativeEnum(UserTier),
  subscriptionId: z.string().optional(),
  subscriptionStatus: z.string().optional(),
  email: z.string().email().optional(),
  registrationDate: z.date().optional(),
  lastActiveDate: z.date().optional(),
  organizationId: z.string().optional(),
  customAttributes: z.record(z.any()).optional()
});

export type FeatureFlagConfig = z.infer<typeof FeatureFlagConfigSchema>;
export type UserContext = z.infer<typeof UserContextSchema>;

// Feature evaluation results
export interface FeatureEvaluationResult {
  flag: FeatureFlag;
  enabled: boolean;
  reason: string;
  source: 'cache' | 'database' | 'default';
  evaluationTime: number; // milliseconds
  variant?: string; // for A/B testing
  metadata?: Record<string, any>;
}

export interface BulkEvaluationResult {
  userId: string;
  evaluations: Record<FeatureFlag, FeatureEvaluationResult>;
  totalEvaluationTime: number;
  cacheHitRate: number;
}

// Default feature flag configurations
const DEFAULT_FEATURE_FLAGS: Partial<Record<FeatureFlag, Omit<FeatureFlagConfig, 'createdAt' | 'updatedAt'>>> = {
  [FeatureFlag.ADVANCED_PLANNING_SESSIONS]: {
    flag: FeatureFlag.ADVANCED_PLANNING_SESSIONS,
    enabled: true,
    strategy: FeatureRolloutStrategy.TIER_BASED,
    requiredTier: UserTier.PREMIUM,
    metadata: {
      description: 'Extended planning sessions with deeper analysis for premium users',
      createdBy: 'system',
      businessJustification: 'Premium tier differentiation and value proposition'
    }
  },
  [FeatureFlag.PRIORITY_PROCESSING]: {
    flag: FeatureFlag.PRIORITY_PROCESSING,
    enabled: true,
    strategy: FeatureRolloutStrategy.TIER_BASED,
    requiredTier: UserTier.PREMIUM,
    metadata: {
      description: 'Faster processing times with dedicated infrastructure',
      createdBy: 'system',
      businessJustification: 'Premium user experience improvement'
    }
  },
  [FeatureFlag.UNLIMITED_SESSION_HISTORY]: {
    flag: FeatureFlag.UNLIMITED_SESSION_HISTORY,
    enabled: true,
    strategy: FeatureRolloutStrategy.TIER_BASED,
    requiredTier: UserTier.PREMIUM,
    metadata: {
      description: 'Unlimited session storage and advanced search',
      createdBy: 'system',
      businessJustification: 'Premium tier value and user retention'
    }
  },
  [FeatureFlag.CUSTOM_BRANDING]: {
    flag: FeatureFlag.CUSTOM_BRANDING,
    enabled: true,
    strategy: FeatureRolloutStrategy.TIER_BASED,
    requiredTier: UserTier.ENTERPRISE,
    metadata: {
      description: 'Custom branding and white-label capabilities',
      createdBy: 'system',
      businessJustification: 'Enterprise tier differentiation'
    }
  }
};

export class FeatureFlagManager extends EventEmitter {
  private static instance: FeatureFlagManager;
  private redis: Redis;
  private featureFlags: Map<FeatureFlag, FeatureFlagConfig> = new Map();
  private evaluationCache: Map<string, FeatureEvaluationResult> = new Map();
  
  // Performance tracking
  private evaluationStats = {
    totalEvaluations: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageEvaluationTime: 0,
    lastStatsReset: new Date()
  };

  // Cache configuration
  private readonly CACHE_TTL = 300; // 5 minutes in seconds
  private readonly CACHE_PREFIX = 'feature_flag:';
  private readonly USER_CACHE_PREFIX = 'user_flags:';

  private constructor() {
    super();
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });
    
    this.initializeFeatureFlags();
    this.setupRedisEventHandlers();
    this.startCacheWarming();
  }

  static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager();
    }
    return FeatureFlagManager.instance;
  }

  /**
   * Evaluate a single feature flag for a user
   */
  async evaluateFlag(flag: FeatureFlag, userContext: UserContext): Promise<FeatureEvaluationResult> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(flag, userContext.userId);
    
    try {
      // Check cache first
      const cachedResult = await this.getCachedEvaluation(cacheKey);
      if (cachedResult) {
        this.updateStats('cache_hit', Date.now() - startTime);
        return {
          ...cachedResult,
          source: 'cache',
          evaluationTime: Date.now() - startTime
        };
      }

      // Evaluate the flag
      const result = await this.performEvaluation(flag, userContext, startTime);
      
      // Cache the result
      await this.cacheEvaluation(cacheKey, result);
      
      this.updateStats('cache_miss', result.evaluationTime);
      return result;

    } catch (error) {
      console.error(`Error evaluating feature flag ${flag}:`, error);
      
      // Return safe default
      return {
        flag,
        enabled: false,
        reason: 'evaluation_error',
        source: 'default',
        evaluationTime: Date.now() - startTime
      };
    }
  }

  /**
   * Evaluate multiple feature flags for a user in bulk
   */
  async evaluateFlags(flags: FeatureFlag[], userContext: UserContext): Promise<BulkEvaluationResult> {
    const startTime = Date.now();
    const evaluations: Record<FeatureFlag, FeatureEvaluationResult> = {} as any;
    
    const evaluationPromises = flags.map(flag => 
      this.evaluateFlag(flag, userContext).then(result => {
        evaluations[flag] = result;
      })
    );

    await Promise.all(evaluationPromises);

    const totalEvaluationTime = Date.now() - startTime;
    const cacheHits = Object.values(evaluations).filter(e => e.source === 'cache').length;
    const cacheHitRate = cacheHits / flags.length;

    return {
      userId: userContext.userId,
      evaluations,
      totalEvaluationTime,
      cacheHitRate
    };
  }

  /**
   * Get all enabled features for a user
   */
  async getEnabledFeatures(userContext: UserContext): Promise<FeatureFlag[]> {
    const allFlags = Object.values(FeatureFlag);
    const result = await this.evaluateFlags(allFlags, userContext);
    
    return Object.entries(result.evaluations)
      .filter(([_, evaluation]) => evaluation.enabled)
      .map(([flag, _]) => flag as FeatureFlag);
  }

  /**
   * Check if a user has access to a specific feature
   */
  async hasFeatureAccess(flag: FeatureFlag, userContext: UserContext): Promise<boolean> {
    const result = await this.evaluateFlag(flag, userContext);
    return result.enabled;
  }

  /**
   * Update a feature flag configuration
   */
  async updateFeatureFlag(flagConfig: Partial<FeatureFlagConfig> & { flag: FeatureFlag }): Promise<void> {
    const existingConfig = this.featureFlags.get(flagConfig.flag);
    
    const updatedConfig: FeatureFlagConfig = {
      ...existingConfig,
      ...flagConfig,
      updatedAt: new Date()
    } as FeatureFlagConfig;

    // Validate the configuration
    const validatedConfig = FeatureFlagConfigSchema.parse(updatedConfig);
    
    // Update in memory
    this.featureFlags.set(flagConfig.flag, validatedConfig);
    
    // Update in Redis
    await this.redis.hset(
      `${this.CACHE_PREFIX}config`,
      flagConfig.flag,
      JSON.stringify(validatedConfig)
    );

    // Invalidate related caches
    await this.invalidateFlagCache(flagConfig.flag);

    // Emit event
    this.emit('flag_updated', { flag: flagConfig.flag, config: validatedConfig });

    console.log(`Feature flag ${flagConfig.flag} updated`);
  }

  /**
   * Create a new feature flag
   */
  async createFeatureFlag(flagConfig: Omit<FeatureFlagConfig, 'createdAt' | 'updatedAt'>): Promise<void> {
    const now = new Date();
    const config: FeatureFlagConfig = {
      ...flagConfig,
      createdAt: now,
      updatedAt: now
    };

    // Validate the configuration
    const validatedConfig = FeatureFlagConfigSchema.parse(config);
    
    // Store in memory and Redis
    this.featureFlags.set(config.flag, validatedConfig);
    await this.redis.hset(
      `${this.CACHE_PREFIX}config`,
      config.flag,
      JSON.stringify(validatedConfig)
    );

    // Emit event
    this.emit('flag_created', { flag: config.flag, config: validatedConfig });

    console.log(`Feature flag ${config.flag} created`);
  }

  /**
   * Delete a feature flag
   */
  async deleteFeatureFlag(flag: FeatureFlag): Promise<void> {
    // Remove from memory
    this.featureFlags.delete(flag);
    
    // Remove from Redis
    await this.redis.hdel(`${this.CACHE_PREFIX}config`, flag);
    
    // Invalidate caches
    await this.invalidateFlagCache(flag);

    // Emit event
    this.emit('flag_deleted', { flag });

    console.log(`Feature flag ${flag} deleted`);
  }

  /**
   * Get feature flag configuration
   */
  getFeatureFlagConfig(flag: FeatureFlag): FeatureFlagConfig | null {
    return this.featureFlags.get(flag) || null;
  }

  /**
   * Get all feature flag configurations
   */
  getAllFeatureFlags(): FeatureFlagConfig[] {
    return Array.from(this.featureFlags.values());
  }

  /**
   * Get feature flag evaluation statistics
   */
  getEvaluationStats(): typeof this.evaluationStats {
    return { ...this.evaluationStats };
  }

  /**
   * Reset evaluation statistics
   */
  resetEvaluationStats(): void {
    this.evaluationStats = {
      totalEvaluations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageEvaluationTime: 0,
      lastStatsReset: new Date()
    };
  }

  // Private helper methods

  private async performEvaluation(
    flag: FeatureFlag, 
    userContext: UserContext, 
    startTime: number
  ): Promise<FeatureEvaluationResult> {
    const config = this.featureFlags.get(flag);
    
    if (!config) {
      return {
        flag,
        enabled: false,
        reason: 'flag_not_found',
        source: 'default',
        evaluationTime: Date.now() - startTime
      };
    }

    // Check if flag is globally disabled
    if (!config.enabled) {
      return {
        flag,
        enabled: false,
        reason: 'flag_disabled',
        source: 'database',
        evaluationTime: Date.now() - startTime
      };
    }

    // Check dependencies
    if (config.dependencies && config.dependencies.length > 0) {
      const dependencyResults = await Promise.all(
        config.dependencies.map(dep => this.evaluateFlag(dep, userContext))
      );
      
      const unmetDependencies = dependencyResults.filter(result => !result.enabled);
      if (unmetDependencies.length > 0) {
        return {
          flag,
          enabled: false,
          reason: `dependencies_not_met: ${unmetDependencies.map(d => d.flag).join(', ')}`,
          source: 'database',
          evaluationTime: Date.now() - startTime
        };
      }
    }

    // Check user blacklist
    if (config.userBlacklist?.includes(userContext.userId)) {
      return {
        flag,
        enabled: false,
        reason: 'user_blacklisted',
        source: 'database',
        evaluationTime: Date.now() - startTime
      };
    }

    // Evaluate based on strategy
    const strategyResult = await this.evaluateStrategy(config, userContext);

    return {
      flag,
      enabled: strategyResult.enabled,
      reason: strategyResult.reason,
      source: 'database',
      evaluationTime: Date.now() - startTime,
      variant: strategyResult.variant,
      metadata: config.metadata
    };
  }

  private async evaluateStrategy(
    config: FeatureFlagConfig, 
    userContext: UserContext
  ): Promise<{ enabled: boolean; reason: string; variant?: string }> {
    
    switch (config.strategy) {
      case FeatureRolloutStrategy.ALL_USERS:
        return { enabled: true, reason: 'all_users_enabled' };

      case FeatureRolloutStrategy.TIER_BASED:
        if (!config.requiredTier) {
          return { enabled: false, reason: 'no_required_tier_specified' };
        }
        
        const hasRequiredTier = this.checkTierAccess(userContext.userTier, config.requiredTier);
        return {
          enabled: hasRequiredTier,
          reason: hasRequiredTier ? 'tier_access_granted' : `requires_tier_${config.requiredTier}`
        };

      case FeatureRolloutStrategy.PERCENTAGE_ROLLOUT:
        if (!config.rolloutPercentage) {
          return { enabled: false, reason: 'no_rollout_percentage_specified' };
        }
        
        const userHash = this.hashUserId(userContext.userId);
        const isInRollout = userHash < config.rolloutPercentage;
        return {
          enabled: isInRollout,
          reason: isInRollout ? 'percentage_rollout_included' : 'percentage_rollout_excluded'
        };

      case FeatureRolloutStrategy.USER_LIST:
        if (!config.userWhitelist) {
          return { enabled: false, reason: 'no_user_whitelist_specified' };
        }
        
        const isWhitelisted = config.userWhitelist.includes(userContext.userId);
        return {
          enabled: isWhitelisted,
          reason: isWhitelisted ? 'user_whitelisted' : 'user_not_whitelisted'
        };

      case FeatureRolloutStrategy.AB_TEST:
        // Simple A/B test implementation
        const variant = this.hashUserId(userContext.userId) < 50 ? 'A' : 'B';
        return {
          enabled: true,
          reason: 'ab_test_enabled',
          variant
        };

      default:
        return { enabled: false, reason: 'unknown_strategy' };
    }
  }

  private checkTierAccess(userTier: UserTier, requiredTier: UserTier): boolean {
    const tierHierarchy = {
      [UserTier.FREE]: 0,
      [UserTier.EMAIL_CAPTURED]: 1,
      [UserTier.PREMIUM]: 2,
      [UserTier.ENTERPRISE]: 3
    };

    return tierHierarchy[userTier] >= tierHierarchy[requiredTier];
  }

  private hashUserId(userId: string): number {
    // Simple hash function for consistent percentage rollouts
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100;
  }

  private generateCacheKey(flag: FeatureFlag, userId: string): string {
    return `${this.USER_CACHE_PREFIX}${userId}:${flag}`;
  }

  private async getCachedEvaluation(cacheKey: string): Promise<FeatureEvaluationResult | null> {
    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('Error retrieving from cache:', error);
      return null;
    }
  }

  private async cacheEvaluation(cacheKey: string, result: FeatureEvaluationResult): Promise<void> {
    try {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    } catch (error) {
      console.warn('Error caching evaluation result:', error);
    }
  }

  private async invalidateFlagCache(flag: FeatureFlag): Promise<void> {
    try {
      const pattern = `${this.USER_CACHE_PREFIX}*:${flag}`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.warn('Error invalidating flag cache:', error);
    }
  }

  private updateStats(type: 'cache_hit' | 'cache_miss', evaluationTime: number): void {
    this.evaluationStats.totalEvaluations++;
    
    if (type === 'cache_hit') {
      this.evaluationStats.cacheHits++;
    } else {
      this.evaluationStats.cacheMisses++;
    }

    // Update average evaluation time (running average)
    const totalTime = (this.evaluationStats.averageEvaluationTime * (this.evaluationStats.totalEvaluations - 1)) + evaluationTime;
    this.evaluationStats.averageEvaluationTime = totalTime / this.evaluationStats.totalEvaluations;
  }

  private async initializeFeatureFlags(): Promise<void> {
    try {
      // Load configurations from Redis
      const configs = await this.redis.hgetall(`${this.CACHE_PREFIX}config`);
      
      for (const [flag, configString] of Object.entries(configs)) {
        try {
          const config = JSON.parse(configString);
          const validatedConfig = FeatureFlagConfigSchema.parse({
            ...config,
            createdAt: new Date(config.createdAt),
            updatedAt: new Date(config.updatedAt),
            lastEvaluatedAt: config.lastEvaluatedAt ? new Date(config.lastEvaluatedAt) : undefined
          });
          
          this.featureFlags.set(flag as FeatureFlag, validatedConfig);
        } catch (error) {
          console.warn(`Error parsing feature flag config for ${flag}:`, error);
        }
      }

      // Initialize default flags if not present
      for (const [flag, defaultConfig] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
        if (!this.featureFlags.has(flag as FeatureFlag)) {
          const config: FeatureFlagConfig = {
            ...defaultConfig!,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          this.featureFlags.set(flag as FeatureFlag, config);
          await this.redis.hset(
            `${this.CACHE_PREFIX}config`,
            flag,
            JSON.stringify(config)
          );
        }
      }

      console.log(`Initialized ${this.featureFlags.size} feature flags`);

    } catch (error) {
      console.error('Error initializing feature flags:', error);
      
      // Fallback to default configurations
      for (const [flag, defaultConfig] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
        const config: FeatureFlagConfig = {
          ...defaultConfig!,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        this.featureFlags.set(flag as FeatureFlag, config);
      }
    }
  }

  private setupRedisEventHandlers(): void {
    this.redis.on('connect', () => {
      console.log('Feature flag manager connected to Redis');
    });

    this.redis.on('error', (error) => {
      console.error('Feature flag manager Redis error:', error);
    });

    this.redis.on('reconnecting', () => {
      console.log('Feature flag manager reconnecting to Redis');
    });
  }

  private startCacheWarming(): void {
    // Warm cache every 10 minutes
    setInterval(async () => {
      try {
        // Pre-load commonly used configurations
        await this.redis.hgetall(`${this.CACHE_PREFIX}config`);
      } catch (error) {
        console.warn('Error warming feature flag cache:', error);
      }
    }, 10 * 60 * 1000);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      const redisInfo = await this.redis.ping();
      const stats = this.getEvaluationStats();
      
      const details = {
        redis: redisInfo === 'PONG' ? 'healthy' : 'unhealthy',
        featureFlagsLoaded: this.featureFlags.size,
        evaluationStats: stats,
        timestamp: new Date()
      };

      const status = redisInfo === 'PONG' ? 'healthy' : 'degraded';

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date()
        }
      };
    }
  }

  /**
   * Shutdown cleanup
   */
  async shutdown(): Promise<void> {
    await this.redis.disconnect();
    console.log('Feature flag manager shut down');
  }
}

// Export singleton instance
export const featureFlagManager = FeatureFlagManager.getInstance();
export default featureFlagManager;