import { z } from 'zod';
import { EventEmitter } from 'events';
import { stripeClient } from '../utils/stripe-client';
import { paymentProcessor, PaymentEvent } from './payment-processor';
import {
  PaymentTransaction,
  PaymentStatus,
  validatePaymentAmount,
  formatCurrency,
  type CreatePaymentIntentRequest,
  type CreatePaymentIntentResponse
} from '../models/payment';

// One-time purchase types
export enum PurchaseType {
  PLANNING_SESSION = 'planning_session',
  DOCUMENT_EXPORT = 'document_export',
  PREMIUM_TEMPLATE = 'premium_template',
  CONSULTATION_HOUR = 'consultation_hour',
  CUSTOM_INTEGRATION = 'custom_integration'
}

export enum PurchaseStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded'
}

// Purchase validation schemas
export const OneTimePurchaseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.nativeEnum(PurchaseType),
  status: z.nativeEnum(PurchaseStatus),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  paymentTransactionId: z.string().optional(),
  stripePaymentIntentId: z.string().optional(),
  description: z.string(),
  metadata: z.record(z.any()).optional(),
  expiresAt: z.date().optional(),
  purchasedAt: z.date().optional(),
  accessGrantedAt: z.date().optional(),
  accessRevokedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export type OneTimePurchase = z.infer<typeof OneTimePurchaseSchema>;

// Purchase configuration for each type
interface PurchaseConfiguration {
  type: PurchaseType;
  name: string;
  description: string;
  basePrice: number; // in cents
  currency: string;
  accessDuration?: number; // in days, undefined means permanent
  features: string[];
  metadata: Record<string, any>;
}

export const PURCHASE_CONFIGURATIONS: Record<PurchaseType, PurchaseConfiguration> = {
  [PurchaseType.PLANNING_SESSION]: {
    type: PurchaseType.PLANNING_SESSION,
    name: 'Single Planning Session',
    description: 'One complete BMAD planning session with full document generation',
    basePrice: 4999, // $49.99
    currency: 'usd',
    accessDuration: 30, // 30 days access
    features: [
      'Full BMAD methodology workflow',
      'AI-powered analysis and recommendations',
      'Complete document generation',
      'PDF export included',
      'Session history and templates',
      '30-day access to generated content'
    ],
    metadata: {
      sessionType: 'full',
      includesExport: true,
      maxDocuments: 10
    }
  },
  [PurchaseType.DOCUMENT_EXPORT]: {
    type: PurchaseType.DOCUMENT_EXPORT,
    name: 'Premium Document Export',
    description: 'Export documents in multiple formats with custom branding',
    basePrice: 999, // $9.99
    currency: 'usd',
    features: [
      'Multiple export formats (PDF, DOCX, HTML)',
      'Custom branding and logos',
      'High-resolution exports',
      'Batch export capability'
    ],
    metadata: {
      formats: ['pdf', 'docx', 'html'],
      customBranding: true,
      batchExport: true
    }
  },
  [PurchaseType.PREMIUM_TEMPLATE]: {
    type: PurchaseType.PREMIUM_TEMPLATE,
    name: 'Premium Template Pack',
    description: 'Access to industry-specific premium planning templates',
    basePrice: 1999, // $19.99
    currency: 'usd',
    features: [
      'Industry-specific templates',
      'Advanced customization options',
      'Expert-designed layouts',
      'Lifetime access to templates'
    ],
    metadata: {
      templateCount: 25,
      industries: ['tech', 'healthcare', 'finance', 'retail'],
      lifetimeAccess: true
    }
  },
  [PurchaseType.CONSULTATION_HOUR]: {
    type: PurchaseType.CONSULTATION_HOUR,
    name: '1-Hour Expert Consultation',
    description: 'One-on-one consultation with BMAD methodology expert',
    basePrice: 19999, // $199.99
    currency: 'usd',
    accessDuration: 90, // 90 days to schedule
    features: [
      'Expert guidance and advice',
      'Custom strategy development',
      'Q&A session included',
      'Follow-up email summary',
      'Recording available upon request'
    ],
    metadata: {
      duration: 60, // minutes
      expertLevel: 'senior',
      includesRecording: true,
      followUpIncluded: true
    }
  },
  [PurchaseType.CUSTOM_INTEGRATION]: {
    type: PurchaseType.CUSTOM_INTEGRATION,
    name: 'Custom API Integration',
    description: 'Custom integration setup for your existing systems',
    basePrice: 49999, // $499.99
    currency: 'usd',
    accessDuration: 180, // 180 days of support
    features: [
      'Custom API integration development',
      'Testing and validation',
      'Documentation and support',
      '6 months of maintenance',
      'Priority technical support'
    ],
    metadata: {
      developmentHours: 20,
      supportDuration: 180,
      prioritySupport: true,
      documentationIncluded: true
    }
  }
};

