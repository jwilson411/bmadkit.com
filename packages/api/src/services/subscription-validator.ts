import { z } from 'zod';
import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';
import { subscriptionManager } from './subscription-manager';
import { oneTimePurchaseManager, PurchaseType } from './one-time-purchase-manager';
import { featureFlagManager, FeatureFlag, UserTier, UserContext } from './feature-flag-manager';
import { 
  SubscriptionStatus, 
  SubscriptionPlan, 
  isActiveSubscription,
  PLAN_CONFIGURATIONS 
} from '../models/subscription';

// User subscription context
export const UserSubscriptionContextSchema = z.object({
  userId: z.string(),
  subscriptionId: z.string().optional(),
  plan: z.nativeEnum(SubscriptionPlan).optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  tier: z.nativeEnum(UserTier),
  currentPeriodEnd: z.date().optional(),
  trialEnd: z.date().optional(),
  features: z.array(z.nativeEnum(FeatureFlag)),
  limits: z.object({
    planningSessionsPerMonth: z.number(),
    documentsPerMonth: z.number(),
    storageGB: z.number(),
    exportsPerMonth: z.number(),
    apiCallsPerDay: z.number(),
    teamMembers: z.number()
  }),
  usage: z.object({
    planningSessionsUsed: z.number().default(0),
    documentsGenerated: z.number().default(0),
    storageUsedMB: z.number().default(0),
    exportCount: z.number().default(0),
    apiCallsUsed: z.number().default(0)
  }),
  oneTimePurchases: z.array(z.object({
    type: z.nativeEnum(PurchaseType),
    hasAccess: z.boolean(),
    expiresAt: z.date().optional()
  })),
  metadata: z.record(z.any()).optional(),
  lastValidatedAt: z.date(),
  cacheExpiresAt: z.date()
});

export type UserSubscriptionContext = z.infer<typeof UserSubscriptionContextSchema>;

// Tier-based limits configuration
const TIER_LIMITS = {
  [UserTier.FREE]: {
    planningSessionsPerMonth: 2,
    documentsPerMonth: 5,
    storageGB: 0.1, // 100MB
    exportsPerMonth: 2,
    apiCallsPerDay: 50,
    teamMembers: 1
  },
  [UserTier.EMAIL_CAPTURED]: {
    planningSessionsPerMonth: 5,
    documentsPerMonth: 15,
    storageGB: 0.5, // 500MB
    exportsPerMonth: 10,
    apiCallsPerDay: 200,
    teamMembers: 1
  },
  [UserTier.PREMIUM]: {
    planningSessionsPerMonth: -1, // Unlimited
    documentsPerMonth: -1, // Unlimited
    storageGB: -1, // Unlimited
    exportsPerMonth: -1, // Unlimited
    apiCallsPerDay: 10000,
    teamMembers: 5
  },
  [UserTier.ENTERPRISE]: {
    planningSessionsPerMonth: -1, // Unlimited
    documentsPerMonth: -1, // Unlimited
    storageGB: -1, // Unlimited
    exportsPerMonth: -1, // Unlimited
    apiCallsPerDay: 50000,
    teamMembers: -1 // Unlimited
  }
};

// JWT claims for subscription context
interface SubscriptionJWTClaims {
  userId: string;
  tier: UserTier;
  subscriptionId?: string;
  plan?: SubscriptionPlan;
  features: FeatureFlag[];
  limits: typeof TIER_LIMITS[UserTier.FREE];
  iat: number;
  exp: number;
}

export class SubscriptionValidator extends EventEmitter {
  private static instance: SubscriptionValidator;
  
  // Cache for subscription contexts (in production, use Redis)
  private contextCache: Map<string, UserSubscriptionContext> = new Map();
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  
  // JWT configuration
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  private readonly JWT_EXPIRES_IN = '1h';

  private constructor() {
    super();
    this.setupEventHandlers();
    this.startCacheCleanup();
  }

  static getInstance(): SubscriptionValidator {
    if (!SubscriptionValidator.instance) {
      SubscriptionValidator.instance = new SubscriptionValidator();
    }
    return SubscriptionValidator.instance;
  }

