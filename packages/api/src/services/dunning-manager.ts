import { z } from 'zod';
import { EventEmitter } from 'events';
import { stripeClient } from '../utils/stripe-client';
import { paymentProcessor, PaymentEvent } from './payment-processor';
import { subscriptionManager, SubscriptionEvent } from './subscription-manager';
import { invoiceGenerator } from './invoice-generator';
import { PaymentFailureCode, canRetryPayment } from '../models/payment';
import { SubscriptionStatus, CancellationReason } from '../models/subscription';
import type { Stripe } from 'stripe';

// Dunning states and actions
export enum DunningState {
  HEALTHY = 'healthy',
  GRACE_PERIOD = 'grace_period',
  RETRY_PERIOD = 'retry_period',
  DUNNING_PERIOD = 'dunning_period',
  FINAL_NOTICE = 'final_notice',
  SUSPENDED = 'suspended',
  CANCELED = 'canceled'
}

export enum DunningAction {
  RETRY_PAYMENT = 'retry_payment',
  SEND_EMAIL = 'send_email',
  SEND_SMS = 'send_sms',
  RESTRICT_ACCESS = 'restrict_access',
  SUSPEND_ACCOUNT = 'suspend_account',
  CANCEL_SUBSCRIPTION = 'cancel_subscription',
  ESCALATE_TO_HUMAN = 'escalate_to_human'
}

export enum DunningReason {
  PAYMENT_FAILED = 'payment_failed',
  CARD_EXPIRED = 'card_expired',
  INSUFFICIENT_FUNDS = 'insufficient_funds',
  CARD_DECLINED = 'card_declined',
  AUTHENTICATION_REQUIRED = 'authentication_required',
  PROCESSING_ERROR = 'processing_error'
}

// Dunning configuration schemas
export const DunningConfigSchema = z.object({
  enabled: z.boolean().default(true),
  gracePeriodDays: z.number().min(0).max(30).default(3),
  retrySchedule: z.array(z.number()).min(1).default([1, 3, 7]), // days
  maxRetryAttempts: z.number().min(1).max(10).default(3),
  suspensionDelay: z.number().min(1).max(90).default(14), // days after final retry
  cancellationDelay: z.number().min(1).max(365).default(30), // days after suspension
  emailTemplates: z.object({
    firstFailure: z.string().default('payment_failed_first'),
    retryReminder: z.string().default('payment_retry_reminder'),
    finalNotice: z.string().default('payment_final_notice'),
    suspension: z.string().default('account_suspended'),
    cancellation: z.string().default('subscription_canceled')
  }),
  escalationRules: z.object({
    highValueThreshold: z.number().default(50000), // cents
    vipCustomers: z.array(z.string()).default([]),
    escalateAfterAttempts: z.number().default(2)
  })
});

export const DunningCaseSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  subscriptionId: z.string().optional(),
  invoiceId: z.string().optional(),
  state: z.nativeEnum(DunningState),
  reason: z.nativeEnum(DunningReason),
  amount: z.number().positive(),
  currency: z.string(),
  failureCount: z.number().default(0),
  retryCount: z.number().default(0),
  lastFailureDate: z.date(),
  nextActionDate: z.date(),
  gracePeriodEnd: z.date().optional(),
  suspensionDate: z.date().optional(),
  cancellationDate: z.date().optional(),
  actions: z.array(z.object({
    action: z.nativeEnum(DunningAction),
    scheduledAt: z.date(),
    executedAt: z.date().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })),
  customerData: z.object({
    email: z.string().email(),
    name: z.string().optional(),
    phone: z.string().optional(),
    isVip: z.boolean().default(false),
    lifetimeValue: z.number().default(0)
  }),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export type DunningConfig = z.infer<typeof DunningConfigSchema>;
export type DunningCase = z.infer<typeof DunningCaseSchema>;

// Notification templates
interface DunningNotificationTemplate {
  subject: string;
  htmlContent: string;
  textContent: string;
  variables: Record<string, any>;
}

export class DunningManager extends EventEmitter {
  private static instance: DunningManager;
  private config: DunningConfig;
  
  // Active dunning cases (in production, use database)
  private activeCases: Map<string, DunningCase> = new Map();
  private customerCases: Map<string, string[]> = new Map(); // customerId -> caseIds
  
