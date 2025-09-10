import { Request, Response } from 'express';
import { z } from 'zod';
import type { Stripe } from 'stripe';
import { stripeClient } from '../utils/stripe-client';
import { paymentProcessor, PaymentEvent } from '../services/payment-processor';
import { subscriptionManager, SubscriptionEvent } from '../services/subscription-manager';
import { oneTimePurchaseManager, PurchaseEvent } from '../services/one-time-purchase-manager';
import {
  PaymentStatus,
  PaymentFailureCode,
  PaymentTransaction
} from '../models/payment';
import {
  SubscriptionStatus,
  CancellationReason,
  convertStripeSubscription
} from '../models/subscription';
import { EventEmitter } from 'events';

// Webhook event types we handle
export enum WebhookEventType {
  // Payment Intent events
  PAYMENT_INTENT_SUCCEEDED = 'payment_intent.succeeded',
  PAYMENT_INTENT_PAYMENT_FAILED = 'payment_intent.payment_failed',
  PAYMENT_INTENT_REQUIRES_ACTION = 'payment_intent.requires_action',
  PAYMENT_INTENT_CANCELED = 'payment_intent.canceled',
  
  // Payment Method events
  PAYMENT_METHOD_ATTACHED = 'payment_method.attached',
  PAYMENT_METHOD_DETACHED = 'payment_method.detached',
  
  // Subscription events
  CUSTOMER_SUBSCRIPTION_CREATED = 'customer.subscription.created',
  CUSTOMER_SUBSCRIPTION_UPDATED = 'customer.subscription.updated',
  CUSTOMER_SUBSCRIPTION_DELETED = 'customer.subscription.deleted',
  CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END = 'customer.subscription.trial_will_end',
  
  // Invoice events
  INVOICE_PAYMENT_SUCCEEDED = 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED = 'invoice.payment_failed',
  INVOICE_CREATED = 'invoice.created',
  INVOICE_FINALIZED = 'invoice.finalized',
  
  // Customer events
  CUSTOMER_CREATED = 'customer.created',
  CUSTOMER_UPDATED = 'customer.updated',
  CUSTOMER_DELETED = 'customer.deleted',
  
  // Charge events
  CHARGE_SUCCEEDED = 'charge.succeeded',
  CHARGE_FAILED = 'charge.failed',
  CHARGE_DISPUTE_CREATED = 'charge.dispute.created'
}

// Webhook validation schema
const WebhookEventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  type: z.string(),
  created: z.number(),
  data: z.object({
    object: z.any(),
    previous_attributes: z.any().optional()
  }),
  livemode: z.boolean(),
  pending_webhooks: z.number(),
  request: z.object({
    id: z.string().nullable(),
    idempotency_key: z.string().nullable()
  }).optional()
});

// Notification preferences
interface NotificationConfig {
  emailEnabled: boolean;
  smsEnabled: boolean;
  webhookEnabled: boolean;
  slackEnabled: boolean;
}

// Event processing results
interface WebhookProcessResult {
  success: boolean;
  eventId: string;
  eventType: string;
  processingTime: number;
  error?: string;
  actions: string[];
}

export class WebhookHandler extends EventEmitter {
  private static instance: WebhookHandler;
  
  // Event processing statistics
  private processedEvents: Map<string, WebhookProcessResult> = new Map();
  private failedEvents: Map<string, { attempts: number; lastAttempt: Date; error: string }> = new Map();
  
  private constructor() {
    super();
    this.setupEventHandlers();
  }

  static getInstance(): WebhookHandler {
    if (!WebhookHandler.instance) {
      WebhookHandler.instance = new WebhookHandler();
    }
    return WebhookHandler.instance;
  }

  /**
   * Main webhook endpoint handler
   */
  async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    let event: Stripe.Event;
    
