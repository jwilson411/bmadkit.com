import { z } from 'zod';
import type { Stripe } from 'stripe';

// Subscription status enumeration
export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
  CANCELED = 'canceled',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
  TRIALING = 'trialing',
  PAUSED = 'paused'
}

// Subscription plan types
export enum SubscriptionPlan {
  BASIC_MONTHLY = 'basic_monthly',
  BASIC_ANNUAL = 'basic_annual',
  PROFESSIONAL_MONTHLY = 'professional_monthly',
  PROFESSIONAL_ANNUAL = 'professional_annual',
  ENTERPRISE_MONTHLY = 'enterprise_monthly',
  ENTERPRISE_ANNUAL = 'enterprise_annual'
}

// Billing intervals
export enum BillingInterval {
  MONTH = 'month',
  YEAR = 'year',
  WEEK = 'week',
  DAY = 'day'
}

// Subscription cancellation reasons
export enum CancellationReason {
  USER_REQUESTED = 'user_requested',
  PAYMENT_FAILED = 'payment_failed',
  FRAUD_SUSPECTED = 'fraud_suspected',
  CHARGEBACK = 'chargeback',
  REFUND_REQUESTED = 'refund_requested',
  POLICY_VIOLATION = 'policy_violation',
  SYSTEM_ERROR = 'system_error'
}

