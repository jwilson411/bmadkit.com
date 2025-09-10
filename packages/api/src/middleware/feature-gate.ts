import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { featureFlagManager, FeatureFlag, UserTier } from '../services/feature-flag-manager';
import { subscriptionValidator } from '../services/subscription-validator';

// Extended request interface with user context
export interface FeatureGatedRequest extends Request {
  user?: {
    id: string;
    tier: UserTier;
    subscriptionId?: string;
    features: FeatureFlag[];
    limits: any;
    usage: any;
  };
  subscriptionContext?: any;
}

// Feature gate configuration
export interface FeatureGateConfig {
  feature: FeatureFlag;
  requireAll?: boolean; // For multiple features
  allowFallback?: boolean; // Allow degraded functionality
  customCheck?: (context: any) => Promise<boolean>;
  errorMessage?: string;
  redirectUrl?: string;
}

// Usage limit check configuration
export interface UsageLimitConfig {
  limitType: 'planningSessionsPerMonth' | 'documentsPerMonth' | 'storageGB' | 'exportsPerMonth' | 'apiCallsPerDay';
  errorMessage?: string;
  upgradePromptMessage?: string;
}

/**
 * Middleware to check if user has access to a specific feature
 */
export const requireFeature = (config: FeatureGateConfig | FeatureFlag) => {
  return async (req: FeatureGatedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract user ID from request (implement based on your auth system)
      const userId = extractUserId(req);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'User authentication required'
          }
        });
      }

      // Parse configuration
      const featureConfig: FeatureGateConfig = typeof config === 'string' 
        ? { feature: config }
        : config;

      // Get user subscription context
      const subscriptionContext = await subscriptionValidator.validateUserSubscription(userId);
      req.subscriptionContext = subscriptionContext;
      req.user = {
        id: userId,
        tier: subscriptionContext.tier,
        subscriptionId: subscriptionContext.subscriptionId,
        features: subscriptionContext.features,
        limits: subscriptionContext.limits,
        usage: subscriptionContext.usage
      };

      // Check if user has the required feature
      const hasFeature = subscriptionContext.features.includes(featureConfig.feature);
      
      if (!hasFeature) {
        // Check if custom validation is provided
        if (featureConfig.customCheck) {
          const customResult = await featureConfig.customCheck(subscriptionContext);
          if (customResult) {
            return next(); // Custom check passed
          }
        }

        // Feature access denied
        const errorMessage = featureConfig.errorMessage || 
          `This feature requires ${getFeatureRequirements(featureConfig.feature)} access`;

        if (featureConfig.allowFallback) {
          // Add feature access info to request for degraded functionality
          req.user.hasFeatureAccess = false;
          return next();
        }

        if (featureConfig.redirectUrl) {
          return res.redirect(featureConfig.redirectUrl);
        }

        return res.status(403).json({
          success: false,
          error: {
            code: 'FEATURE_ACCESS_DENIED',
            message: errorMessage,
            requiredFeature: featureConfig.feature,
            userTier: subscriptionContext.tier,
            upgradeRequired: shouldPromptUpgrade(subscriptionContext.tier, featureConfig.feature)
          }
        });
      }

      // Feature access granted
      req.user.hasFeatureAccess = true;
      next();

    } catch (error) {
      console.error('Feature gate middleware error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'FEATURE_GATE_ERROR',
          message: 'Error checking feature access'
        }
      });
    }
  };
};

/**
 * Middleware to check multiple features (require all or any)
 */
export const requireFeatures = (features: FeatureFlag[], requireAll = true) => {
  return async (req: FeatureGatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = extractUserId(req);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'User authentication required'
          }
        });
      }

      const subscriptionContext = await subscriptionValidator.validateUserSubscription(userId);
      req.subscriptionContext = subscriptionContext;
      req.user = {
        id: userId,
        tier: subscriptionContext.tier,
        subscriptionId: subscriptionContext.subscriptionId,
        features: subscriptionContext.features,
        limits: subscriptionContext.limits,
        usage: subscriptionContext.usage
      };

      // Check feature access
      const hasFeatures = features.map(feature => 
        subscriptionContext.features.includes(feature)
      );

      const accessGranted = requireAll 
        ? hasFeatures.every(has => has)
        : hasFeatures.some(has => has);

      if (!accessGranted) {
        const missingFeatures = features.filter((feature, index) => !hasFeatures[index]);
        
        return res.status(403).json({
          success: false,
          error: {
            code: 'MULTIPLE_FEATURES_REQUIRED',
            message: `Access requires ${requireAll ? 'all' : 'any'} of the specified features`,
            missingFeatures,
            userTier: subscriptionContext.tier
          }
        });
      }

      next();

    } catch (error) {
      console.error('Multiple features gate middleware error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'FEATURE_GATE_ERROR',
          message: 'Error checking feature access'
        }
      });
    }
  };
};

