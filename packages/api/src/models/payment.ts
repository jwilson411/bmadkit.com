import { z } from 'zod';
import type { Stripe } from 'stripe';

// Payment status enumeration
export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REQUIRES_ACTION = 'requires_action',
  REQUIRES_CONFIRMATION = 'requires_confirmation',
  REQUIRES_PAYMENT_METHOD = 'requires_payment_method'
}

// Payment method types
export enum PaymentMethodType {
  CARD = 'card',
  BANK_ACCOUNT = 'us_bank_account',
  SEPA_DEBIT = 'sepa_debit',
  APPLE_PAY = 'apple_pay',
  GOOGLE_PAY = 'google_pay'
}

// Payment failure codes
export enum PaymentFailureCode {
  CARD_DECLINED = 'card_declined',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  EXPIRED_CARD = 'expired_card',
  INVALID_CVC = 'incorrect_cvc',
  PROCESSING_ERROR = 'processing_error',
  AUTHENTICATION_REQUIRED = 'authentication_required',
  GENERIC_DECLINE = 'generic_decline'
}

// Payment validation schemas
export const PaymentIntentSchema = z.object({
  id: z.string(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  status: z.nativeEnum(PaymentStatus),
  clientSecret: z.string().optional(),
  paymentMethodId: z.string().optional(),
  customerId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const PaymentMethodSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(PaymentMethodType),
  customerId: z.string(),
  isDefault: z.boolean().default(false),
  card: z.object({
    brand: z.string(),
    last4: z.string(),
    expMonth: z.number().min(1).max(12),
    expYear: z.number(),
    fingerprint: z.string().optional(),
    funding: z.enum(['credit', 'debit', 'prepaid', 'unknown']).optional()
  }).optional(),
  billingDetails: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional()
    }).optional()
  }).optional(),
  metadata: z.record(z.string()).optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const PaymentTransactionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  stripePaymentIntentId: z.string(),
  stripeChargeId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string(),
  status: z.nativeEnum(PaymentStatus),
  paymentMethodId: z.string().optional(),
  subscriptionId: z.string().optional(),
  invoiceId: z.string().optional(),
  description: z.string().optional(),
  failureCode: z.nativeEnum(PaymentFailureCode).optional(),
  failureMessage: z.string().optional(),
  receiptUrl: z.string().url().optional(),
  refunded: z.boolean().default(false),
  refundedAmount: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  processedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const RefundSchema = z.object({
  id: z.string(),
  paymentTransactionId: z.string(),
  stripeRefundId: z.string(),
  amount: z.number().positive(),
  currency: z.string(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
  status: z.enum(['pending', 'succeeded', 'failed', 'canceled']),
  receiptNumber: z.string().optional(),
  failureReason: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  processedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// Type definitions
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type PaymentTransaction = z.infer<typeof PaymentTransactionSchema>;
export type Refund = z.infer<typeof RefundSchema>;

// Payment processing request/response types
export interface CreatePaymentIntentRequest {
  amount: number;
  currency: string;
  paymentMethodId?: string;
  customerId?: string;
  description?: string;
  metadata?: Record<string, string>;
  automaticPaymentMethods?: boolean;
  returnUrl?: string;
}

export interface CreatePaymentIntentResponse {
  paymentIntent: {
    id: string;
    clientSecret: string;
    status: PaymentStatus;
    amount: number;
    currency: string;
  };
  requiresAction: boolean;
  error?: {
    code: string;
    message: string;
    type: string;
  };
}

export interface ConfirmPaymentRequest {
  paymentIntentId: string;
  paymentMethodId?: string;
  returnUrl?: string;
}

export interface ConfirmPaymentResponse {
  paymentIntent: {
    id: string;
    status: PaymentStatus;
    clientSecret?: string;
  };
  requiresAction: boolean;
  error?: {
    code: string;
    message: string;
    type: string;
  };
}

export interface ProcessRefundRequest {
  paymentTransactionId: string;
  amount?: number; // Partial refund amount
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  metadata?: Record<string, string>;
}

export interface ProcessRefundResponse {
  refund: {
    id: string;
    amount: number;
    status: string;
    receiptNumber?: string;
  };
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

// Payment method management types
export interface AttachPaymentMethodRequest {
  paymentMethodId: string;
  customerId: string;
  setAsDefault?: boolean;
}

export interface AttachPaymentMethodResponse {
  paymentMethod: {
    id: string;
    type: PaymentMethodType;
    card?: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    };
  };
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface UpdateDefaultPaymentMethodRequest {
  customerId: string;
  paymentMethodId: string;
}

export interface ListPaymentMethodsResponse {
  paymentMethods: Array<{
    id: string;
    type: PaymentMethodType;
    isDefault: boolean;
    card?: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    };
    billingDetails: {
      name?: string;
      email?: string;
    };
  }>;
}

// Payment analytics and reporting types
export interface PaymentMetrics {
  totalVolume: number;
  totalTransactions: number;
  successRate: number;
  averageTransactionAmount: number;
  topFailureReasons: Array<{
    reason: PaymentFailureCode;
    count: number;
    percentage: number;
  }>;
  monthlyTrend: Array<{
    month: string;
    volume: number;
    transactions: number;
    successRate: number;
  }>;
}

export interface PaymentFailureAnalysis {
  totalFailures: number;
  failureRate: number;
  topReasons: Array<{
    code: PaymentFailureCode;
    count: number;
    percentage: number;
    averageAmount: number;
  }>;
  retrySuccessRate: number;
  timeToResolution: {
    average: number; // minutes
    median: number;
    percentile95: number;
  };
}

// Utility functions for payment status handling
export const isPaymentSuccessful = (status: PaymentStatus): boolean => {
  return status === PaymentStatus.SUCCEEDED;
};

export const isPaymentFailed = (status: PaymentStatus): boolean => {
  return status === PaymentStatus.FAILED || status === PaymentStatus.CANCELED;
};

export const requiresUserAction = (status: PaymentStatus): boolean => {
  return status === PaymentStatus.REQUIRES_ACTION || 
         status === PaymentStatus.REQUIRES_CONFIRMATION ||
         status === PaymentStatus.REQUIRES_PAYMENT_METHOD;
};

export const canRetryPayment = (failureCode: PaymentFailureCode): boolean => {
  const retryableFailures = [
    PaymentFailureCode.PROCESSING_ERROR,
    PaymentFailureCode.AUTHENTICATION_REQUIRED,
    PaymentFailureCode.GENERIC_DECLINE
  ];
  return retryableFailures.includes(failureCode);
};

// Payment amount utilities
export const formatCurrency = (amount: number, currency: string = 'usd'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / 100); // Convert cents to dollars
};

export const convertToCents = (amount: number): number => {
  return Math.round(amount * 100);
};

export const convertFromCents = (amount: number): number => {
  return amount / 100;
};

// Payment validation utilities
export const validatePaymentAmount = (amount: number, currency: string = 'usd'): { valid: boolean; error?: string } => {
  // Stripe minimum amounts by currency
  const minimumAmounts: Record<string, number> = {
    usd: 50, // $0.50
    eur: 50, // €0.50
    gbp: 30, // £0.30
    cad: 50, // C$0.50
    aud: 50, // A$0.50
  };

  const minimum = minimumAmounts[currency.toLowerCase()] || 50;

  if (amount < minimum) {
    return {
      valid: false,
      error: `Amount must be at least ${formatCurrency(minimum, currency)}`
    };
  }

  if (amount > 99999999) { // $999,999.99
    return {
      valid: false,
      error: 'Amount exceeds maximum allowed'
    };
  }

  return { valid: true };
};

// Convert Stripe objects to our internal models
export const convertStripePaymentIntent = (stripePI: Stripe.PaymentIntent): PaymentIntent => {
  return {
    id: stripePI.id,
    amount: stripePI.amount,
    currency: stripePI.currency,
    status: stripePI.status as PaymentStatus,
    clientSecret: stripePI.client_secret || undefined,
    paymentMethodId: typeof stripePI.payment_method === 'string' ? stripePI.payment_method : undefined,
    customerId: typeof stripePI.customer === 'string' ? stripePI.customer : undefined,
    description: stripePI.description || undefined,
    metadata: stripePI.metadata || undefined,
    createdAt: new Date(stripePI.created * 1000),
    updatedAt: new Date() // Stripe doesn't provide updated timestamp
  };
};

export const convertStripePaymentMethod = (stripePM: Stripe.PaymentMethod, customerId: string): PaymentMethod => {
  return {
    id: stripePM.id,
    type: stripePM.type as PaymentMethodType,
    customerId,
    isDefault: false, // This would be determined by customer's default_payment_method
    card: stripePM.card ? {
      brand: stripePM.card.brand,
      last4: stripePM.card.last4,
      expMonth: stripePM.card.exp_month,
      expYear: stripePM.card.exp_year,
      fingerprint: stripePM.card.fingerprint || undefined,
      funding: stripePM.card.funding as 'credit' | 'debit' | 'prepaid' | 'unknown' | undefined
    } : undefined,
    billingDetails: stripePM.billing_details ? {
      name: stripePM.billing_details.name || undefined,
      email: stripePM.billing_details.email || undefined,
      phone: stripePM.billing_details.phone || undefined,
      address: stripePM.billing_details.address ? {
        line1: stripePM.billing_details.address.line1 || undefined,
        line2: stripePM.billing_details.address.line2 || undefined,
        city: stripePM.billing_details.address.city || undefined,
        state: stripePM.billing_details.address.state || undefined,
        postalCode: stripePM.billing_details.address.postal_code || undefined,
        country: stripePM.billing_details.address.country || undefined
      } : undefined
    } : undefined,
    metadata: stripePM.metadata || undefined,
    createdAt: new Date(stripePM.created * 1000),
    updatedAt: new Date()
  };
};