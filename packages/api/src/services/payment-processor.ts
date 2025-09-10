import { z } from 'zod';
import type { Stripe } from 'stripe';
import { stripeClient } from '../utils/stripe-client';
import {
  PaymentTransaction,
  PaymentStatus,
  PaymentFailureCode,
  PaymentMethodType,
  Refund,
  convertStripePaymentIntent,
  convertStripePaymentMethod,
  validatePaymentAmount,
  canRetryPayment,
  type CreatePaymentIntentRequest,
  type CreatePaymentIntentResponse,
  type ConfirmPaymentRequest,
  type ConfirmPaymentResponse,
  type ProcessRefundRequest,
  type ProcessRefundResponse,
  type AttachPaymentMethodRequest,
  type AttachPaymentMethodResponse
} from '../models/payment';
import { EventEmitter } from 'events';

// Payment processor events
export enum PaymentEvent {
  PAYMENT_CREATED = 'payment.created',
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REQUIRES_ACTION = 'payment.requires_action',
  REFUND_CREATED = 'refund.created',
  REFUND_SUCCEEDED = 'refund.succeeded',
  REFUND_FAILED = 'refund.failed',
  PAYMENT_METHOD_ATTACHED = 'payment_method.attached',
  PAYMENT_METHOD_DETACHED = 'payment_method.detached',
  FRAUD_DETECTED = 'fraud.detected'
}

// Payment validation schemas
const CreatePaymentIntentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default('usd'),
  paymentMethodId: z.string().optional(),
  customerId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  automaticPaymentMethods: z.boolean().default(true),
  returnUrl: z.string().url().optional()
});

const ConfirmPaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
  paymentMethodId: z.string().optional(),
  returnUrl: z.string().url().optional()
});

const ProcessRefundSchema = z.object({
  paymentTransactionId: z.string().min(1),
  amount: z.number().positive().optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).default('requested_by_customer'),
  metadata: z.record(z.string()).optional()
});

const AttachPaymentMethodSchema = z.object({
  paymentMethodId: z.string().min(1),
  customerId: z.string().min(1),
  setAsDefault: z.boolean().default(false)
});

// Retry configuration for failed payments
interface PaymentRetryConfig {
  maxRetries: number;
  retryIntervals: number[]; // in minutes
  retryableFailureCodes: PaymentFailureCode[];
}

const DEFAULT_RETRY_CONFIG: PaymentRetryConfig = {
  maxRetries: 3,
  retryIntervals: [5, 30, 180], // 5 min, 30 min, 3 hours
  retryableFailureCodes: [
    PaymentFailureCode.PROCESSING_ERROR,
    PaymentFailureCode.AUTHENTICATION_REQUIRED,
    PaymentFailureCode.GENERIC_DECLINE
  ]
};

export class PaymentProcessor extends EventEmitter {
  private static instance: PaymentProcessor;
  private stripe: Stripe;
  private retryConfig: PaymentRetryConfig;

  // In-memory cache for payment data (in production, use Redis)
  private paymentCache: Map<string, PaymentTransaction> = new Map();
  private refundCache: Map<string, Refund> = new Map();
  private retryQueue: Map<string, { attempts: number; nextRetry: Date; paymentIntentId: string }> = new Map();

  private constructor(retryConfig?: Partial<PaymentRetryConfig>) {
    super();
    this.stripe = stripeClient.getStripeClient();
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.setupEventHandlers();
    this.startRetryProcessor();
  }

  static getInstance(retryConfig?: Partial<PaymentRetryConfig>): PaymentProcessor {
    if (!PaymentProcessor.instance) {
      PaymentProcessor.instance = new PaymentProcessor(retryConfig);
    }
    return PaymentProcessor.instance;
  }