/**
 * Middleware to check usage limits
 */
export const checkUsageLimit = (config: UsageLimitConfig) => {
  return async (req: FeatureGatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = extractUserId(req);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'User authentication required'
          }
        });
      }

      // Get usage limits check
      const limitsCheck = await subscriptionValidator.checkUsageLimits(userId);
      
      // Check specific limit if exceeded
      const exceededLimit = limitsCheck.exceededLimits.find(limit => 
        limit.type === config.limitType
      );

      if (exceededLimit) {
        const errorMessage = config.errorMessage || 
          `You have reached your ${config.limitType} limit of ${exceededLimit.limit}`;

        const upgradeMessage = config.upgradePromptMessage || 
          'Upgrade to Premium for unlimited access';

        return res.status(429).json({
          success: false,
          error: {
            code: 'USAGE_LIMIT_EXCEEDED',
            message: errorMessage,
            limitType: config.limitType,
            limit: exceededLimit.limit,
            used: exceededLimit.used,
            percentage: exceededLimit.percentage,
            upgradePrompt: upgradeMessage
          }
        });
      }

      // Add usage info to request
      req.user = req.user || {} as any;
      req.user.usageLimits = limitsCheck;
      
      next();

    } catch (error) {
      console.error('Usage limit middleware error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'USAGE_LIMIT_ERROR',
          message: 'Error checking usage limits'
        }
      });
    }
  };
};

/**
 * Middleware to require minimum user tier
 */
export const requireTier = (minimumTier: UserTier) => {
  return async (req: FeatureGatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = extractUserId(req);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'User authentication required'
          }
        });
      }

      const subscriptionContext = await subscriptionValidator.validateUserSubscription(userId);
      req.subscriptionContext = subscriptionContext;
      req.user = {
        id: userId,
        tier: subscriptionContext.tier,
        subscriptionId: subscriptionContext.subscriptionId,
        features: subscriptionContext.features,
        limits: subscriptionContext.limits,
        usage: subscriptionContext.usage
      };

      if (!hasTierAccess(subscriptionContext.tier, minimumTier)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_TIER',
            message: `This feature requires ${minimumTier} tier or higher`,
            userTier: subscriptionContext.tier,
            requiredTier: minimumTier,
            upgradeRequired: true
          }
        });
      }

      next();

    } catch (error) {
      console.error('Tier requirement middleware error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'TIER_CHECK_ERROR',
          message: 'Error checking user tier'
        }
      });
    }
  };
};

/**
 * Middleware to track feature usage
 */
export const trackUsage = (usageType: keyof any, amount = 1) => {
  return async (req: FeatureGatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = extractUserId(req);
      if (userId) {
        // Track usage asynchronously (don't block request)
        subscriptionValidator.trackUsage(userId, usageType, amount).catch(error => {
          console.error('Error tracking usage:', error);
        });
      }
      
      next();

    } catch (error) {
      // Don't block request for tracking errors
      console.error('Usage tracking middleware error:', error);
      next();
    }
  };
};

/**
 * Middleware to add subscription context to request
 */
export const addSubscriptionContext = async (req: FeatureGatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = extractUserId(req);
    if (!userId) {
      return next(); // Continue without context if no user
    }

    const subscriptionContext = await subscriptionValidator.validateUserSubscription(userId);
    req.subscriptionContext = subscriptionContext;
    req.user = {
      id: userId,
      tier: subscriptionContext.tier,
      subscriptionId: subscriptionContext.subscriptionId,
      features: subscriptionContext.features,
      limits: subscriptionContext.limits,
      usage: subscriptionContext.usage
    };

    next();

  } catch (error) {
    console.error('Subscription context middleware error:', error);
    // Continue without context on error
    next();
  }
};

/**
 * Utility middleware factories for common patterns
 */
export const premiumOnly = requireTier(UserTier.PREMIUM);
export const enterpriseOnly = requireTier(UserTier.ENTERPRISE);

