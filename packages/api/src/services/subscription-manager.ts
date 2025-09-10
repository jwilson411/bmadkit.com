import { z } from 'zod';
import type { Stripe } from 'stripe';
import { stripeClient } from '../utils/stripe-client';
import {
  Subscription,
  SubscriptionStatus,
  SubscriptionPlan,
  SubscriptionUsage,
  BillingInterval,
  CancellationReason,
  PLAN_CONFIGURATIONS,
  convertStripeSubscription,
  isActiveSubscription,
  calculateProrationAmount,
  type CreateSubscriptionRequest,
  type CreateSubscriptionResponse,
  type UpdateSubscriptionRequest,
  type UpdateSubscriptionResponse,
  type CancelSubscriptionRequest,
  type CancelSubscriptionResponse
} from '../models/subscription';
import { EventEmitter } from 'events';

// Subscription events
export enum SubscriptionEvent {
  CREATED = 'subscription.created',
  UPDATED = 'subscription.updated',
  CANCELED = 'subscription.canceled',
  REACTIVATED = 'subscription.reactivated',
  TRIAL_ENDED = 'subscription.trial_ended',
  PAYMENT_FAILED = 'subscription.payment_failed',
  PAYMENT_SUCCEEDED = 'subscription.payment_succeeded',
  PLAN_CHANGED = 'subscription.plan_changed',
  USAGE_EXCEEDED = 'subscription.usage_exceeded'
}

// Subscription validation schemas
const CreateSubscriptionSchema = z.object({
  userId: z.string().min(1),
  plan: z.nativeEnum(SubscriptionPlan),
  paymentMethodId: z.string().optional(),
  couponCode: z.string().optional(),
  trialDays: z.number().min(0).max(365).optional(),
  metadata: z.record(z.string()).optional()
});

const UpdateSubscriptionSchema = z.object({
  subscriptionId: z.string().min(1),
  newPlan: z.nativeEnum(SubscriptionPlan).optional(),
  paymentMethodId: z.string().optional(),
  prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']).default('create_prorations'),
  metadata: z.record(z.string()).optional()
});

const CancelSubscriptionSchema = z.object({
  subscriptionId: z.string().min(1),
  immediately: z.boolean().default(false),
  reason: z.nativeEnum(CancellationReason).optional(),
  feedback: z.string().optional()
});

export class SubscriptionManager extends EventEmitter {
  private static instance: SubscriptionManager;
  private stripe: Stripe;

  // In-memory cache for subscription data (in production, use Redis)
  private subscriptionCache: Map<string, Subscription> = new Map();
  private usageCache: Map<string, SubscriptionUsage> = new Map();

  private constructor() {
    super();
    this.stripe = stripeClient.getStripeClient();
    this.setupEventHandlers();
  }