// Request/response types
export interface CreatePurchaseRequest {
  userId: string;
  type: PurchaseType;
  customAmount?: number; // for variable pricing
  paymentMethodId?: string;
  metadata?: Record<string, string>;
}

export interface CreatePurchaseResponse {
  purchase: {
    id: string;
    type: PurchaseType;
    amount: number;
    currency: string;
    status: PurchaseStatus;
    expiresAt?: Date;
  };
  payment: CreatePaymentIntentResponse;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface CompletePurchaseRequest {
  purchaseId: string;
  paymentIntentId: string;
}

export interface CompletePurchaseResponse {
  purchase: OneTimePurchase;
  accessGranted: boolean;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

// Purchase events
export enum PurchaseEvent {
  PURCHASE_CREATED = 'purchase.created',
  PURCHASE_COMPLETED = 'purchase.completed',
  PURCHASE_FAILED = 'purchase.failed',
  PURCHASE_EXPIRED = 'purchase.expired',
  ACCESS_GRANTED = 'purchase.access_granted',
  ACCESS_REVOKED = 'purchase.access_revoked'
}

export class OneTimePurchaseManager extends EventEmitter {
  private static instance: OneTimePurchaseManager;

  // In-memory cache (in production, use Redis)
  private purchaseCache: Map<string, OneTimePurchase> = new Map();
  private userPurchases: Map<string, string[]> = new Map(); // userId -> purchaseIds

  private constructor() {
    super();
    this.setupEventHandlers();
    this.startExpirationProcessor();
  }

  static getInstance(): OneTimePurchaseManager {
    if (!OneTimePurchaseManager.instance) {
      OneTimePurchaseManager.instance = new OneTimePurchaseManager();
    }
    return OneTimePurchaseManager.instance;
  }