  /**
   * Create a payment intent
   */
  async createPaymentIntent(request: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
    try {
      // Validate request
      const validatedRequest = CreatePaymentIntentSchema.parse(request);
      const { amount, currency, paymentMethodId, customerId, description, metadata = {}, automaticPaymentMethods, returnUrl } = validatedRequest;

      // Validate amount
      const amountValidation = validatePaymentAmount(amount, currency);
      if (!amountValidation.valid) {
        throw new Error(amountValidation.error);
      }

      // Create payment intent in Stripe
      const stripePaymentIntent = await stripeClient.createPaymentIntent({
        amount,
        currency,
        customerId,
        paymentMethodId,
        description,
        metadata: {
          ...metadata,
          created_by: 'payment-processor',
          created_at: new Date().toISOString()
        },
        automaticPaymentMethods
      });

      // Convert to internal model
      const paymentIntent = convertStripePaymentIntent(stripePaymentIntent);

      // Create payment transaction record
      const paymentTransaction: PaymentTransaction = {
        id: `pt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: customerId || `user_${Date.now()}`, // In real implementation, get from JWT or session
        stripePaymentIntentId: stripePaymentIntent.id,
        amount,
        currency,
        status: stripePaymentIntent.status as PaymentStatus,
        paymentMethodId,
        description,
        metadata,
        refunded: false,
        receiptUrl: undefined,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Cache the transaction
      this.paymentCache.set(paymentTransaction.id, paymentTransaction);

      // Emit event
      this.emit(PaymentEvent.PAYMENT_CREATED, { paymentTransaction, paymentIntent });

      // Prepare response
      const response: CreatePaymentIntentResponse = {
        paymentIntent: {
          id: stripePaymentIntent.id,
          clientSecret: stripePaymentIntent.client_secret!,
          status: stripePaymentIntent.status as PaymentStatus,
          amount,
          currency
        },
        requiresAction: stripePaymentIntent.status === 'requires_action'
      };

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      return {
        paymentIntent: {
          id: '',
          clientSecret: '',
          status: PaymentStatus.FAILED,
          amount: request.amount,
          currency: request.currency
        },
        requiresAction: false,
        error: {
          code: 'PAYMENT_INTENT_CREATION_FAILED',
          message: errorMessage,
          type: 'api_error'
        }
      };
    }
  }

  /**
   * Confirm a payment intent
   */
  async confirmPayment(request: ConfirmPaymentRequest): Promise<ConfirmPaymentResponse> {
    try {
      // Validate request
      const validatedRequest = ConfirmPaymentSchema.parse(request);
      const { paymentIntentId, paymentMethodId, returnUrl } = validatedRequest;

      // Confirm payment intent in Stripe
      const confirmParams: any = {
        payment_method: paymentMethodId,
        return_url: returnUrl
      };

      const stripePaymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, confirmParams);

      // Update payment transaction
      const existingTransaction = Array.from(this.paymentCache.values())
        .find(pt => pt.stripePaymentIntentId === paymentIntentId);

      if (existingTransaction) {
        const updatedTransaction: PaymentTransaction = {
          ...existingTransaction,
          status: stripePaymentIntent.status as PaymentStatus,
          paymentMethodId: paymentMethodId || existingTransaction.paymentMethodId,
          processedAt: new Date(),
          updatedAt: new Date()
        };

        // Handle different payment statuses
        if (stripePaymentIntent.status === 'succeeded') {
          updatedTransaction.receiptUrl = stripePaymentIntent.charges?.data[0]?.receipt_url || undefined;
          this.emit(PaymentEvent.PAYMENT_SUCCEEDED, { 
            paymentTransaction: updatedTransaction, 
            paymentIntent: stripePaymentIntent 
          });
        } else if (stripePaymentIntent.status === 'requires_action') {
          this.emit(PaymentEvent.PAYMENT_REQUIRES_ACTION, { 
            paymentTransaction: updatedTransaction, 
            paymentIntent: stripePaymentIntent 
          });
        }

        this.paymentCache.set(updatedTransaction.id, updatedTransaction);
      }

      return {
        paymentIntent: {
          id: stripePaymentIntent.id,
          status: stripePaymentIntent.status as PaymentStatus,
          clientSecret: stripePaymentIntent.client_secret || undefined
        },
        requiresAction: stripePaymentIntent.status === 'requires_action'
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      // Handle specific Stripe errors
      let failureCode = PaymentFailureCode.PROCESSING_ERROR;
      if (error instanceof Error) {
        if (error.message.includes('card_declined')) {
          failureCode = PaymentFailureCode.CARD_DECLINED;
        } else if (error.message.includes('insufficient_funds')) {
          failureCode = PaymentFailureCode.INSUFFICIENT_FUNDS;
        } else if (error.message.includes('expired_card')) {
          failureCode = PaymentFailureCode.EXPIRED_CARD;
        } else if (error.message.includes('incorrect_cvc')) {
          failureCode = PaymentFailureCode.INVALID_CVC;
        }
      }

      // Update transaction with failure info
      const existingTransaction = Array.from(this.paymentCache.values())
        .find(pt => pt.stripePaymentIntentId === request.paymentIntentId);

      if (existingTransaction) {
        const failedTransaction: PaymentTransaction = {
          ...existingTransaction,
          status: PaymentStatus.FAILED,
          failureCode,
          failureMessage: errorMessage,
          processedAt: new Date(),
          updatedAt: new Date()
        };

        this.paymentCache.set(failedTransaction.id, failedTransaction);

        // Queue for retry if applicable
        if (canRetryPayment(failureCode)) {
          await this.queuePaymentRetry(failedTransaction);
        }

        this.emit(PaymentEvent.PAYMENT_FAILED, { 
          paymentTransaction: failedTransaction, 
          error, 
          retryable: canRetryPayment(failureCode) 
        });
      }

      return {
        paymentIntent: {
          id: request.paymentIntentId,
          status: PaymentStatus.FAILED
        },
        requiresAction: false,
        error: {
          code: failureCode,
          message: errorMessage,
          type: 'payment_error'
        }
      };
    }
  }

  /**
   * Process a refund
   */
  async processRefund(request: ProcessRefundRequest): Promise<ProcessRefundResponse> {
    try {
      // Validate request
      const validatedRequest = ProcessRefundSchema.parse(request);
      const { paymentTransactionId, amount, reason, metadata = {} } = validatedRequest;

      // Get payment transaction
      const paymentTransaction = this.paymentCache.get(paymentTransactionId);
      if (!paymentTransaction) {
        throw new Error(`Payment transaction not found: ${paymentTransactionId}`);
      }

      if (paymentTransaction.status !== PaymentStatus.SUCCEEDED) {
        throw new Error('Can only refund successful payments');
      }

      // Create refund in Stripe
      const stripeRefund = await stripeClient.createRefund({
        paymentIntentId: paymentTransaction.stripePaymentIntentId,
        amount,
        reason,
        metadata: {
          ...metadata,
          paymentTransactionId,
          processed_by: 'payment-processor'
        }
      });

      // Create refund record
      const refund: Refund = {
        id: `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        paymentTransactionId,
        stripeRefundId: stripeRefund.id,
        amount: stripeRefund.amount,
        currency: stripeRefund.currency,
        reason,
        status: stripeRefund.status as 'pending' | 'succeeded' | 'failed' | 'canceled',
        receiptNumber: stripeRefund.receipt_number || undefined,
        metadata,
        processedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Update payment transaction
      const refundedAmount = (paymentTransaction.refundedAmount || 0) + refund.amount;
      const isFullyRefunded = refundedAmount >= paymentTransaction.amount;

      const updatedTransaction: PaymentTransaction = {
        ...paymentTransaction,
        refunded: isFullyRefunded,
        refundedAmount,
        updatedAt: new Date()
      };

      // Update caches
      this.refundCache.set(refund.id, refund);
      this.paymentCache.set(updatedTransaction.id, updatedTransaction);

      // Emit events
      this.emit(PaymentEvent.REFUND_CREATED, { refund, paymentTransaction: updatedTransaction });

      if (refund.status === 'succeeded') {
        this.emit(PaymentEvent.REFUND_SUCCEEDED, { refund, paymentTransaction: updatedTransaction });
      }

      return {
        refund: {
          id: refund.id,
          amount: refund.amount,
          status: refund.status,
          receiptNumber: refund.receiptNumber
        },
        success: true
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      this.emit(PaymentEvent.REFUND_FAILED, { 
        paymentTransactionId: request.paymentTransactionId, 
        error 
      });

      return {
        refund: {
          id: '',
          amount: request.amount || 0,
          status: 'failed'
        },
        success: false,
        error: {
          code: 'REFUND_PROCESSING_FAILED',
          message: errorMessage
        }
      };
    }
  }

  /**
   * Attach payment method to customer
   */
  async attachPaymentMethod(request: AttachPaymentMethodRequest): Promise<AttachPaymentMethodResponse> {
    try {
      // Validate request
      const validatedRequest = AttachPaymentMethodSchema.parse(request);
      const { paymentMethodId, customerId, setAsDefault } = validatedRequest;

      // Attach payment method in Stripe
      const stripePaymentMethod = await stripeClient.attachPaymentMethod(paymentMethodId, customerId);

      // Set as default if requested
      if (setAsDefault) {
        await this.stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId
          }
        });
      }

      // Convert to internal model
      const paymentMethod = convertStripePaymentMethod(stripePaymentMethod, customerId);

      // Emit event
      this.emit(PaymentEvent.PAYMENT_METHOD_ATTACHED, { paymentMethod, customerId, setAsDefault });

      return {
        paymentMethod: {
          id: paymentMethod.id,
          type: paymentMethod.type,
          card: paymentMethod.card
        },
        success: true
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      return {
        paymentMethod: {
          id: request.paymentMethodId,
          type: PaymentMethodType.CARD
        },
        success: false,
        error: {
          code: 'PAYMENT_METHOD_ATTACHMENT_FAILED',
          message: errorMessage
        }
      };
    }
  }