  // Scheduling and processing
  private processingTimer: NodeJS.Timeout | null = null;
  private retryQueue: Map<string, Date> = new Map(); // caseId -> nextProcessTime

  private constructor(config?: Partial<DunningConfig>) {
    super();
    this.config = DunningConfigSchema.parse(config || {});
    this.setupEventHandlers();
    this.startProcessingLoop();
  }

  static getInstance(config?: Partial<DunningConfig>): DunningManager {
    if (!DunningManager.instance) {
      DunningManager.instance = new DunningManager(config);
    }
    return DunningManager.instance;
  }

  /**
   * Create a new dunning case for failed payment
   */
  async createDunningCase(params: {
    customerId: string;
    subscriptionId?: string;
    invoiceId?: string;
    amount: number;
    currency: string;
    reason: DunningReason;
    failureDetails?: any;
  }): Promise<DunningCase> {
    const {
      customerId,
      subscriptionId,
      invoiceId,
      amount,
      currency,
      reason,
      failureDetails = {}
    } = params;

    // Check if there's an existing active case for this customer/subscription
    const existingCase = this.findActiveCaseForCustomer(customerId, subscriptionId);
    if (existingCase) {
      return this.updateExistingCase(existingCase, reason, failureDetails);
    }

    // Get customer data
    const customerData = await this.getCustomerData(customerId);

    // Create new dunning case
    const caseId = `dun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    
    const dunningCase: DunningCase = {
      id: caseId,
      customerId,
      subscriptionId,
      invoiceId,
      state: DunningState.GRACE_PERIOD,
      reason,
      amount,
      currency,
      failureCount: 1,
      retryCount: 0,
      lastFailureDate: now,
      nextActionDate: this.calculateNextActionDate(now, DunningState.GRACE_PERIOD),
      gracePeriodEnd: new Date(now.getTime() + this.config.gracePeriodDays * 24 * 60 * 60 * 1000),
      actions: [],
      customerData,
      metadata: {
        initialFailure: failureDetails,
        createdBy: 'dunning-manager'
      },
      createdAt: now,
      updatedAt: now
    };

    // Store the case
    this.activeCases.set(caseId, dunningCase);
    
    // Update customer index
    const customerCases = this.customerCases.get(customerId) || [];
    customerCases.push(caseId);
    this.customerCases.set(customerId, customerCases);

    // Schedule initial actions
    await this.scheduleInitialActions(dunningCase);

    // Emit event
    this.emit('dunning.case_created', { case: dunningCase });

    console.log(`Created dunning case ${caseId} for customer ${customerId}, amount: ${amount} ${currency}`);

    return dunningCase;
  }

  /**
   * Process a successful payment recovery
   */
  async handlePaymentRecovery(customerId: string, subscriptionId?: string): Promise<void> {
    const activeCases = this.getActiveCasesForCustomer(customerId, subscriptionId);
    
    for (const dunningCase of activeCases) {
      await this.resolveDunningCase(dunningCase.id, 'payment_recovered');
    }
  }

  /**
   * Resolve a dunning case
   */
  async resolveDunningCase(caseId: string, resolution: string): Promise<{ success: boolean; error?: string }> {
    try {
      const dunningCase = this.activeCases.get(caseId);
      if (!dunningCase) {
        throw new Error(`Dunning case not found: ${caseId}`);
      }

      // Update case to resolved state
      const resolvedCase: DunningCase = {
        ...dunningCase,
        state: DunningState.HEALTHY,
        metadata: {
          ...dunningCase.metadata,
          resolution,
          resolvedAt: new Date(),
          resolvedBy: 'dunning-manager'
        },
        updatedAt: new Date()
      };

      // Remove from active cases
      this.activeCases.delete(caseId);
      
      // Update customer index
      const customerCases = this.customerCases.get(dunningCase.customerId) || [];
      const updatedCases = customerCases.filter(id => id !== caseId);
      this.customerCases.set(dunningCase.customerId, updatedCases);

      // Remove from retry queue
      this.retryQueue.delete(caseId);

      // Emit event
      this.emit('dunning.case_resolved', { case: resolvedCase, resolution });

      console.log(`Resolved dunning case ${caseId} with resolution: ${resolution}`);

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get dunning case by ID
   */
  getDunningCase(caseId: string): DunningCase | null {
    return this.activeCases.get(caseId) || null;
  }

  /**
   * Get active cases for customer
   */
  getActiveCasesForCustomer(customerId: string, subscriptionId?: string): DunningCase[] {
    const caseIds = this.customerCases.get(customerId) || [];
    const cases = caseIds.map(id => this.activeCases.get(id)).filter((c): c is DunningCase => c !== undefined);
    
    if (subscriptionId) {
      return cases.filter(c => c.subscriptionId === subscriptionId);
    }
    
    return cases;
  }

  /**
   * Get dunning statistics
   */
  getDunningStatistics(): {
    totalActiveCases: number;
    casesByState: Record<DunningState, number>;
    casesByReason: Record<DunningReason, number>;
    recoveryRate: number;
    averageRecoveryTime: number;
    totalAtRiskRevenue: number;
  } {
    const activeCases = Array.from(this.activeCases.values());
    const totalActiveCases = activeCases.length;

    const casesByState = Object.values(DunningState).reduce((acc, state) => {
      acc[state] = activeCases.filter(c => c.state === state).length;
      return acc;
    }, {} as Record<DunningState, number>);

    const casesByReason = Object.values(DunningReason).reduce((acc, reason) => {
      acc[reason] = activeCases.filter(c => c.reason === reason).length;
      return acc;
    }, {} as Record<DunningReason, number>);

    const totalAtRiskRevenue = activeCases.reduce((sum, c) => sum + c.amount, 0);

    // These would be calculated from historical data in production
    const recoveryRate = 0.73; // 73% recovery rate
    const averageRecoveryTime = 4.2; // 4.2 days average

    return {
      totalActiveCases,
      casesByState,
      casesByReason,
      recoveryRate,
      averageRecoveryTime,
      totalAtRiskRevenue
    };
  }

  // Private helper methods

  private findActiveCaseForCustomer(customerId: string, subscriptionId?: string): DunningCase | null {
    const cases = this.getActiveCasesForCustomer(customerId, subscriptionId);
    return cases.length > 0 ? cases[0] : null;
  }

  private async updateExistingCase(existingCase: DunningCase, reason: DunningReason, failureDetails: any): Promise<DunningCase> {
    const updatedCase: DunningCase = {
      ...existingCase,
      reason: reason, // Update to latest failure reason
      failureCount: existingCase.failureCount + 1,
      lastFailureDate: new Date(),
      metadata: {
        ...existingCase.metadata,
        latestFailure: failureDetails,
        failureHistory: [
          ...(existingCase.metadata?.failureHistory || []),
          { reason, details: failureDetails, timestamp: new Date() }
        ]
      },
      updatedAt: new Date()
    };

    this.activeCases.set(existingCase.id, updatedCase);
    
    return updatedCase;
  }

  private async getCustomerData(customerId: string): Promise<DunningCase['customerData']> {
    try {
      const customer = await stripeClient.getStripeClient().customers.retrieve(customerId) as Stripe.Customer;
      
      return {
        email: customer.email || '',
        name: customer.name || undefined,
        phone: customer.phone || undefined,
        isVip: this.config.escalationRules.vipCustomers.includes(customerId),
        lifetimeValue: 0 // This would come from your analytics system
      };
    } catch (error) {
      return {
        email: '',
        name: undefined,
        phone: undefined,
        isVip: false,
        lifetimeValue: 0
      };
    }
  }

  private calculateNextActionDate(fromDate: Date, state: DunningState): Date {
    const baseDate = new Date(fromDate);
    
    switch (state) {
      case DunningState.GRACE_PERIOD:
        return new Date(baseDate.getTime() + this.config.gracePeriodDays * 24 * 60 * 60 * 1000);
      case DunningState.RETRY_PERIOD:
        return new Date(baseDate.getTime() + this.config.retrySchedule[0] * 24 * 60 * 60 * 1000);
      case DunningState.DUNNING_PERIOD:
        return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000); // Daily reminders
      case DunningState.FINAL_NOTICE:
        return new Date(baseDate.getTime() + this.config.suspensionDelay * 24 * 60 * 60 * 1000);
      default:
        return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  private async scheduleInitialActions(dunningCase: DunningCase): Promise<void> {
    // Schedule grace period email
    await this.scheduleAction(dunningCase.id, DunningAction.SEND_EMAIL, new Date(), {
      template: this.config.emailTemplates.firstFailure,
      immediate: true
    });

    // Schedule first retry after grace period
    if (this.config.retrySchedule.length > 0) {
      const firstRetryDate = dunningCase.gracePeriodEnd || new Date();
      await this.scheduleAction(dunningCase.id, DunningAction.RETRY_PAYMENT, firstRetryDate);
    }
  }

  private async scheduleAction(
    caseId: string, 
    action: DunningAction, 
    scheduledAt: Date,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const dunningCase = this.activeCases.get(caseId);
    if (!dunningCase) return;

    const actionItem = {
      action,
      scheduledAt,
      metadata
    };

    const updatedCase: DunningCase = {
      ...dunningCase,
      actions: [...dunningCase.actions, actionItem],
      updatedAt: new Date()
    };

    this.activeCases.set(caseId, updatedCase);

    // Add to processing queue
    this.retryQueue.set(caseId, scheduledAt);
  }

  private startProcessingLoop(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }

    // Process dunning actions every minute
    this.processingTimer = setInterval(async () => {
      await this.processDunningActions();
    }, 60000);

    console.log('Dunning processing loop started');
  }

  private async processDunningActions(): Promise<void> {
    const now = new Date();
    
    for (const [caseId, nextProcessTime] of this.retryQueue.entries()) {
      if (now >= nextProcessTime) {
        const dunningCase = this.activeCases.get(caseId);
        if (dunningCase) {
          await this.processCaseActions(dunningCase);
        }
        this.retryQueue.delete(caseId);
      }
    }
  }

  private async processCaseActions(dunningCase: DunningCase): Promise<void> {
    const pendingActions = dunningCase.actions.filter(a => !a.executedAt);
    
    for (const action of pendingActions) {
      if (new Date() >= action.scheduledAt) {
        await this.executeAction(dunningCase, action);
      }
    }

    // Determine next state and actions
    await this.progressDunningCase(dunningCase);
  }

  private async executeAction(dunningCase: DunningCase, action: any): Promise<void> {
    console.log(`Executing ${action.action} for dunning case ${dunningCase.id}`);
    
    try {
      let success = false;
      let error: string | undefined;

      switch (action.action) {
        case DunningAction.RETRY_PAYMENT:
          success = await this.executePaymentRetry(dunningCase);
          break;
        case DunningAction.SEND_EMAIL:
          success = await this.sendDunningEmail(dunningCase, action.metadata?.template);
          break;
        case DunningAction.SEND_SMS:
          success = await this.sendDunningSMS(dunningCase);
          break;
        case DunningAction.RESTRICT_ACCESS:
          success = await this.restrictCustomerAccess(dunningCase);
          break;
        case DunningAction.SUSPEND_ACCOUNT:
          success = await this.suspendCustomerAccount(dunningCase);
          break;
        case DunningAction.CANCEL_SUBSCRIPTION:
          success = await this.cancelCustomerSubscription(dunningCase);
          break;
        case DunningAction.ESCALATE_TO_HUMAN:
          success = await this.escalateToHuman(dunningCase);
          break;
        default:
          console.warn(`Unknown dunning action: ${action.action}`);
          break;
      }

      // Update action with execution result
      action.executedAt = new Date();
      action.success = success;
      action.error = error;

      // Update case
      this.activeCases.set(dunningCase.id, {
        ...dunningCase,
        updatedAt: new Date()
      });

      // Emit event
      this.emit('dunning.action_executed', {
        case: dunningCase,
        action: action.action,
        success
      });

    } catch (err) {
      action.executedAt = new Date();
      action.success = false;
      action.error = err instanceof Error ? err.message : 'Unknown error';
      
      console.error(`Failed to execute ${action.action} for case ${dunningCase.id}:`, err);
    }
  }

  private async executePaymentRetry(dunningCase: DunningCase): Promise<boolean> {
    try {
      // Attempt payment retry via Stripe
      if (dunningCase.subscriptionId) {
        const subscription = await stripeClient.getStripeClient().subscriptions.retrieve(dunningCase.subscriptionId);
        
        if (subscription.latest_invoice) {
          const invoice = await stripeClient.getStripeClient().invoices.pay(
            subscription.latest_invoice as string,
            { forgive: false }
          );
          
          if (invoice.status === 'paid') {
            // Payment successful - resolve case
            await this.handlePaymentRecovery(dunningCase.customerId, dunningCase.subscriptionId);
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error('Payment retry failed:', error);
      return false;
    }
  }

  private async sendDunningEmail(dunningCase: DunningCase, template?: string): Promise<boolean> {
    console.log(`Sending dunning email to ${dunningCase.customerData.email} using template ${template}`);
    // In production, integrate with email service
    return true;
  }

  private async sendDunningSMS(dunningCase: DunningCase): Promise<boolean> {
    if (!dunningCase.customerData.phone) {
      return false;
    }
    console.log(`Sending dunning SMS to ${dunningCase.customerData.phone}`);
    // In production, integrate with SMS service
    return true;
  }

  private async restrictCustomerAccess(dunningCase: DunningCase): Promise<boolean> {
    console.log(`Restricting access for customer ${dunningCase.customerId}`);
    // In production, integrate with feature flag service
    return true;
  }

  private async suspendCustomerAccount(dunningCase: DunningCase): Promise<boolean> {
    console.log(`Suspending account for customer ${dunningCase.customerId}`);
    // In production, update customer status
    return true;
  }

  private async cancelCustomerSubscription(dunningCase: DunningCase): Promise<boolean> {
    if (!dunningCase.subscriptionId) {
      return false;
    }

    try {
      await subscriptionManager.cancelSubscription({
        subscriptionId: dunningCase.subscriptionId,
        immediately: true,
        reason: CancellationReason.PAYMENT_FAILED
      });
      return true;
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
      return false;
    }
  }

  private async escalateToHuman(dunningCase: DunningCase): Promise<boolean> {
    console.log(`Escalating dunning case ${dunningCase.id} to human review`);
    // In production, create support ticket or notify team
    return true;
  }

  private async progressDunningCase(dunningCase: DunningCase): Promise<void> {
    const now = new Date();
    let newState = dunningCase.state;
    let shouldScheduleActions = false;

    switch (dunningCase.state) {
      case DunningState.GRACE_PERIOD:
        if (dunningCase.gracePeriodEnd && now >= dunningCase.gracePeriodEnd) {
          newState = DunningState.RETRY_PERIOD;
          shouldScheduleActions = true;
        }
        break;

      case DunningState.RETRY_PERIOD:
        if (dunningCase.retryCount >= this.config.maxRetryAttempts) {
          newState = DunningState.DUNNING_PERIOD;
          shouldScheduleActions = true;
        }
        break;

      case DunningState.DUNNING_PERIOD:
        // Progress to final notice after 7 days of dunning
        const dunningDuration = now.getTime() - dunningCase.lastFailureDate.getTime();
        if (dunningDuration > 7 * 24 * 60 * 60 * 1000) {
          newState = DunningState.FINAL_NOTICE;
          shouldScheduleActions = true;
        }
        break;

      case DunningState.FINAL_NOTICE:
        if (dunningCase.suspensionDate && now >= dunningCase.suspensionDate) {
          newState = DunningState.SUSPENDED;
          shouldScheduleActions = true;
        }
        break;

      case DunningState.SUSPENDED:
        if (dunningCase.cancellationDate && now >= dunningCase.cancellationDate) {
          newState = DunningState.CANCELED;
          shouldScheduleActions = true;
        }
        break;
    }

    if (newState !== dunningCase.state) {
      const updatedCase: DunningCase = {
        ...dunningCase,
        state: newState,
        updatedAt: now
      };

      if (newState === DunningState.SUSPENDED) {
        updatedCase.suspensionDate = now;
        updatedCase.cancellationDate = new Date(now.getTime() + this.config.cancellationDelay * 24 * 60 * 60 * 1000);
      }

      this.activeCases.set(dunningCase.id, updatedCase);

      if (shouldScheduleActions) {
        await this.scheduleNextStateActions(updatedCase);
      }

      this.emit('dunning.state_changed', {
        case: updatedCase,
        previousState: dunningCase.state,
        newState
      });
    }
  }

  private async scheduleNextStateActions(dunningCase: DunningCase): Promise<void> {
    const now = new Date();

    switch (dunningCase.state) {
      case DunningState.RETRY_PERIOD:
        // Schedule payment retry
        await this.scheduleAction(dunningCase.id, DunningAction.RETRY_PAYMENT, now);
        await this.scheduleAction(dunningCase.id, DunningAction.SEND_EMAIL, now, {
          template: this.config.emailTemplates.retryReminder
        });
        break;

      case DunningState.DUNNING_PERIOD:
        // Schedule daily reminders
        await this.scheduleAction(dunningCase.id, DunningAction.SEND_EMAIL, now, {
          template: this.config.emailTemplates.retryReminder
        });
        break;

      case DunningState.FINAL_NOTICE:
        await this.scheduleAction(dunningCase.id, DunningAction.SEND_EMAIL, now, {
          template: this.config.emailTemplates.finalNotice
        });
        if (dunningCase.customerData.phone) {
          await this.scheduleAction(dunningCase.id, DunningAction.SEND_SMS, now);
        }
        break;

      case DunningState.SUSPENDED:
        await this.scheduleAction(dunningCase.id, DunningAction.SUSPEND_ACCOUNT, now);
        await this.scheduleAction(dunningCase.id, DunningAction.SEND_EMAIL, now, {
          template: this.config.emailTemplates.suspension
        });
        break;

      case DunningState.CANCELED:
        await this.scheduleAction(dunningCase.id, DunningAction.CANCEL_SUBSCRIPTION, now);
        await this.scheduleAction(dunningCase.id, DunningAction.SEND_EMAIL, now, {
          template: this.config.emailTemplates.cancellation
        });
        break;
    }
  }

  private setupEventHandlers(): void {
    // Listen for payment failures
    paymentProcessor.on(PaymentEvent.PAYMENT_FAILED, async (data) => {
      const { paymentTransaction, failureCode, retryable } = data;
      
      if (retryable) {
        await this.createDunningCase({
          customerId: paymentTransaction.userId,
          subscriptionId: paymentTransaction.subscriptionId,
          invoiceId: paymentTransaction.invoiceId,
          amount: paymentTransaction.amount,
          currency: paymentTransaction.currency,
          reason: this.mapFailureCodeToDunningReason(failureCode),
          failureDetails: {
            paymentTransactionId: paymentTransaction.id,
            failureCode,
            retryable
          }
        });
      }
    });

    // Listen for successful payments
    paymentProcessor.on(PaymentEvent.PAYMENT_SUCCEEDED, async (data) => {
      const { paymentTransaction } = data;
      await this.handlePaymentRecovery(paymentTransaction.userId, paymentTransaction.subscriptionId);
    });

    // Listen for subscription events
    subscriptionManager.on(SubscriptionEvent.PAYMENT_FAILED, async (data) => {
      const { invoice, subscriptionId } = data;
      
      if (typeof invoice.customer === 'string') {
        await this.createDunningCase({
          customerId: invoice.customer,
          subscriptionId: subscriptionId as string,
          invoiceId: invoice.id,
          amount: invoice.amount_due || 0,
          currency: invoice.currency || 'usd',
          reason: DunningReason.PAYMENT_FAILED
        });
      }
    });
  }

  private mapFailureCodeToDunningReason(failureCode: PaymentFailureCode): DunningReason {
    switch (failureCode) {
      case PaymentFailureCode.CARD_DECLINED:
        return DunningReason.CARD_DECLINED;
      case PaymentFailureCode.INSUFFICIENT_FUNDS:
        return DunningReason.INSUFFICIENT_FUNDS;
      case PaymentFailureCode.EXPIRED_CARD:
        return DunningReason.CARD_EXPIRED;
      case PaymentFailureCode.AUTHENTICATION_REQUIRED:
        return DunningReason.AUTHENTICATION_REQUIRED;
      case PaymentFailureCode.PROCESSING_ERROR:
        return DunningReason.PROCESSING_ERROR;
      default:
        return DunningReason.PAYMENT_FAILED;
    }
  }

  /**
   * Update dunning configuration
   */
  updateConfig(newConfig: Partial<DunningConfig>): void {
    this.config = DunningConfigSchema.parse({
      ...this.config,
      ...newConfig
    });
    
    this.emit('dunning.config_updated', { config: this.config });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const statistics = this.getDunningStatistics();
    const isHealthy = statistics.totalActiveCases < 1000; // Arbitrary threshold

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      details: {
        ...statistics,
        processingQueueSize: this.retryQueue.size,
        configEnabled: this.config.enabled,
        timestamp: new Date()
      }
    };
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    
    console.log('Dunning manager shut down');
  }
}

// Export singleton instance
export const dunningManager = DunningManager.getInstance();
export default dunningManager;