    try {
      // Verify webhook signature
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).send('Missing stripe-signature header');
        return;
      }

      // Construct and verify the event
      event = stripeClient.verifyWebhookSignature(req.body, signature);
      
      console.log(`Received webhook event: ${event.type} (${event.id})`);

      // Check for duplicate events (idempotency)
      if (this.processedEvents.has(event.id)) {
        console.log(`Duplicate event ignored: ${event.id}`);
        res.status(200).json({ received: true, duplicate: true });
        return;
      }

      // Process the event
      const result = await this.processWebhookEvent(event);
      
      // Record processing result
      const processingTime = Date.now() - startTime;
      const processResult: WebhookProcessResult = {
        success: result.success,
        eventId: event.id,
        eventType: event.type,
        processingTime,
        error: result.error,
        actions: result.actions || []
      };
      
      this.processedEvents.set(event.id, processResult);

      if (result.success) {
        // Clear any previous failures for this event type
        this.failedEvents.delete(event.id);
        
        res.status(200).json({
          received: true,
          eventId: event.id,
          eventType: event.type,
          processingTime,
          actions: result.actions
        });
      } else {
        // Record failure
        const existingFailure = this.failedEvents.get(event.id);
        this.failedEvents.set(event.id, {
          attempts: (existingFailure?.attempts || 0) + 1,
          lastAttempt: new Date(),
          error: result.error || 'Unknown error'
        });

        res.status(500).json({
          received: false,
          eventId: event.id,
          eventType: event.type,
          error: result.error
        });
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error('Webhook processing error:', errorMessage);
      
      // Record failure
      const eventId = (event as any)?.id || 'unknown';
      this.failedEvents.set(eventId, {
        attempts: 1,
        lastAttempt: new Date(),
        error: errorMessage
      });

      res.status(400).json({
        received: false,
        error: errorMessage,
        processingTime
      });
    }
  }

  /**
   * Process individual webhook events
   */
  private async processWebhookEvent(event: Stripe.Event): Promise<{
    success: boolean;
    error?: string;
    actions?: string[];
  }> {
    const actions: string[] = [];

    try {
      switch (event.type as WebhookEventType) {
        // Payment Intent Events
        case WebhookEventType.PAYMENT_INTENT_SUCCEEDED:
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          actions.push('Payment confirmed', 'Access granted', 'Receipt sent');
          break;

        case WebhookEventType.PAYMENT_INTENT_PAYMENT_FAILED:
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          actions.push('Payment failure recorded', 'User notified', 'Retry queued');
          break;

        case WebhookEventType.PAYMENT_INTENT_REQUIRES_ACTION:
          await this.handlePaymentIntentRequiresAction(event.data.object as Stripe.PaymentIntent);
          actions.push('Action required notification sent');
          break;

        case WebhookEventType.PAYMENT_INTENT_CANCELED:
          await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
          actions.push('Payment cancellation processed');
          break;

        // Subscription Events
        case WebhookEventType.CUSTOMER_SUBSCRIPTION_CREATED:
          await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          actions.push('Subscription activated', 'Welcome email sent');
          break;

        case WebhookEventType.CUSTOMER_SUBSCRIPTION_UPDATED:
          await this.handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
            event.data.previous_attributes
          );
          actions.push('Subscription updated', 'User notified');
          break;

        case WebhookEventType.CUSTOMER_SUBSCRIPTION_DELETED:
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          actions.push('Subscription canceled', 'Access revoked', 'Cancellation email sent');
          break;

        case WebhookEventType.CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END:
          await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
          actions.push('Trial ending notification sent');
          break;

        // Invoice Events
        case WebhookEventType.INVOICE_PAYMENT_SUCCEEDED:
          await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          actions.push('Invoice paid', 'Receipt generated');
          break;

        case WebhookEventType.INVOICE_PAYMENT_FAILED:
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          actions.push('Payment failure processed', 'Dunning initiated');
          break;

        case WebhookEventType.INVOICE_CREATED:
          await this.handleInvoiceCreated(event.data.object as Stripe.Invoice);
          actions.push('Invoice created', 'Customer notified');
          break;

        // Payment Method Events
        case WebhookEventType.PAYMENT_METHOD_ATTACHED:
          await this.handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
          actions.push('Payment method added');
          break;

        case WebhookEventType.PAYMENT_METHOD_DETACHED:
          await this.handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
          actions.push('Payment method removed');
          break;

        // Charge Events (for fraud detection)
        case WebhookEventType.CHARGE_DISPUTE_CREATED:
          await this.handleChargeDispute(event.data.object as Stripe.Charge);
          actions.push('Dispute recorded', 'Investigation initiated');
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
          // Don't fail for unhandled events, just log them
          actions.push(`Logged unhandled event: ${event.type}`);
          break;
      }

      return { success: true, actions };

    } catch (error) {
      console.error(`Error processing ${event.type}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        actions
      };
    }
  }

  // Payment Intent Event Handlers

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`Payment succeeded: ${paymentIntent.id} for ${paymentIntent.amount} ${paymentIntent.currency}`);

    // Update payment processor
    paymentProcessor.emit(PaymentEvent.PAYMENT_SUCCEEDED, {
      paymentIntent,
      stripePaymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      customerId: paymentIntent.customer
    });

    // Handle one-time purchases
    if (paymentIntent.metadata?.purchaseType) {
      const purchaseId = paymentIntent.metadata.purchaseId;
      if (purchaseId) {
        await oneTimePurchaseManager.completePurchase({
          purchaseId,
          paymentIntentId: paymentIntent.id
        });
      }
    }

    // Send success notifications
    await this.sendPaymentSuccessNotification(paymentIntent);
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`Payment failed: ${paymentIntent.id} - ${paymentIntent.last_payment_error?.message}`);

    const failureCode = this.mapStripeErrorToFailureCode(paymentIntent.last_payment_error);

    // Update payment processor
    paymentProcessor.emit(PaymentEvent.PAYMENT_FAILED, {
      paymentIntent,
      failureCode,
      failureMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
      retryable: this.isRetryableError(paymentIntent.last_payment_error)
    });

    // Send failure notifications
    await this.sendPaymentFailureNotification(paymentIntent, failureCode);
  }

  private async handlePaymentIntentRequiresAction(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`Payment requires action: ${paymentIntent.id}`);

    paymentProcessor.emit(PaymentEvent.PAYMENT_REQUIRES_ACTION, {
      paymentIntent,
      nextAction: paymentIntent.next_action
    });

    // Send action required notifications
    await this.sendActionRequiredNotification(paymentIntent);
  }

  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`Payment canceled: ${paymentIntent.id}`);

    // Handle one-time purchase cancellation
    if (paymentIntent.metadata?.purchaseId) {
      const purchase = oneTimePurchaseManager.getPurchase(paymentIntent.metadata.purchaseId);
      if (purchase) {
        oneTimePurchaseManager.emit(PurchaseEvent.PURCHASE_FAILED, { purchase });
      }
    }
  }

  // Subscription Event Handlers

  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    console.log(`Subscription created: ${subscription.id} for customer ${subscription.customer}`);

    subscriptionManager.emit(SubscriptionEvent.CREATED, {
      subscription,
      customerId: subscription.customer,
      status: subscription.status
    });

    // Send welcome email
    await this.sendSubscriptionWelcomeEmail(subscription);
  }

  private async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
    previousAttributes?: any
  ): Promise<void> {
    console.log(`Subscription updated: ${subscription.id}`);

    // Check for status changes
    if (previousAttributes?.status && previousAttributes.status !== subscription.status) {
      console.log(`Subscription status changed: ${previousAttributes.status} -> ${subscription.status}`);
      
      if (subscription.status === 'canceled') {
        subscriptionManager.emit(SubscriptionEvent.CANCELED, {
          subscription,
          reason: CancellationReason.USER_REQUESTED
        });
      }
    }

    // Check for plan changes
    if (previousAttributes?.items && subscription.items.data[0].price.id !== previousAttributes.items.data[0].price.id) {
      console.log('Subscription plan changed');
      subscriptionManager.emit(SubscriptionEvent.PLAN_CHANGED, {
        subscription,
        previousPriceId: previousAttributes.items.data[0].price.id,
        newPriceId: subscription.items.data[0].price.id
      });
    }

    subscriptionManager.emit(SubscriptionEvent.UPDATED, { subscription });
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    console.log(`Subscription deleted: ${subscription.id}`);

    subscriptionManager.emit(SubscriptionEvent.CANCELED, {
      subscription,
      reason: CancellationReason.USER_REQUESTED
    });

    // Send cancellation confirmation
    await this.sendSubscriptionCancellationEmail(subscription);
  }

  private async handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    console.log(`Trial ending soon for subscription: ${subscription.id}`);

    subscriptionManager.emit(SubscriptionEvent.TRIAL_ENDED, { subscription });

    // Send trial ending notification
    await this.sendTrialEndingNotification(subscription);
  }

  // Invoice Event Handlers

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    console.log(`Invoice paid: ${invoice.id} for ${invoice.amount_paid} ${invoice.currency}`);

    if (invoice.subscription) {
      subscriptionManager.emit(SubscriptionEvent.PAYMENT_SUCCEEDED, {
        invoice,
        subscriptionId: invoice.subscription,
        amount: invoice.amount_paid
      });
    }

    // Send receipt
    await this.sendInvoiceReceipt(invoice);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    console.log(`Invoice payment failed: ${invoice.id}`);

    if (invoice.subscription) {
      subscriptionManager.emit(SubscriptionEvent.PAYMENT_FAILED, {
        invoice,
        subscriptionId: invoice.subscription,
        amount: invoice.amount_due
      });
    }

    // Initiate dunning process
    await this.initiateDunningProcess(invoice);
  }

  private async handleInvoiceCreated(invoice: Stripe.Invoice): Promise<void> {
    console.log(`Invoice created: ${invoice.id}`);
    
    // Send invoice notification to customer
    await this.sendInvoiceNotification(invoice);
  }

  // Payment Method Event Handlers

  private async handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    console.log(`Payment method attached: ${paymentMethod.id} to customer ${paymentMethod.customer}`);

    paymentProcessor.emit(PaymentEvent.PAYMENT_METHOD_ATTACHED, {
      paymentMethod,
      customerId: paymentMethod.customer
    });
  }

  private async handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
    console.log(`Payment method detached: ${paymentMethod.id}`);

    paymentProcessor.emit(PaymentEvent.PAYMENT_METHOD_DETACHED, {
      paymentMethodId: paymentMethod.id
    });
  }

  // Fraud Detection

  private async handleChargeDispute(charge: Stripe.Charge): Promise<void> {
    console.log(`Charge dispute created for: ${charge.id}`);

    // Emit fraud detection event
    paymentProcessor.emit(PaymentEvent.FRAUD_DETECTED, {
      chargeId: charge.id,
      amount: charge.amount,
      currency: charge.currency,
      customerId: charge.customer,
      disputeReason: (charge as any).dispute?.reason
    });

    // Implement fraud response logic
    await this.handlePotentialFraud(charge);
  }

  // Utility Methods

  private mapStripeErrorToFailureCode(error: Stripe.PaymentIntent.LastPaymentError | null): PaymentFailureCode {
    if (!error) return PaymentFailureCode.GENERIC_DECLINE;

    switch (error.code) {
      case 'card_declined':
        return PaymentFailureCode.CARD_DECLINED;
      case 'insufficient_funds':
        return PaymentFailureCode.INSUFFICIENT_FUNDS;
      case 'expired_card':
        return PaymentFailureCode.EXPIRED_CARD;
      case 'incorrect_cvc':
        return PaymentFailureCode.INVALID_CVC;
      case 'authentication_required':
        return PaymentFailureCode.AUTHENTICATION_REQUIRED;
      case 'processing_error':
        return PaymentFailureCode.PROCESSING_ERROR;
      default:
        return PaymentFailureCode.GENERIC_DECLINE;
    }
  }

  private isRetryableError(error: Stripe.PaymentIntent.LastPaymentError | null): boolean {
    if (!error) return false;
    
    const retryableCodes = [
      'processing_error',
      'authentication_required',
      'generic_decline'
    ];
    
    return retryableCodes.includes(error.code || '');
  }

  // Notification Methods (these would integrate with your notification service)

  private async sendPaymentSuccessNotification(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    // Implementation would send actual notifications
    console.log(`Sending payment success notification for ${paymentIntent.id}`);
  }

  private async sendPaymentFailureNotification(
    paymentIntent: Stripe.PaymentIntent, 
    failureCode: PaymentFailureCode
  ): Promise<void> {
    console.log(`Sending payment failure notification for ${paymentIntent.id}: ${failureCode}`);
  }

  private async sendActionRequiredNotification(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    console.log(`Sending action required notification for ${paymentIntent.id}`);
  }

  private async sendSubscriptionWelcomeEmail(subscription: Stripe.Subscription): Promise<void> {
    console.log(`Sending welcome email for subscription ${subscription.id}`);
  }

  private async sendSubscriptionCancellationEmail(subscription: Stripe.Subscription): Promise<void> {
    console.log(`Sending cancellation email for subscription ${subscription.id}`);
  }

  private async sendTrialEndingNotification(subscription: Stripe.Subscription): Promise<void> {
    console.log(`Sending trial ending notification for subscription ${subscription.id}`);
  }

  private async sendInvoiceReceipt(invoice: Stripe.Invoice): Promise<void> {
    console.log(`Sending receipt for invoice ${invoice.id}`);
  }

  private async sendInvoiceNotification(invoice: Stripe.Invoice): Promise<void> {
    console.log(`Sending invoice notification for ${invoice.id}`);
  }

  private async initiateDunningProcess(invoice: Stripe.Invoice): Promise<void> {
    console.log(`Initiating dunning process for invoice ${invoice.id}`);
    // This would trigger the dunning management system
  }

  private async handlePotentialFraud(charge: Stripe.Charge): Promise<void> {
    console.log(`Handling potential fraud for charge ${charge.id}`);
    // Implementation would include fraud detection and response logic
  }

  // Event handler setup
  private setupEventHandlers(): void {
    // Set up internal event listeners for cross-service communication
    this.on('webhook.processed', (data) => {
      console.log(`Webhook processed: ${data.eventType} (${data.eventId}) in ${data.processingTime}ms`);
    });
  }

  // Health check and monitoring
  getWebhookStatistics(): {
    totalProcessed: number;
    totalFailed: number;
    averageProcessingTime: number;
    recentEvents: WebhookProcessResult[];
    failureRate: number;
  } {
    const processed = Array.from(this.processedEvents.values());
    const totalProcessed = processed.length;
    const successful = processed.filter(e => e.success);
    const totalFailed = this.failedEvents.size;
    
    const averageProcessingTime = successful.length > 0 
      ? successful.reduce((sum, event) => sum + event.processingTime, 0) / successful.length 
      : 0;
    
    const recentEvents = processed
      .sort((a, b) => b.processingTime - a.processingTime)
      .slice(0, 10);
    
    const failureRate = totalProcessed > 0 ? totalFailed / totalProcessed : 0;

    return {
      totalProcessed,
      totalFailed,
      averageProcessingTime,
      recentEvents,
      failureRate
    };
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const stats = this.getWebhookStatistics();
    const isHealthy = stats.failureRate < 0.05; // Less than 5% failure rate

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      details: {
        ...stats,
        timestamp: new Date()
      }
    };
  }
}

// Export singleton instance and Express handler
export const webhookHandler = WebhookHandler.getInstance();

export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  await webhookHandler.handleStripeWebhook(req, res);
};

export default webhookHandler;