  /**
   * Validate and get user subscription context
   */
  async validateUserSubscription(userId: string, forceRefresh = false): Promise<UserSubscriptionContext> {
    // Check cache first
    if (!forceRefresh && this.contextCache.has(userId)) {
      const cached = this.contextCache.get(userId)!;
      if (cached.cacheExpiresAt > new Date()) {
        return cached;
      }
    }

    try {
      // Build fresh context
      const context = await this.buildSubscriptionContext(userId);
      
      // Cache the result
      this.contextCache.set(userId, context);
      
      // Emit validation event
      this.emit('subscription_validated', { userId, context });
      
      return context;

    } catch (error) {
      console.error(`Error validating subscription for user ${userId}:`, error);
      
      // Return default free tier context
      return this.createDefaultContext(userId);
    }
  }

  /**
   * Check if user has access to a specific feature
   */
  async hasFeatureAccess(userId: string, feature: FeatureFlag): Promise<boolean> {
    try {
      const context = await this.validateUserSubscription(userId);
      return context.features.includes(feature);
    } catch (error) {
      console.error(`Error checking feature access for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Check if user is within usage limits
   */
  async checkUsageLimits(userId: string): Promise<{
    withinLimits: boolean;
    limits: UserSubscriptionContext['limits'];
    usage: UserSubscriptionContext['usage'];
    exceededLimits: Array<{
      type: keyof UserSubscriptionContext['limits'];
      limit: number;
      used: number;
      percentage: number;
    }>;
  }> {
    const context = await this.validateUserSubscription(userId);
    const { limits, usage } = context;
    
    const exceededLimits: Array<{
      type: keyof UserSubscriptionContext['limits'];
      limit: number;
      used: number;
      percentage: number;
    }> = [];

    // Check each limit
    const checks = [
      { type: 'planningSessionsPerMonth' as const, limit: limits.planningSessionsPerMonth, used: usage.planningSessionsUsed },
      { type: 'documentsPerMonth' as const, limit: limits.documentsPerMonth, used: usage.documentsGenerated },
      { type: 'storageGB' as const, limit: limits.storageGB * 1024, used: usage.storageUsedMB }, // Convert GB to MB
      { type: 'exportsPerMonth' as const, limit: limits.exportsPerMonth, used: usage.exportCount },
      { type: 'apiCallsPerDay' as const, limit: limits.apiCallsPerDay, used: usage.apiCallsUsed }
    ];

    for (const check of checks) {
      if (check.limit !== -1 && check.used >= check.limit) {
        exceededLimits.push({
          type: check.type,
          limit: check.limit,
          used: check.used,
          percentage: (check.used / check.limit) * 100
        });
      }
    }

    return {
      withinLimits: exceededLimits.length === 0,
      limits,
      usage,
      exceededLimits
    };
  }

  /**
   * Generate JWT token with subscription context
   */
  async generateSubscriptionToken(userId: string): Promise<string> {
    const context = await this.validateUserSubscription(userId);
    
    const claims: SubscriptionJWTClaims = {
      userId: context.userId,
      tier: context.tier,
      subscriptionId: context.subscriptionId,
      plan: context.plan,
      features: context.features,
      limits: context.limits,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    };

    return jwt.sign(claims, this.JWT_SECRET, { expiresIn: this.JWT_EXPIRES_IN });
  }

  /**
   * Verify and extract subscription context from JWT token
   */
  verifySubscriptionToken(token: string): SubscriptionJWTClaims | null {
    try {
      const decoded = jwt.verify(token, this.JWT_SECRET) as SubscriptionJWTClaims;
      return decoded;
    } catch (error) {
      console.warn('Invalid subscription token:', error);
      return null;
    }
  }

  /**
   * Update user tier (typically after subscription changes)
   */
  async updateUserTier(userId: string, newTier: UserTier, reason?: string): Promise<void> {
    // Invalidate cache
    this.contextCache.delete(userId);
    
    // Rebuild context with new tier
    const context = await this.validateUserSubscription(userId, true);
    
    // Emit tier change event
    this.emit('tier_changed', { 
      userId, 
      newTier, 
      previousTier: context.tier, 
      reason,
      context 
    });

    console.log(`User ${userId} tier updated to ${newTier}`);
  }

  /**
   * Track feature usage
   */
  async trackUsage(userId: string, usageType: keyof UserSubscriptionContext['usage'], amount: number = 1): Promise<void> {
    const context = this.contextCache.get(userId);
    if (!context) return;

    // Update usage in context
    const updatedContext: UserSubscriptionContext = {
      ...context,
      usage: {
        ...context.usage,
        [usageType]: context.usage[usageType] + amount
      },
      lastValidatedAt: new Date()
    };

    this.contextCache.set(userId, updatedContext);

    // Check if usage limits are exceeded
    const limitsCheck = await this.checkUsageLimits(userId);
    if (!limitsCheck.withinLimits) {
      this.emit('usage_limit_exceeded', {
        userId,
        exceededLimits: limitsCheck.exceededLimits,
        context: updatedContext
      });
    }

    // Track usage with subscription manager if applicable
    if (context.subscriptionId) {
      try {
        await subscriptionManager.trackUsage(context.subscriptionId, usageType, amount);
      } catch (error) {
        console.warn('Error tracking usage in subscription manager:', error);
      }
    }
  }

  /**
   * Get user subscription context from cache
   */
  getCachedContext(userId: string): UserSubscriptionContext | null {
    const cached = this.contextCache.get(userId);
    return cached && cached.cacheExpiresAt > new Date() ? cached : null;
  }

  /**
   * Invalidate user context cache
   */
  invalidateUserContext(userId: string): void {
    this.contextCache.delete(userId);
    this.emit('cache_invalidated', { userId });
  }

  /**
   * Get subscription statistics
   */
  getValidationStatistics(): {
    cachedContexts: number;
    validationEvents: Record<string, number>;
    tierDistribution: Record<UserTier, number>;
  } {
    const cachedContexts = this.contextCache.size;
    
    // Count tier distribution from cache
    const tierDistribution = Object.values(UserTier).reduce((acc, tier) => {
      acc[tier] = Array.from(this.contextCache.values())
        .filter(context => context.tier === tier).length;
      return acc;
    }, {} as Record<UserTier, number>);

    return {
      cachedContexts,
      validationEvents: {
        // These would be tracked in a real implementation
        total_validations: 0,
        cache_hits: 0,
        cache_misses: 0
      },
      tierDistribution
    };
  }

  // Private helper methods

  private async buildSubscriptionContext(userId: string): Promise<UserSubscriptionContext> {
    // Get active subscription
    const activeSubscription = await subscriptionManager.getActiveUserSubscription(userId);
    
    // Get one-time purchases
    const activePurchases = oneTimePurchaseManager.getActivePurchases(userId);
    
    // Determine user tier
    const tier = this.determineUserTier(activeSubscription, activePurchases);
    
    // Get tier limits
    const limits = this.getTierLimits(tier, activeSubscription?.plan);
    
    // Get current usage
    const usage = await this.getCurrentUsage(userId, activeSubscription?.id);
    
    // Get available features
    const userContext: UserContext = {
      userId,
      userTier: tier,
      subscriptionId: activeSubscription?.id,
      subscriptionStatus: activeSubscription?.status,
      // Additional context would come from user service
    };
    
    const features = await featureFlagManager.getEnabledFeatures(userContext);
    
    // Build one-time purchase access
    const oneTimePurchases = Object.values(PurchaseType).map(type => ({
      type,
      hasAccess: oneTimePurchaseManager.hasAccess(userId, type),
      expiresAt: activePurchases.find(p => p.type === type)?.expiresAt
    }));

    const now = new Date();
    const context: UserSubscriptionContext = {
      userId,
      subscriptionId: activeSubscription?.id,
      plan: activeSubscription?.plan,
      status: activeSubscription?.status,
      tier,
      currentPeriodEnd: activeSubscription?.currentPeriodEnd,
      trialEnd: activeSubscription?.trialEnd,
      features,
      limits,
      usage,
      oneTimePurchases,
      metadata: {
        lastSubscriptionUpdate: activeSubscription?.updatedAt,
        activePurchaseCount: activePurchases.length
      },
      lastValidatedAt: now,
      cacheExpiresAt: new Date(now.getTime() + this.CACHE_TTL)
    };

    return UserSubscriptionContextSchema.parse(context);
  }

  private determineUserTier(activeSubscription: any, activePurchases: any[]): UserTier {
    // Check for active premium subscription
    if (activeSubscription && isActiveSubscription(activeSubscription.status)) {
      const plan = activeSubscription.plan;
      
      if (plan?.includes('ENTERPRISE')) {
        return UserTier.ENTERPRISE;
      } else if (plan?.includes('PROFESSIONAL') || plan?.includes('BASIC')) {
        return UserTier.PREMIUM;
      }
    }

    // Check for one-time premium purchases
    if (activePurchases.length > 0) {
      const premiumPurchases = activePurchases.filter(p => 
        p.type === PurchaseType.PLANNING_SESSION ||
        p.type === PurchaseType.CONSULTATION_HOUR
      );
      
      if (premiumPurchases.length > 0) {
        return UserTier.PREMIUM;
      }
    }

    // Default tiers based on basic criteria
    // In a real implementation, this would check user registration status
    return UserTier.FREE; // Simplified for this implementation
  }

  private getTierLimits(tier: UserTier, plan?: SubscriptionPlan): UserSubscriptionContext['limits'] {
    // If user has a specific subscription plan, use those limits
    if (plan && tier === UserTier.PREMIUM) {
      const planConfig = PLAN_CONFIGURATIONS[plan];
      if (planConfig) {
        return {
          planningSessionsPerMonth: planConfig.limits.planningSessionsPerMonth,
          documentsPerMonth: planConfig.limits.documentsPerMonth,
          storageGB: planConfig.limits.storageGB,
          exportsPerMonth: planConfig.limits.exportsPerMonth,
          apiCallsPerDay: planConfig.limits.apiCallsPerDay,
          teamMembers: planConfig.limits.teamMembers
        };
      }
    }

    // Otherwise use tier-based limits
    return TIER_LIMITS[tier];
  }

  private async getCurrentUsage(userId: string, subscriptionId?: string): Promise<UserSubscriptionContext['usage']> {
    if (subscriptionId) {
      try {
        const usage = await subscriptionManager.getCurrentUsage(subscriptionId);
        if (usage) {
          return {
            planningSessionsUsed: usage.usage.planningSessionsUsed,
            documentsGenerated: usage.usage.documentsGenerated,
            storageUsedMB: usage.usage.storageUsedMB,
            exportCount: usage.usage.exportCount,
            apiCallsUsed: usage.usage.apiCallsUsed
          };
        }
      } catch (error) {
        console.warn('Error getting usage from subscription manager:', error);
      }
    }

    // Return default/zero usage
    return {
      planningSessionsUsed: 0,
      documentsGenerated: 0,
      storageUsedMB: 0,
      exportCount: 0,
      apiCallsUsed: 0
    };
  }

  private createDefaultContext(userId: string): UserSubscriptionContext {
    const now = new Date();
    
    return {
      userId,
      tier: UserTier.FREE,
      features: [], // No premium features
      limits: TIER_LIMITS[UserTier.FREE],
      usage: {
        planningSessionsUsed: 0,
        documentsGenerated: 0,
        storageUsedMB: 0,
        exportCount: 0,
        apiCallsUsed: 0
      },
      oneTimePurchases: [],
      lastValidatedAt: now,
      cacheExpiresAt: new Date(now.getTime() + this.CACHE_TTL)
    };
  }

  private setupEventHandlers(): void {
    // Listen for subscription events
    subscriptionManager.on('subscription.created', (data) => {
      this.invalidateUserContext(data.subscription.userId);
    });

    subscriptionManager.on('subscription.updated', (data) => {
      this.invalidateUserContext(data.subscription.userId);
    });

    subscriptionManager.on('subscription.canceled', (data) => {
      this.invalidateUserContext(data.subscription.userId);
    });

    // Listen for purchase events
    oneTimePurchaseManager.on('purchase.completed', (data) => {
      this.invalidateUserContext(data.purchase.userId);
    });

    oneTimePurchaseManager.on('access.revoked', (data) => {
      this.invalidateUserContext(data.purchase.userId);
    });
  }

  private startCacheCleanup(): void {
    // Clean expired contexts every 5 minutes
    setInterval(() => {
      const now = new Date();
      const expiredUsers: string[] = [];
      
      for (const [userId, context] of this.contextCache.entries()) {
        if (context.cacheExpiresAt <= now) {
          expiredUsers.push(userId);
        }
      }

      expiredUsers.forEach(userId => {
        this.contextCache.delete(userId);
      });

      if (expiredUsers.length > 0) {
        console.log(`Cleaned ${expiredUsers.length} expired subscription contexts`);
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const statistics = this.getValidationStatistics();
    
    const details = {
      ...statistics,
      cacheSize: this.contextCache.size,
      timestamp: new Date()
    };

    return { status: 'healthy', details };
  }
}

// Export singleton instance
export const subscriptionValidator = SubscriptionValidator.getInstance();
export default subscriptionValidator;