  static getInstance(): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager();
    }
    return SubscriptionManager.instance;
  }

  /**
   * Create a new subscription
   */
  async createSubscription(request: CreateSubscriptionRequest): Promise<CreateSubscriptionResponse> {
    try {
      // Validate request
      const validatedRequest = CreateSubscriptionSchema.parse(request);
      const { userId, plan, paymentMethodId, couponCode, trialDays, metadata = {} } = validatedRequest;

      // Get plan configuration
      const planConfig = PLAN_CONFIGURATIONS[plan];
      if (!planConfig) {
        throw new Error(`Invalid subscription plan: ${plan}`);
      }

      // Determine price ID based on plan
      const isAnnual = plan.includes('ANNUAL');
      const stripePriceId = isAnnual ? planConfig.stripePriceIds.annual : planConfig.stripePriceIds.monthly;

      // Check if customer exists or create new one
      let customerId: string;
      try {
        // In a real implementation, you would get user details from your database
        const customer = await stripeClient.createCustomer({
          email: `user_${userId}@example.com`, // This should come from your user service
          metadata: {
            userId,
            plan,
            environment: process.env.NODE_ENV || 'development'
          }
        });
        customerId = customer.id;
      } catch (error) {
        throw new Error(`Failed to create customer: ${error}`);
      }

      // Create subscription parameters
      const subscriptionParams = {
        customerId,
        priceId: stripePriceId,
        paymentMethodId,
        trialPeriodDays: trialDays ?? planConfig.trialDays,
        metadata: {
          ...metadata,
          userId,
          plan,
          createdBy: 'subscription-manager',
          createdAt: new Date().toISOString()
        },
        couponId: couponCode
      };

      // Create subscription in Stripe
      const stripeSubscription = await stripeClient.createSubscription(subscriptionParams);

      // Convert to internal model
      const subscription = convertStripeSubscription(stripeSubscription, userId, plan);

      // Cache the subscription
      this.subscriptionCache.set(subscription.id, subscription);

      // Initialize usage tracking
      await this.initializeUsageTracking(subscription);

      // Emit event
      this.emit(SubscriptionEvent.CREATED, { subscription, userId });

      // Prepare response
      const response: CreateSubscriptionResponse = {
        subscription: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialEnd: subscription.trialEnd
        },
        requiresPaymentMethod: subscription.status === SubscriptionStatus.INCOMPLETE,
        success: true
      };

      // Add client secret for incomplete subscriptions
      if (stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object') {
        const invoice = stripeSubscription.latest_invoice as Stripe.Invoice;
        if (invoice.payment_intent && typeof invoice.payment_intent === 'object') {
          const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;
          response.subscription.clientSecret = paymentIntent.client_secret || undefined;
        }
      }

      return response;

    } catch (error) {
      return {
        subscription: {
          id: '',
          status: SubscriptionStatus.INCOMPLETE,
          currentPeriodEnd: new Date()
        },
        requiresPaymentMethod: false,
        success: false,
        error: {
          code: 'SUBSCRIPTION_CREATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
  }

  /**
   * Update an existing subscription
   */
  async updateSubscription(request: UpdateSubscriptionRequest): Promise<UpdateSubscriptionResponse> {
    try {
      // Validate request
      const validatedRequest = UpdateSubscriptionSchema.parse(request);
      const { subscriptionId, newPlan, paymentMethodId, prorationBehavior, metadata = {} } = validatedRequest;

      // Get current subscription
      const currentSubscription = await this.getSubscription(subscriptionId);
      if (!currentSubscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }

      // If changing plan, calculate proration
      let prorationAmount = 0;
      let newStripePriceId: string | undefined;

      if (newPlan && newPlan !== currentSubscription.plan) {
        const currentPlanConfig = PLAN_CONFIGURATIONS[currentSubscription.plan];
        const newPlanConfig = PLAN_CONFIGURATIONS[newPlan];

        if (!newPlanConfig) {
          throw new Error(`Invalid new plan: ${newPlan}`);
        }

        // Determine price ID for new plan
        const isAnnual = newPlan.includes('ANNUAL');
        newStripePriceId = isAnnual ? newPlanConfig.stripePriceIds.annual : newPlanConfig.stripePriceIds.monthly;

        // Calculate proration if needed
        if (prorationBehavior === 'create_prorations') {
          const daysRemaining = Math.ceil(
            (currentSubscription.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          const billingInterval = isAnnual ? BillingInterval.YEAR : BillingInterval.MONTH;
          prorationAmount = calculateProrationAmount(currentPlanConfig, newPlanConfig, daysRemaining, billingInterval);
        }
      }

      // Update subscription in Stripe
      const updateParams: any = {
        subscriptionId: currentSubscription.stripeSubscriptionId,
        prorationBehavior,
        paymentMethodId,
        metadata: {
          ...metadata,
          updatedBy: 'subscription-manager',
          updatedAt: new Date().toISOString()
        }
      };

      if (newStripePriceId) {
        updateParams.newPriceId = newStripePriceId;
      }

      const stripeSubscription = await stripeClient.updateSubscription(updateParams);

      // Convert updated subscription
      const updatedSubscription = convertStripeSubscription(
        stripeSubscription,
        currentSubscription.userId,
        newPlan || currentSubscription.plan
      );

      // Update cache
      this.subscriptionCache.set(updatedSubscription.id, updatedSubscription);

      // Update usage tracking if plan changed
      if (newPlan && newPlan !== currentSubscription.plan) {
        await this.updateUsageLimits(updatedSubscription);
        this.emit(SubscriptionEvent.PLAN_CHANGED, {
          subscription: updatedSubscription,
          previousPlan: currentSubscription.plan,
          newPlan
        });
      }

      // Emit event
      this.emit(SubscriptionEvent.UPDATED, { subscription: updatedSubscription });

      return {
        subscription: {
          id: updatedSubscription.id,
          status: updatedSubscription.status,
          currentPeriodEnd: updatedSubscription.currentPeriodEnd,
          plan: updatedSubscription.plan
        },
        prorationAmount: prorationAmount !== 0 ? prorationAmount : undefined,
        success: true
      };

    } catch (error) {
      return {
        subscription: {
          id: subscriptionId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(),
          plan: SubscriptionPlan.BASIC_MONTHLY
        },
        success: false,
        error: {
          code: 'SUBSCRIPTION_UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(request: CancelSubscriptionRequest): Promise<CancelSubscriptionResponse> {
    try {
      // Validate request
      const validatedRequest = CancelSubscriptionSchema.parse(request);
      const { subscriptionId, immediately, reason, feedback } = validatedRequest;

      // Get current subscription
      const currentSubscription = await this.getSubscription(subscriptionId);
      if (!currentSubscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }

      // Cancel subscription in Stripe
      const cancelParams = {
        subscriptionId: currentSubscription.stripeSubscriptionId,
        immediately: immediately || false,
        invoiceNow: false,
        prorate: true
      };

      const stripeSubscription = await stripeClient.cancelSubscription(cancelParams);

      // Update subscription model
      const canceledSubscription: Subscription = {
        ...currentSubscription,
        status: stripeSubscription.status as SubscriptionStatus,
        canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : new Date(),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        cancellationReason: reason,
        metadata: {
          ...currentSubscription.metadata,
          cancellationFeedback: feedback,
          canceledBy: 'subscription-manager',
          canceledAt: new Date().toISOString()
        },
        updatedAt: new Date()
      };

      // Update cache
      this.subscriptionCache.set(canceledSubscription.id, canceledSubscription);

      // Emit event
      this.emit(SubscriptionEvent.CANCELED, {
        subscription: canceledSubscription,
        reason,
        feedback,
        immediately
      });

      return {
        subscription: {
          id: canceledSubscription.id,
          status: canceledSubscription.status,
          canceledAt: canceledSubscription.canceledAt!,
          currentPeriodEnd: canceledSubscription.currentPeriodEnd
        },
        success: true
      };

    } catch (error) {
      return {
        subscription: {
          id: subscriptionId,
          status: SubscriptionStatus.ACTIVE,
          canceledAt: new Date(),
          currentPeriodEnd: new Date()
        },
        success: false,
        error: {
          code: 'SUBSCRIPTION_CANCELLATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
  }

  /**
   * Reactivate a canceled subscription
   */
  async reactivateSubscription(subscriptionId: string): Promise<{ success: boolean; subscription?: Subscription; error?: string }> {
    try {
      const currentSubscription = await this.getSubscription(subscriptionId);
      if (!currentSubscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
      }

      if (currentSubscription.status !== SubscriptionStatus.CANCELED) {
        throw new Error('Only canceled subscriptions can be reactivated');
      }

      // Reactivate in Stripe by removing cancel_at_period_end
      const stripeSubscription = await this.stripe.subscriptions.update(
        currentSubscription.stripeSubscriptionId,
        {
          cancel_at_period_end: false,
          metadata: {
            ...currentSubscription.metadata,
            reactivatedBy: 'subscription-manager',
            reactivatedAt: new Date().toISOString()
          }
        }
      );

      const reactivatedSubscription = convertStripeSubscription(
        stripeSubscription,
        currentSubscription.userId,
        currentSubscription.plan
      );

      // Update cache
      this.subscriptionCache.set(reactivatedSubscription.id, reactivatedSubscription);

      // Emit event
      this.emit(SubscriptionEvent.REACTIVATED, { subscription: reactivatedSubscription });

      return {
        success: true,
        subscription: reactivatedSubscription
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<Subscription | null> {
    // Check cache first
    if (this.subscriptionCache.has(subscriptionId)) {
      return this.subscriptionCache.get(subscriptionId)!;
    }

    // In a real implementation, fetch from database
    // For now, return null if not in cache
    return null;
  }

  /**
   * Get subscriptions by user ID
   */
  async getUserSubscriptions(userId: string): Promise<Subscription[]> {
    // In a real implementation, this would query the database
    const userSubscriptions = Array.from(this.subscriptionCache.values())
      .filter(subscription => subscription.userId === userId);

    return userSubscriptions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get active subscription for user
   */
  async getActiveUserSubscription(userId: string): Promise<Subscription | null> {
    const subscriptions = await this.getUserSubscriptions(userId);
    return subscriptions.find(sub => isActiveSubscription(sub.status)) || null;
  }

  /**
   * Track usage for subscription
   */
  async trackUsage(subscriptionId: string, usageType: keyof SubscriptionUsage['usage'], amount: number = 1): Promise<void> {
    try {
      const subscription = await this.getSubscription(subscriptionId);
      if (!subscription || !isActiveSubscription(subscription.status)) {
        return; // Don't track usage for inactive subscriptions
      }

      const currentUsage = this.usageCache.get(subscriptionId) || await this.getUsageForCurrentPeriod(subscriptionId);
      if (!currentUsage) {
        await this.initializeUsageTracking(subscription);
        return;
      }

      // Update usage
      const updatedUsage: SubscriptionUsage = {
        ...currentUsage,
        usage: {
          ...currentUsage.usage,
          [usageType]: currentUsage.usage[usageType] + amount
        },
        updatedAt: new Date()
      };

      // Check for overages
      const planConfig = PLAN_CONFIGURATIONS[subscription.plan];
      const limits = planConfig.limits;

      const checkOverage = (used: number, limit: number, currentOverage: number): number => {
        if (limit === -1) return 0; // Unlimited
        return Math.max(0, used - limit);
      };

      updatedUsage.overages = {
        planningSessionsOverage: checkOverage(
          updatedUsage.usage.planningSessionsUsed,
          limits.planningSessionsPerMonth,
          updatedUsage.overages?.planningSessionsOverage || 0
        ),
        documentsOverage: checkOverage(
          updatedUsage.usage.documentsGenerated,
          limits.documentsPerMonth,
          updatedUsage.overages?.documentsOverage || 0
        ),
        storageOverageMB: checkOverage(
          updatedUsage.usage.storageUsedMB,
          limits.storageGB * 1024,
          updatedUsage.overages?.storageOverageMB || 0
        ),
        exportOverage: checkOverage(
          updatedUsage.usage.exportCount,
          limits.exportsPerMonth,
          updatedUsage.overages?.exportOverage || 0
        ),
        apiCallsOverage: checkOverage(
          updatedUsage.usage.apiCallsUsed,
          limits.apiCallsPerDay,
          updatedUsage.overages?.apiCallsOverage || 0
        )
      };

      // Update cache
      this.usageCache.set(subscriptionId, updatedUsage);

      // Check if usage limits exceeded
      const hasOverages = Object.values(updatedUsage.overages).some(overage => overage > 0);
      if (hasOverages) {
        this.emit(SubscriptionEvent.USAGE_EXCEEDED, {
          subscription,
          usage: updatedUsage
        });
      }

      // In a real implementation, persist to database here

    } catch (error) {
      console.error('Error tracking usage:', error);
    }
  }

  /**
   * Get usage for current billing period
   */
  async getCurrentUsage(subscriptionId: string): Promise<SubscriptionUsage | null> {
    return this.usageCache.get(subscriptionId) || await this.getUsageForCurrentPeriod(subscriptionId);
  }

  /**
   * Initialize usage tracking for new subscription
   */
  private async initializeUsageTracking(subscription: Subscription): Promise<void> {
    const planConfig = PLAN_CONFIGURATIONS[subscription.plan];
    
    const usage: SubscriptionUsage = {
      id: `usage_${subscription.id}_${Date.now()}`,
      subscriptionId: subscription.id,
      userId: subscription.userId,
      period: {
        start: subscription.currentPeriodStart,
        end: subscription.currentPeriodEnd
      },
      usage: {
        planningSessionsUsed: 0,
        planningSessionsLimit: planConfig.limits.planningSessionsPerMonth,
        documentsGenerated: 0,
        documentsLimit: planConfig.limits.documentsPerMonth,
        storageUsedMB: 0,
        storageLimitMB: planConfig.limits.storageGB * 1024,
        exportCount: 0,
        exportLimit: planConfig.limits.exportsPerMonth,
        apiCallsUsed: 0,
        apiCallsLimit: planConfig.limits.apiCallsPerDay
      },
      overages: {
        planningSessionsOverage: 0,
        documentsOverage: 0,
        storageOverageMB: 0,
        exportOverage: 0,
        apiCallsOverage: 0
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.usageCache.set(subscription.id, usage);
  }

  /**
   * Update usage limits when plan changes
   */
  private async updateUsageLimits(subscription: Subscription): Promise<void> {
    const currentUsage = this.usageCache.get(subscription.id);
    if (!currentUsage) return;

    const planConfig = PLAN_CONFIGURATIONS[subscription.plan];
    
    const updatedUsage: SubscriptionUsage = {
      ...currentUsage,
      usage: {
        ...currentUsage.usage,
        planningSessionsLimit: planConfig.limits.planningSessionsPerMonth,
        documentsLimit: planConfig.limits.documentsPerMonth,
        storageLimitMB: planConfig.limits.storageGB * 1024,
        exportLimit: planConfig.limits.exportsPerMonth,
        apiCallsLimit: planConfig.limits.apiCallsPerDay
      },
      updatedAt: new Date()
    };

    this.usageCache.set(subscription.id, updatedUsage);
  }

  /**
   * Get usage for current period (would query database in real implementation)
   */
  private async getUsageForCurrentPeriod(subscriptionId: string): Promise<SubscriptionUsage | null> {
    // In a real implementation, this would query the database
    // For now, return null if not in cache
    return null;
  }

  /**
   * Set up event handlers for subscription lifecycle
   */
  private setupEventHandlers(): void {
    this.on(SubscriptionEvent.CREATED, (data) => {
      console.log('Subscription created:', data.subscription.id);
      // In production, you might send welcome emails, update analytics, etc.
    });

    this.on(SubscriptionEvent.CANCELED, (data) => {
      console.log('Subscription canceled:', data.subscription.id, 'Reason:', data.reason);
      // In production, you might send cancellation emails, update analytics, etc.
    });

    this.on(SubscriptionEvent.USAGE_EXCEEDED, (data) => {
      console.log('Usage exceeded for subscription:', data.subscription.id);
      // In production, you might send notifications, upgrade prompts, etc.
    });
  }

  /**
   * Health check for subscription service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      // Check Stripe connectivity
      const stripeHealth = await stripeClient.healthCheck();
      
      const details = {
        stripe: stripeHealth,
        cacheSize: this.subscriptionCache.size,
        usageCacheSize: this.usageCache.size,
        timestamp: new Date()
      };

      const status = stripeHealth.status === 'healthy' ? 'healthy' : 'degraded';

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
}

// Export singleton instance
export const subscriptionManager = SubscriptionManager.getInstance();
export default subscriptionManager;