  /**
   * Detach payment method from customer
   */
  async detachPaymentMethod(paymentMethodId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const stripePaymentMethod = await stripeClient.detachPaymentMethod(paymentMethodId);
      
      this.emit(PaymentEvent.PAYMENT_METHOD_DETACHED, { paymentMethodId });

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * List customer payment methods
   */
  async listCustomerPaymentMethods(customerId: string, type: string = 'card'): Promise<{
    paymentMethods: Array<{
      id: string;
      type: PaymentMethodType;
      card?: any;
      isDefault: boolean;
    }>;
  }> {
    try {
      // Get customer to find default payment method
      const customer = await this.stripe.customers.retrieve(customerId) as Stripe.Customer;
      const defaultPaymentMethodId = typeof customer.invoice_settings?.default_payment_method === 'string' 
        ? customer.invoice_settings.default_payment_method 
        : undefined;

      // List payment methods
      const stripePaymentMethods = await stripeClient.listCustomerPaymentMethods(customerId, type);

      const paymentMethods = stripePaymentMethods.data.map(pm => ({
        id: pm.id,
        type: pm.type as PaymentMethodType,
        card: pm.card ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year
        } : undefined,
        isDefault: pm.id === defaultPaymentMethodId
      }));

      return { paymentMethods };

    } catch (error) {
      console.error('Error listing payment methods:', error);
      return { paymentMethods: [] };
    }
  }