  /**
   * Create a new one-time purchase
   */
  async createPurchase(request: CreatePurchaseRequest): Promise<CreatePurchaseResponse> {
    try {
      const { userId, type, customAmount, paymentMethodId, metadata = {} } = request;

      // Get purchase configuration
      const config = PURCHASE_CONFIGURATIONS[type];
      if (!config) {
        throw new Error(`Invalid purchase type: ${type}`);
      }

      // Calculate amount (use custom amount if provided and valid)
      const amount = customAmount && customAmount > 0 ? customAmount : config.basePrice;
      const currency = config.currency;

      // Validate amount
      const amountValidation = validatePaymentAmount(amount, currency);
      if (!amountValidation.valid) {
        throw new Error(amountValidation.error);
      }

      // Create purchase record
      const purchaseId = `purch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const expiresAt = config.accessDuration 
        ? new Date(Date.now() + config.accessDuration * 24 * 60 * 60 * 1000)
        : undefined;

      const purchase: OneTimePurchase = {
        id: purchaseId,
        userId,
        type,
        status: PurchaseStatus.PENDING,
        amount,
        currency,
        description: config.description,
        metadata: {
          ...metadata,
          configuration: config.metadata,
          createdBy: 'one-time-purchase-manager'
        },
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Create payment intent
      const paymentRequest: CreatePaymentIntentRequest = {
        amount,
        currency,
        paymentMethodId,
        description: `${config.name} - ${config.description}`,
        metadata: {
          purchaseId,
          userId,
          purchaseType: type,
          ...metadata
        }
      };

      const paymentResponse = await paymentProcessor.createPaymentIntent(paymentRequest);

      if (!paymentResponse.error) {
        // Update purchase with payment info
        purchase.stripePaymentIntentId = paymentResponse.paymentIntent.id;
        purchase.status = PurchaseStatus.PROCESSING;
        purchase.updatedAt = new Date();
      }

      // Store purchase
      this.purchaseCache.set(purchaseId, purchase);
      
      // Update user purchases index
      const userPurchaseIds = this.userPurchases.get(userId) || [];
      userPurchaseIds.push(purchaseId);
      this.userPurchases.set(userId, userPurchaseIds);

      // Emit event
      this.emit(PurchaseEvent.PURCHASE_CREATED, { purchase });

      return {
        purchase: {
          id: purchase.id,
          type: purchase.type,
          amount: purchase.amount,
          currency: purchase.currency,
          status: purchase.status,
          expiresAt: purchase.expiresAt
        },
        payment: paymentResponse,
        success: !paymentResponse.error,
        error: paymentResponse.error
      };

    } catch (error) {
      return {
        purchase: {
          id: '',
          type: request.type,
          amount: 0,
          currency: 'usd',
          status: PurchaseStatus.FAILED
        },
        payment: {
          paymentIntent: {
            id: '',
            clientSecret: '',
            status: PaymentStatus.FAILED,
            amount: 0,
            currency: 'usd'
          },
          requiresAction: false
        },
        success: false,
        error: {
          code: 'PURCHASE_CREATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
  }

  /**
   * Complete a purchase after successful payment
   */
  async completePurchase(request: CompletePurchaseRequest): Promise<CompletePurchaseResponse> {
    try {
      const { purchaseId, paymentIntentId } = request;

      // Get purchase
      const purchase = this.purchaseCache.get(purchaseId);
      if (!purchase) {
        throw new Error(`Purchase not found: ${purchaseId}`);
      }

      if (purchase.stripePaymentIntentId !== paymentIntentId) {
        throw new Error('Payment intent ID mismatch');
      }

      // Verify payment was successful
      const paymentTransaction = Array.from(paymentProcessor['paymentCache'].values())
        .find(pt => pt.stripePaymentIntentId === paymentIntentId);

      if (!paymentTransaction || paymentTransaction.status !== PaymentStatus.SUCCEEDED) {
        throw new Error('Payment not successful');
      }

      // Update purchase status
      const completedPurchase: OneTimePurchase = {
        ...purchase,
        status: PurchaseStatus.COMPLETED,
        paymentTransactionId: paymentTransaction.id,
        purchasedAt: new Date(),
        accessGrantedAt: new Date(),
        updatedAt: new Date()
      };

      // Store updated purchase
      this.purchaseCache.set(purchaseId, completedPurchase);

      // Grant access based on purchase type
      const accessGranted = await this.grantAccess(completedPurchase);

      // Emit events
      this.emit(PurchaseEvent.PURCHASE_COMPLETED, { purchase: completedPurchase });
      if (accessGranted) {
        this.emit(PurchaseEvent.ACCESS_GRANTED, { purchase: completedPurchase });
      }

      return {
        purchase: completedPurchase,
        accessGranted,
        success: true
      };

    } catch (error) {
      const purchase = this.purchaseCache.get(request.purchaseId);
      if (purchase) {
        // Mark purchase as failed
        const failedPurchase: OneTimePurchase = {
          ...purchase,
          status: PurchaseStatus.FAILED,
          updatedAt: new Date()
        };
        this.purchaseCache.set(request.purchaseId, failedPurchase);
        this.emit(PurchaseEvent.PURCHASE_FAILED, { purchase: failedPurchase });
      }

      return {
        purchase: purchase!,
        accessGranted: false,
        success: false,
        error: {
          code: 'PURCHASE_COMPLETION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error occurred'
        }
      };
    }
  }

  /**
   * Get purchase by ID
   */
  getPurchase(purchaseId: string): OneTimePurchase | null {
    return this.purchaseCache.get(purchaseId) || null;
  }

  /**
   * Get user purchases
   */
  getUserPurchases(userId: string): OneTimePurchase[] {
    const purchaseIds = this.userPurchases.get(userId) || [];
    return purchaseIds
      .map(id => this.purchaseCache.get(id))
      .filter((purchase): purchase is OneTimePurchase => purchase !== undefined)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Check if user has access to specific purchase type
   */
  hasAccess(userId: string, purchaseType: PurchaseType): boolean {
    const userPurchases = this.getUserPurchases(userId);
    return userPurchases.some(purchase => 
      purchase.type === purchaseType &&
      purchase.status === PurchaseStatus.COMPLETED &&
      purchase.accessGrantedAt &&
      !purchase.accessRevokedAt &&
      (!purchase.expiresAt || purchase.expiresAt > new Date())
    );
  }

  /**
   * Get active purchases for user
   */
  getActivePurchases(userId: string): OneTimePurchase[] {
    return this.getUserPurchases(userId).filter(purchase =>
      purchase.status === PurchaseStatus.COMPLETED &&
      purchase.accessGrantedAt &&
      !purchase.accessRevokedAt &&
      (!purchase.expiresAt || purchase.expiresAt > new Date())
    );
  }

  /**
   * Revoke access for a purchase
   */
  async revokeAccess(purchaseId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const purchase = this.purchaseCache.get(purchaseId);
      if (!purchase) {
        throw new Error(`Purchase not found: ${purchaseId}`);
      }

      if (purchase.accessRevokedAt) {
        throw new Error('Access already revoked');
      }

      const revokedPurchase: OneTimePurchase = {
        ...purchase,
        accessRevokedAt: new Date(),
        metadata: {
          ...purchase.metadata,
          revocationReason: reason,
          revokedBy: 'one-time-purchase-manager'
        },
        updatedAt: new Date()
      };

      this.purchaseCache.set(purchaseId, revokedPurchase);

      // Perform access revocation logic here
      await this.performAccessRevocation(revokedPurchase);

      this.emit(PurchaseEvent.ACCESS_REVOKED, { purchase: revokedPurchase, reason });

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get purchase statistics
   */
  getPurchaseStatistics(): {
    totalPurchases: number;
    totalRevenue: number;
    purchasesByType: Record<PurchaseType, { count: number; revenue: number }>;
    conversionRate: number;
    averagePurchaseValue: number;
  } {
    const allPurchases = Array.from(this.purchaseCache.values());
    const completedPurchases = allPurchases.filter(p => p.status === PurchaseStatus.COMPLETED);
    
    const totalPurchases = completedPurchases.length;
    const totalRevenue = completedPurchases.reduce((sum, p) => sum + p.amount, 0);
    const averagePurchaseValue = totalPurchases > 0 ? totalRevenue / totalPurchases : 0;
    const conversionRate = allPurchases.length > 0 ? totalPurchases / allPurchases.length : 0;

    const purchasesByType = Object.values(PurchaseType).reduce((acc, type) => {
      const typePurchases = completedPurchases.filter(p => p.type === type);
      acc[type] = {
        count: typePurchases.length,
        revenue: typePurchases.reduce((sum, p) => sum + p.amount, 0)
      };
      return acc;
    }, {} as Record<PurchaseType, { count: number; revenue: number }>);

    return {
      totalPurchases,
      totalRevenue,
      purchasesByType,
      conversionRate,
      averagePurchaseValue
    };
  }

  /**
   * Grant access based on purchase type
   */
  private async grantAccess(purchase: OneTimePurchase): Promise<boolean> {
    try {
      const config = PURCHASE_CONFIGURATIONS[purchase.type];
      
      switch (purchase.type) {
        case PurchaseType.PLANNING_SESSION:
          // Grant session access - in production, update user permissions
          console.log(`Granted planning session access to user ${purchase.userId}`);
          return true;

        case PurchaseType.DOCUMENT_EXPORT:
          // Grant export access - in production, update feature flags
          console.log(`Granted document export access to user ${purchase.userId}`);
          return true;

        case PurchaseType.PREMIUM_TEMPLATE:
          // Grant template access - in production, unlock premium templates
          console.log(`Granted premium template access to user ${purchase.userId}`);
          return true;

        case PurchaseType.CONSULTATION_HOUR:
          // Schedule consultation - in production, integrate with calendar system
          console.log(`Granted consultation access to user ${purchase.userId}`);
          return true;

        case PurchaseType.CUSTOM_INTEGRATION:
          // Create integration project - in production, create project and assign developer
          console.log(`Created custom integration project for user ${purchase.userId}`);
          return true;

        default:
          console.warn(`Unknown purchase type: ${purchase.type}`);
          return false;
      }
    } catch (error) {
      console.error('Error granting access:', error);
      return false;
    }
  }

  /**
   * Revoke access (implementation depends on purchase type)
   */
  private async performAccessRevocation(purchase: OneTimePurchase): Promise<void> {
    // Implementation would depend on the specific purchase type
    console.log(`Access revoked for purchase ${purchase.id} of type ${purchase.type}`);
  }

  /**
   * Process expired purchases
   */
  private startExpirationProcessor(): void {
    setInterval(() => {
      const now = new Date();
      
      for (const [purchaseId, purchase] of this.purchaseCache.entries()) {
        if (purchase.expiresAt && 
            purchase.expiresAt <= now && 
            purchase.status === PurchaseStatus.COMPLETED &&
            !purchase.accessRevokedAt) {
          
          // Mark as expired
          const expiredPurchase: OneTimePurchase = {
            ...purchase,
            status: PurchaseStatus.EXPIRED,
            accessRevokedAt: now,
            metadata: {
              ...purchase.metadata,
              expiredBy: 'expiration-processor'
            },
            updatedAt: now
          };

          this.purchaseCache.set(purchaseId, expiredPurchase);
          this.emit(PurchaseEvent.PURCHASE_EXPIRED, { purchase: expiredPurchase });
          this.emit(PurchaseEvent.ACCESS_REVOKED, { purchase: expiredPurchase, reason: 'expired' });
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    // Listen for payment events
    paymentProcessor.on(PaymentEvent.PAYMENT_SUCCEEDED, async (data) => {
      const { paymentTransaction } = data;
      
      // Find associated purchase
      const purchase = Array.from(this.purchaseCache.values())
        .find(p => p.stripePaymentIntentId === paymentTransaction.stripePaymentIntentId);
      
      if (purchase) {
        await this.completePurchase({
          purchaseId: purchase.id,
          paymentIntentId: paymentTransaction.stripePaymentIntentId
        });
      }
    });

    paymentProcessor.on(PaymentEvent.PAYMENT_FAILED, (data) => {
      const { paymentTransaction } = data;
      
      // Find associated purchase and mark as failed
      const purchase = Array.from(this.purchaseCache.values())
        .find(p => p.stripePaymentIntentId === paymentTransaction.stripePaymentIntentId);
      
      if (purchase) {
        const failedPurchase: OneTimePurchase = {
          ...purchase,
          status: PurchaseStatus.FAILED,
          updatedAt: new Date()
        };
        
        this.purchaseCache.set(purchase.id, failedPurchase);
        this.emit(PurchaseEvent.PURCHASE_FAILED, { purchase: failedPurchase });
      }
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const details = {
      purchaseCacheSize: this.purchaseCache.size,
      userPurchasesSize: this.userPurchases.size,
      statistics: this.getPurchaseStatistics(),
      timestamp: new Date()
    };

    return { status: 'healthy', details };
  }
}

// Export singleton instance
export const oneTimePurchaseManager = OneTimePurchaseManager.getInstance();
export default oneTimePurchaseManager;