// Subscription validation schemas
export const SubscriptionPriceSchema = z.object({
  id: z.string(),
  productId: z.string(),
  unitAmount: z.number().positive(),
  currency: z.string().min(3).max(3),
  interval: z.nativeEnum(BillingInterval),
  intervalCount: z.number().positive().default(1),
  trialPeriodDays: z.number().optional(),
  metadata: z.record(z.string()).optional(),
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const SubscriptionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  stripeSubscriptionId: z.string(),
  stripeCustomerId: z.string(),
  stripePriceId: z.string(),
  status: z.nativeEnum(SubscriptionStatus),
  plan: z.nativeEnum(SubscriptionPlan),
  currentPeriodStart: z.date(),
  currentPeriodEnd: z.date(),
  trialStart: z.date().optional(),
  trialEnd: z.date().optional(),
  canceledAt: z.date().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  cancellationReason: z.nativeEnum(CancellationReason).optional(),
  defaultPaymentMethodId: z.string().optional(),
  latestInvoiceId: z.string().optional(),
  quantity: z.number().positive().default(1),
  discountId: z.string().optional(),
  taxPercent: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const SubscriptionUsageSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  userId: z.string(),
  period: z.object({
    start: z.date(),
    end: z.date()
  }),
  usage: z.object({
    planningSessionsUsed: z.number().default(0),
    planningSessionsLimit: z.number(),
    documentsGenerated: z.number().default(0),
    documentsLimit: z.number(),
    storageUsedMB: z.number().default(0),
    storageLimitMB: z.number(),
    exportCount: z.number().default(0),
    exportLimit: z.number(),
    apiCallsUsed: z.number().default(0),
    apiCallsLimit: z.number()
  }),
  overages: z.object({
    planningSessionsOverage: z.number().default(0),
    documentsOverage: z.number().default(0),
    storageOverageMB: z.number().default(0),
    exportOverage: z.number().default(0),
    apiCallsOverage: z.number().default(0)
  }).optional(),
  metadata: z.record(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// Type definitions
export type SubscriptionPrice = z.infer<typeof SubscriptionPriceSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type SubscriptionUsage = z.infer<typeof SubscriptionUsageSchema>;

// Subscription plan configurations
export interface PlanConfiguration {
  id: SubscriptionPlan;
  name: string;
  description: string;
  features: string[];
  limits: {
    planningSessionsPerMonth: number;
    documentsPerMonth: number;
    storageGB: number;
    exportsPerMonth: number;
    apiCallsPerDay: number;
    teamMembers: number;
  };
  pricing: {
    monthly: number; // in cents
    annual: number; // in cents
    annualDiscount: number; // percentage
  };
  trialDays: number;
  stripePriceIds: {
    monthly: string;
    annual: string;
  };
}

export const PLAN_CONFIGURATIONS: Record<SubscriptionPlan, PlanConfiguration> = {
  [SubscriptionPlan.BASIC_MONTHLY]: {
    id: SubscriptionPlan.BASIC_MONTHLY,
    name: 'Basic',
    description: 'Perfect for individual consultants and small projects',
    features: [
      'Up to 10 planning sessions per month',
      'Basic document generation',
      '5GB storage',
      'PDF export',
      'Email support'
    ],
    limits: {
      planningSessionsPerMonth: 10,
      documentsPerMonth: 50,
      storageGB: 5,
      exportsPerMonth: 20,
      apiCallsPerDay: 1000,
      teamMembers: 1
    },
    pricing: {
      monthly: 2999, // $29.99
      annual: 29990, // $299.90 (save $60)
      annualDiscount: 17
    },
    trialDays: 14,
    stripePriceIds: {
      monthly: 'price_basic_monthly',
      annual: 'price_basic_annual'
    }
  },
  [SubscriptionPlan.BASIC_ANNUAL]: {
    id: SubscriptionPlan.BASIC_ANNUAL,
    name: 'Basic Annual',
    description: 'Basic plan billed annually with savings',
    features: [
      'Up to 10 planning sessions per month',
      'Basic document generation',
      '5GB storage',
      'PDF export',
      'Email support',
      '17% annual savings'
    ],
    limits: {
      planningSessionsPerMonth: 10,
      documentsPerMonth: 50,
      storageGB: 5,
      exportsPerMonth: 20,
      apiCallsPerDay: 1000,
      teamMembers: 1
    },
    pricing: {
      monthly: 2999,
      annual: 29990,
      annualDiscount: 17
    },
    trialDays: 14,
    stripePriceIds: {
      monthly: 'price_basic_monthly',
      annual: 'price_basic_annual'
    }
  },
  [SubscriptionPlan.PROFESSIONAL_MONTHLY]: {
    id: SubscriptionPlan.PROFESSIONAL_MONTHLY,
    name: 'Professional',
    description: 'For growing consultancies and teams',
    features: [
      'Up to 50 planning sessions per month',
      'Advanced document templates',
      '50GB storage',
      'Multiple export formats',
      'Priority support',
      'Team collaboration',
      'Custom branding'
    ],
    limits: {
      planningSessionsPerMonth: 50,
      documentsPerMonth: 200,
      storageGB: 50,
      exportsPerMonth: 100,
      apiCallsPerDay: 5000,
      teamMembers: 5
    },
    pricing: {
      monthly: 7999, // $79.99
      annual: 79990, // $799.90 (save $160)
      annualDiscount: 17
    },
    trialDays: 14,
    stripePriceIds: {
      monthly: 'price_professional_monthly',
      annual: 'price_professional_annual'
    }
  },
  [SubscriptionPlan.PROFESSIONAL_ANNUAL]: {
    id: SubscriptionPlan.PROFESSIONAL_ANNUAL,
    name: 'Professional Annual',
    description: 'Professional plan billed annually with savings',
    features: [
      'Up to 50 planning sessions per month',
      'Advanced document templates',
      '50GB storage',
      'Multiple export formats',
      'Priority support',
      'Team collaboration',
      'Custom branding',
      '17% annual savings'
    ],
    limits: {
      planningSessionsPerMonth: 50,
      documentsPerMonth: 200,
      storageGB: 50,
      exportsPerMonth: 100,
      apiCallsPerDay: 5000,
      teamMembers: 5
    },
    pricing: {
      monthly: 7999,
      annual: 79990,
      annualDiscount: 17
    },
    trialDays: 14,
    stripePriceIds: {
      monthly: 'price_professional_monthly',
      annual: 'price_professional_annual'
    }
  },
  [SubscriptionPlan.ENTERPRISE_MONTHLY]: {
    id: SubscriptionPlan.ENTERPRISE_MONTHLY,
    name: 'Enterprise',
    description: 'For large organizations with custom needs',
    features: [
      'Unlimited planning sessions',
      'Custom document templates',
      'Unlimited storage',
      'All export formats',
      'Dedicated support',
      'Advanced team management',
      'White-label solutions',
      'API access',
      'Custom integrations'
    ],
    limits: {
      planningSessionsPerMonth: -1, // Unlimited
      documentsPerMonth: -1, // Unlimited
      storageGB: -1, // Unlimited
      exportsPerMonth: -1, // Unlimited
      apiCallsPerDay: 50000,
      teamMembers: -1 // Unlimited
    },
    pricing: {
      monthly: 19999, // $199.99
      annual: 199990, // $1999.90 (save $400)
      annualDiscount: 17
    },
    trialDays: 30,
    stripePriceIds: {
      monthly: 'price_enterprise_monthly',
      annual: 'price_enterprise_annual'
    }
  },
  [SubscriptionPlan.ENTERPRISE_ANNUAL]: {
    id: SubscriptionPlan.ENTERPRISE_ANNUAL,
    name: 'Enterprise Annual',
    description: 'Enterprise plan billed annually with savings',
    features: [
      'Unlimited planning sessions',
      'Custom document templates',
      'Unlimited storage',
      'All export formats',
      'Dedicated support',
      'Advanced team management',
      'White-label solutions',
      'API access',
      'Custom integrations',
      '17% annual savings'
    ],
    limits: {
      planningSessionsPerMonth: -1,
      documentsPerMonth: -1,
      storageGB: -1,
      exportsPerMonth: -1,
      apiCallsPerDay: 50000,
      teamMembers: -1
    },
    pricing: {
      monthly: 19999,
      annual: 199990,
      annualDiscount: 17
    },
    trialDays: 30,
    stripePriceIds: {
      monthly: 'price_enterprise_monthly',
      annual: 'price_enterprise_annual'
    }
  }
};

// Subscription request/response types
export interface CreateSubscriptionRequest {
  userId: string;
  plan: SubscriptionPlan;
  paymentMethodId?: string;
  couponCode?: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export interface CreateSubscriptionResponse {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    currentPeriodEnd: Date;
    trialEnd?: Date;
    clientSecret?: string; // For incomplete subscriptions requiring payment
  };
  requiresPaymentMethod: boolean;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface UpdateSubscriptionRequest {
  subscriptionId: string;
  newPlan?: SubscriptionPlan;
  paymentMethodId?: string;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
  metadata?: Record<string, string>;
}

export interface UpdateSubscriptionResponse {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    currentPeriodEnd: Date;
    plan: SubscriptionPlan;
  };
  prorationAmount?: number;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface CancelSubscriptionRequest {
  subscriptionId: string;
  immediately?: boolean;
  reason?: CancellationReason;
  feedback?: string;
}

export interface CancelSubscriptionResponse {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    canceledAt: Date;
    currentPeriodEnd: Date;
  };
  refundAmount?: number;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

// Subscription analytics types
export interface SubscriptionMetrics {
  totalActiveSubscriptions: number;
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  annualRecurringRevenue: number;
  churnRate: number;
  averageRevenuePerUser: number;
  lifetimeValue: number;
  conversionRate: number;
  trialToSubscriptionRate: number;
  planDistribution: Record<SubscriptionPlan, {
    count: number;
    percentage: number;
    revenue: number;
  }>;
  revenueByPeriod: Array<{
    period: string;
    newRevenue: number;
    recurringRevenue: number;
    churnedRevenue: number;
    netRevenue: number;
  }>;
}

export interface ChurnAnalysis {
  churnRate: number;
  churnReasons: Record<CancellationReason, {
    count: number;
    percentage: number;
  }>;
  churnByPlan: Record<SubscriptionPlan, {
    churnRate: number;
    averageTenure: number; // days
  }>;
  voluntaryChurnRate: number;
  involuntaryChurnRate: number;
  winBackOpportunities: number;
}

// Utility functions
export const isActiveSubscription = (status: SubscriptionStatus): boolean => {
  return status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING;
};

export const requiresPayment = (status: SubscriptionStatus): boolean => {
  return status === SubscriptionStatus.INCOMPLETE || 
         status === SubscriptionStatus.PAST_DUE || 
         status === SubscriptionStatus.UNPAID;
};

export const isTrialSubscription = (subscription: Subscription): boolean => {
  return subscription.status === SubscriptionStatus.TRIALING && 
         subscription.trialEnd !== undefined && 
         subscription.trialEnd > new Date();
};

export const getDaysUntilRenewal = (subscription: Subscription): number => {
  const now = new Date();
  const periodEnd = subscription.currentPeriodEnd;
  const diffTime = periodEnd.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const calculateProrationAmount = (
  currentPlan: PlanConfiguration,
  newPlan: PlanConfiguration,
  daysRemaining: number,
  billingInterval: BillingInterval
): number => {
  const daysInInterval = billingInterval === BillingInterval.MONTH ? 30 : 365;
  const currentDailyRate = (billingInterval === BillingInterval.MONTH ? 
    currentPlan.pricing.monthly : currentPlan.pricing.annual) / daysInInterval;
  const newDailyRate = (billingInterval === BillingInterval.MONTH ? 
    newPlan.pricing.monthly : newPlan.pricing.annual) / daysInInterval;
  
  const currentCredit = currentDailyRate * daysRemaining;
  const newCharge = newDailyRate * daysRemaining;
  
  return newCharge - currentCredit;
};

export const formatSubscriptionPeriod = (subscription: Subscription): string => {
  const start = subscription.currentPeriodStart.toLocaleDateString();
  const end = subscription.currentPeriodEnd.toLocaleDateString();
  return `${start} - ${end}`;
};

export const getUsagePercentage = (used: number, limit: number): number => {
  if (limit === -1) return 0; // Unlimited
  return Math.min(100, (used / limit) * 100);
};

export const checkUsageLimits = (usage: SubscriptionUsage['usage']): {
  planningSessionsExceeded: boolean;
  documentsExceeded: boolean;
  storageExceeded: boolean;
  exportsExceeded: boolean;
  apiCallsExceeded: boolean;
} => {
  return {
    planningSessionsExceeded: usage.planningSessionsLimit !== -1 && 
      usage.planningSessionsUsed >= usage.planningSessionsLimit,
    documentsExceeded: usage.documentsLimit !== -1 && 
      usage.documentsGenerated >= usage.documentsLimit,
    storageExceeded: usage.storageLimitMB !== -1 && 
      usage.storageUsedMB >= usage.storageLimitMB,
    exportsExceeded: usage.exportLimit !== -1 && 
      usage.exportCount >= usage.exportLimit,
    apiCallsExceeded: usage.apiCallsLimit !== -1 && 
      usage.apiCallsUsed >= usage.apiCallsLimit
  };
};

// Convert Stripe subscription to our internal model
export const convertStripeSubscription = (
  stripeSubscription: Stripe.Subscription,
  userId: string,
  plan: SubscriptionPlan
): Subscription => {
  return {
    id: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    stripeSubscriptionId: stripeSubscription.id,
    stripeCustomerId: typeof stripeSubscription.customer === 'string' ? 
      stripeSubscription.customer : stripeSubscription.customer.id,
    stripePriceId: stripeSubscription.items.data[0].price.id,
    status: stripeSubscription.status as SubscriptionStatus,
    plan,
    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    trialStart: stripeSubscription.trial_start ? 
      new Date(stripeSubscription.trial_start * 1000) : undefined,
    trialEnd: stripeSubscription.trial_end ? 
      new Date(stripeSubscription.trial_end * 1000) : undefined,
    canceledAt: stripeSubscription.canceled_at ? 
      new Date(stripeSubscription.canceled_at * 1000) : undefined,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    defaultPaymentMethodId: typeof stripeSubscription.default_payment_method === 'string' ? 
      stripeSubscription.default_payment_method : undefined,
    latestInvoiceId: typeof stripeSubscription.latest_invoice === 'string' ? 
      stripeSubscription.latest_invoice : undefined,
    quantity: stripeSubscription.items.data[0].quantity || 1,
    metadata: stripeSubscription.metadata,
    createdAt: new Date(stripeSubscription.created * 1000),
    updatedAt: new Date()
  };
};