  /**
   * Get payment transaction by ID
   */
  getPaymentTransaction(transactionId: string): PaymentTransaction | null {
    return this.paymentCache.get(transactionId) || null;
  }

  /**
   * Get refund by ID
   */
  getRefund(refundId: string): Refund | null {
    return this.refundCache.get(refundId) || null;
  }

  /**
   * Queue payment for retry
   */
  private async queuePaymentRetry(paymentTransaction: PaymentTransaction): Promise<void> {
    const existingRetry = this.retryQueue.get(paymentTransaction.id);
    const attempts = existingRetry ? existingRetry.attempts + 1 : 1;

    if (attempts <= this.retryConfig.maxRetries) {
      const retryIntervalMinutes = this.retryConfig.retryIntervals[attempts - 1] || 180;
      const nextRetry = new Date(Date.now() + retryIntervalMinutes * 60 * 1000);

      this.retryQueue.set(paymentTransaction.id, {
        attempts,
        nextRetry,
        paymentIntentId: paymentTransaction.stripePaymentIntentId
      });

      console.log(`Queued payment ${paymentTransaction.id} for retry ${attempts}/${this.retryConfig.maxRetries} at ${nextRetry}`);
    } else {
      console.log(`Payment ${paymentTransaction.id} exceeded maximum retry attempts`);
      this.retryQueue.delete(paymentTransaction.id);
    }
  }

  /**
   * Process retry queue
   */
  private startRetryProcessor(): void {
    setInterval(async () => {
      const now = new Date();
      
      for (const [transactionId, retryInfo] of this.retryQueue.entries()) {
        if (now >= retryInfo.nextRetry) {
          try {
            // Attempt to confirm payment again
            const result = await this.confirmPayment({
              paymentIntentId: retryInfo.paymentIntentId
            });

            if (result.paymentIntent.status === PaymentStatus.SUCCEEDED) {
              // Success - remove from retry queue
              this.retryQueue.delete(transactionId);
              console.log(`Payment retry succeeded for transaction ${transactionId}`);
            } else if (!result.requiresAction) {
              // Failed again - queue for next retry if attempts remaining
              const transaction = this.paymentCache.get(transactionId);
              if (transaction) {
                await this.queuePaymentRetry(transaction);
              }
            }
          } catch (error) {
            console.error(`Payment retry failed for transaction ${transactionId}:`, error);
            
            // Queue for next retry if attempts remaining
            const transaction = this.paymentCache.get(transactionId);
            if (transaction) {
              await this.queuePaymentRetry(transaction);
            }
          }
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.on(PaymentEvent.PAYMENT_SUCCEEDED, (data) => {
      console.log('Payment succeeded:', data.paymentTransaction.id);
      // In production: send confirmation emails, update analytics, etc.
    });

    this.on(PaymentEvent.PAYMENT_FAILED, (data) => {
      console.log('Payment failed:', data.paymentTransaction.id, 'Retryable:', data.retryable);
      // In production: send failure notifications, update analytics, etc.
    });

    this.on(PaymentEvent.REFUND_SUCCEEDED, (data) => {
      console.log('Refund succeeded:', data.refund.id);
      // In production: send refund confirmations, update analytics, etc.
    });
  }

  /**
   * Health check for payment processor
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      const stripeHealth = await stripeClient.healthCheck();
      
      const details = {
        stripe: stripeHealth,
        paymentCacheSize: this.paymentCache.size,
        refundCacheSize: this.refundCache.size,
        retryQueueSize: this.retryQueue.size,
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
export const paymentProcessor = PaymentProcessor.getInstance();
export default paymentProcessor;