export const requireAdvancedPlanning = requireFeature(FeatureFlag.ADVANCED_PLANNING_SESSIONS);
export const requirePriorityProcessing = requireFeature(FeatureFlag.PRIORITY_PROCESSING);
export const requireUnlimitedHistory = requireFeature(FeatureFlag.UNLIMITED_SESSION_HISTORY);
export const requireCustomBranding = requireFeature(FeatureFlag.CUSTOM_BRANDING);

export const checkPlanningSessionLimit = checkUsageLimit({
  limitType: 'planningSessionsPerMonth',
  errorMessage: 'You have reached your monthly planning session limit',
  upgradePromptMessage: 'Upgrade to Premium for unlimited planning sessions'
});

export const checkDocumentLimit = checkUsageLimit({
  limitType: 'documentsPerMonth',
  errorMessage: 'You have reached your monthly document generation limit',
  upgradePromptMessage: 'Upgrade to Premium for unlimited document generation'
});

export const checkExportLimit = checkUsageLimit({
  limitType: 'exportsPerMonth',
  errorMessage: 'You have reached your monthly export limit',
  upgradePromptMessage: 'Upgrade to Premium for unlimited exports'
});

// Helper functions

function extractUserId(req: FeatureGatedRequest): string | null {
  // Extract user ID from JWT token, session, or headers
  // This implementation depends on your authentication system
  
  // From JWT token
  if (req.headers.authorization) {
    try {
      const token = req.headers.authorization.replace('Bearer ', '');
      const claims = subscriptionValidator.verifySubscriptionToken(token);
      return claims?.userId || null;
    } catch (error) {
      // Token invalid, continue to other methods
    }
  }

  // From header (for testing/development)
  if (req.headers['x-user-id']) {
    return req.headers['x-user-id'] as string;
  }

  // From session (if using session-based auth)
  if ((req as any).session?.userId) {
    return (req as any).session.userId;
  }

  return null;
}

function getFeatureRequirements(feature: FeatureFlag): string {
  const featureRequirements: Record<FeatureFlag, string> = {
    [FeatureFlag.ADVANCED_PLANNING_SESSIONS]: 'Premium',
    [FeatureFlag.EXTENDED_SESSION_DURATION]: 'Premium',
    [FeatureFlag.DETAILED_QUESTIONING]: 'Premium',
    [FeatureFlag.PRIORITY_PROCESSING]: 'Premium',
    [FeatureFlag.DEDICATED_INFRASTRUCTURE]: 'Premium',
    [FeatureFlag.FASTER_LLM_RESPONSES]: 'Premium',
    [FeatureFlag.TECHNICAL_ARCHITECTURE_TEMPLATES]: 'Premium',
    [FeatureFlag.IMPLEMENTATION_ROADMAP_TEMPLATES]: 'Premium',
    [FeatureFlag.PREMIUM_TEMPLATE_LIBRARY]: 'Premium',
    [FeatureFlag.UNLIMITED_SESSION_HISTORY]: 'Premium',
    [FeatureFlag.ADVANCED_SEARCH_CAPABILITIES]: 'Premium',
    [FeatureFlag.SESSION_CATEGORIZATION]: 'Premium',
    [FeatureFlag.CUSTOM_BRANDING]: 'Enterprise',
    [FeatureFlag.CUSTOM_LOGO_COLOR_SCHEME]: 'Enterprise',
    [FeatureFlag.WHITE_LABEL_PLATFORM]: 'Enterprise',
    [FeatureFlag.PREMIUM_USER_SUPPORT]: 'Premium',
    [FeatureFlag.PRIORITY_ASSISTANCE]: 'Premium',
    [FeatureFlag.PREMIUM_UI_COMPONENTS]: 'Premium'
  };

  return featureRequirements[feature] || 'Premium';
}

function shouldPromptUpgrade(userTier: UserTier, feature: FeatureFlag): boolean {
  const requirements = getFeatureRequirements(feature);
  
  if (requirements === 'Enterprise') {
    return userTier !== UserTier.ENTERPRISE;
  } else if (requirements === 'Premium') {
    return userTier === UserTier.FREE || userTier === UserTier.EMAIL_CAPTURED;
  }
  
  return false;
}

function hasTierAccess(userTier: UserTier, requiredTier: UserTier): boolean {
  const tierHierarchy = {
    [UserTier.FREE]: 0,
    [UserTier.EMAIL_CAPTURED]: 1,
    [UserTier.PREMIUM]: 2,
    [UserTier.ENTERPRISE]: 3
  };

  return tierHierarchy[userTier] >= tierHierarchy[requiredTier];
}

// Export types for use in other modules
export type { FeatureGatedRequest, FeatureGateConfig, UsageLimitConfig };