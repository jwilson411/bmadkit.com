import Stripe from 'stripe';
import { z } from 'zod';
import { config } from 'dotenv';

config();

// Environment validation schema
const StripeConfigSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1, 'Stripe secret key is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'Stripe webhook secret is required'),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1, 'Stripe publishable key is required'),
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development')
});

export type StripeConfig = z.infer<typeof StripeConfigSchema>;

// Validate environment configuration
const validateStripeConfig = (): StripeConfig => {
  try {
    return StripeConfigSchema.parse({
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
      NODE_ENV: process.env.NODE_ENV
    });
  } catch (error) {
    throw new Error(`Stripe configuration validation failed: ${error}`);
  }
};

// Stripe client configuration
class StripeClientManager {
  private static instance: StripeClientManager;
  private stripe: Stripe;
  private config: StripeConfig;

  private constructor() {
    this.config = validateStripeConfig();
    this.stripe = new Stripe(this.config.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 10000, // 10 seconds
      stripeAccount: undefined, // For marketplace platforms
      appInfo: {
        name: 'BMAD Planning Platform',
        version: '1.0.0',
        url: 'https://bmadkit.com'
      }
    });
  }

  static getInstance(): StripeClientManager {
    if (!StripeClientManager.instance) {
      StripeClientManager.instance = new StripeClientManager();
    }
    return StripeClientManager.instance;
  }

  getStripeClient(): Stripe {
    return this.stripe;
  }

  getConfig(): StripeConfig {
    return this.config;
  }

  getPublishableKey(): string {
    return this.config.STRIPE_PUBLISHABLE_KEY;
  }

  getWebhookSecret(): string {
    return this.config.STRIPE_WEBHOOK_SECRET;
  }

  /**
   * Verify webhook signature for security
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      throw new Error(`Webhook signature verification failed: ${error}`);
    }
  }

  /**
   * Create payment intent with automatic payment methods
   */
  async createPaymentIntent(params: {
    amount: number; // in cents
    currency: string;
    customerId?: string;
    paymentMethodId?: string;
    description?: string;
    metadata?: Record<string, string>;
    automaticPaymentMethods?: boolean;
  }): Promise<Stripe.PaymentIntent> {
    const {
      amount,
      currency = 'usd',
      customerId,
      paymentMethodId,
      description,
      metadata = {},
      automaticPaymentMethods = true
    } = params;

    const createParams: Stripe.PaymentIntentCreateParams = {
      amount,
      currency,
      description,
      metadata: {
        ...metadata,
        created_by: 'bmad-platform',
        environment: this.config.NODE_ENV
      }
    };

    if (customerId) {
      createParams.customer = customerId;
    }

    if (paymentMethodId) {
      createParams.payment_method = paymentMethodId;
      createParams.confirmation_method = 'manual';
      createParams.confirm = true;
    } else if (automaticPaymentMethods) {
      createParams.automatic_payment_methods = {
        enabled: true
      };
    }

    return await this.stripe.paymentIntents.create(createParams);
  }

  /**
   * Create setup intent for saving payment methods
   */
  async createSetupIntent(params: {
    customerId: string;
    paymentMethodTypes?: string[];
    usage?: 'off_session' | 'on_session';
    metadata?: Record<string, string>;
  }): Promise<Stripe.SetupIntent> {
    const {
      customerId,
      paymentMethodTypes = ['card'],
      usage = 'off_session',
      metadata = {}
    } = params;

    return await this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: paymentMethodTypes,
      usage,
      metadata: {
        ...metadata,
        created_by: 'bmad-platform',
        environment: this.config.NODE_ENV
      }
    });
  }

  /**
   * Create customer with optional payment method
   */
  async createCustomer(params: {
    email: string;
    name?: string;
    phone?: string;
    address?: Stripe.AddressParam;
    metadata?: Record<string, string>;
    paymentMethodId?: string;
  }): Promise<Stripe.Customer> {
    const {
      email,
      name,
      phone,
      address,
      metadata = {},
      paymentMethodId
    } = params;

    const customer = await this.stripe.customers.create({
      email,
      name,
      phone,
      address,
      metadata: {
        ...metadata,
        created_by: 'bmad-platform',
        environment: this.config.NODE_ENV,
        created_at: new Date().toISOString()
      }
    });

    // Attach payment method if provided
    if (paymentMethodId) {
      await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customer.id
      });

      // Set as default payment method
      await this.stripe.customers.update(customer.id, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });
    }

    return customer;
  }

  /**
   * Create subscription with trial and proration support
   */
  async createSubscription(params: {
    customerId: string;
    priceId: string;
    paymentMethodId?: string;
    trialPeriodDays?: number;
    prorationBehavior?: 'create_prorations' | 'none';
    metadata?: Record<string, string>;
    couponId?: string;
  }): Promise<Stripe.Subscription> {
    const {
      customerId,
      priceId,
      paymentMethodId,
      trialPeriodDays,
      prorationBehavior = 'create_prorations',
      metadata = {},
      couponId
    } = params;

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{
        price: priceId
      }],
      proration_behavior: prorationBehavior,
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        ...metadata,
        created_by: 'bmad-platform',
        environment: this.config.NODE_ENV
      }
    };

    if (paymentMethodId) {
      subscriptionParams.default_payment_method = paymentMethodId;
    }

    if (trialPeriodDays) {
      subscriptionParams.trial_period_days = trialPeriodDays;
    }

    if (couponId) {
      subscriptionParams.coupon = couponId;
    }

    return await this.stripe.subscriptions.create(subscriptionParams);
  }

  /**
   * Handle subscription modifications with proration
   */
  async updateSubscription(params: {
    subscriptionId: string;
    newPriceId?: string;
    prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    const {
      subscriptionId,
      newPriceId,
      prorationBehavior = 'create_prorations',
      paymentMethodId,
      metadata
    } = params;

    const updateParams: Stripe.SubscriptionUpdateParams = {
      proration_behavior: prorationBehavior,
      expand: ['latest_invoice.payment_intent']
    };

    if (newPriceId) {
      // Get current subscription to replace the price
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const currentItem = subscription.items.data[0];

      updateParams.items = [{
        id: currentItem.id,
        price: newPriceId
      }];
    }

    if (paymentMethodId) {
      updateParams.default_payment_method = paymentMethodId;
    }

    if (metadata) {
      updateParams.metadata = {
        ...metadata,
        updated_by: 'bmad-platform',
        updated_at: new Date().toISOString()
      };
    }

    return await this.stripe.subscriptions.update(subscriptionId, updateParams);
  }

  /**
   * Cancel subscription with options
   */
  async cancelSubscription(params: {
    subscriptionId: string;
    immediately?: boolean;
    invoiceNow?: boolean;
    prorate?: boolean;
  }): Promise<Stripe.Subscription> {
    const {
      subscriptionId,
      immediately = false,
      invoiceNow = false,
      prorate = true
    } = params;

    if (immediately) {
      return await this.stripe.subscriptions.cancel(subscriptionId, {
        invoice_now: invoiceNow,
        prorate
      });
    } else {
      return await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: {
          cancellation_requested_at: new Date().toISOString(),
          cancelled_by: 'bmad-platform'
        }
      });
    }
  }

  /**
   * Generate invoice with custom line items
   */
  async createInvoice(params: {
    customerId: string;
    description?: string;
    metadata?: Record<string, string>;
    dueDate?: number; // Unix timestamp
    autoAdvance?: boolean;
  }): Promise<Stripe.Invoice> {
    const {
      customerId,
      description,
      metadata = {},
      dueDate,
      autoAdvance = true
    } = params;

    return await this.stripe.invoices.create({
      customer: customerId,
      description,
      due_date: dueDate,
      auto_advance: autoAdvance,
      metadata: {
        ...metadata,
        created_by: 'bmad-platform',
        environment: this.config.NODE_ENV
      }
    });
  }

  /**
   * Process refunds with reason tracking
   */
  async createRefund(params: {
    paymentIntentId?: string;
    chargeId?: string;
    amount?: number;
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    metadata?: Record<string, string>;
  }): Promise<Stripe.Refund> {
    const {
      paymentIntentId,
      chargeId,
      amount,
      reason = 'requested_by_customer',
      metadata = {}
    } = params;

    const refundParams: Stripe.RefundCreateParams = {
      reason,
      metadata: {
        ...metadata,
        processed_by: 'bmad-platform',
        processed_at: new Date().toISOString()
      }
    };

    if (paymentIntentId) {
      refundParams.payment_intent = paymentIntentId;
    } else if (chargeId) {
      refundParams.charge = chargeId;
    } else {
      throw new Error('Either paymentIntentId or chargeId is required for refund');
    }

    if (amount) {
      refundParams.amount = amount;
    }

    return await this.stripe.refunds.create(refundParams);
  }

  /**
   * Handle payment method operations
   */
  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<Stripe.PaymentMethod> {
    return await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<Stripe.PaymentMethod> {
    return await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async listCustomerPaymentMethods(customerId: string, type: string = 'card'): Promise<Stripe.ApiList<Stripe.PaymentMethod>> {
    return await this.stripe.paymentMethods.list({
      customer: customerId,
      type: type as any
    });
  }

  /**
   * Health check for Stripe connectivity
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency: number; timestamp: Date }> {
    const startTime = Date.now();
    
    try {
      await this.stripe.customers.list({ limit: 1 });
      const latency = Date.now() - startTime;
      
      return {
        status: 'healthy',
        latency,
        timestamp: new Date()
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        latency,
        timestamp: new Date()
      };
    }
  }
}

// Export singleton instance and types
export const stripeClient = StripeClientManager.getInstance();
export default stripeClient;

// Re-export Stripe types for convenience
export type {
  Stripe,
  PaymentIntent,
  PaymentMethod,
  Customer,
  Subscription,
  Invoice,
  SetupIntent,
  Event as StripeEvent
} from 'stripe';