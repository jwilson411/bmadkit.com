import { Request, Response } from 'express';
import { z } from 'zod';
import { paymentProcessor } from '../services/payment-processor';
import { subscriptionManager } from '../services/subscription-manager';
import { oneTimePurchaseManager, PurchaseType } from '../services/one-time-purchase-manager';
import { invoiceGenerator } from '../services/invoice-generator';
import { dunningManager } from '../services/dunning-manager';
import { stripeClient } from '../utils/stripe-client';
import {
  validatePaymentAmount,
  formatCurrency,
  type CreatePaymentIntentRequest,
  type ConfirmPaymentRequest,
  type ProcessRefundRequest,
  type AttachPaymentMethodRequest
} from '../models/payment';
import {
  SubscriptionPlan,
  type CreateSubscriptionRequest,
  type UpdateSubscriptionRequest,
  type CancelSubscriptionRequest
} from '../models/subscription';

// Request validation schemas
const CreatePaymentIntentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default('usd'),
  paymentMethodId: z.string().optional(),
  customerId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  returnUrl: z.string().url().optional()
});

const ConfirmPaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
  paymentMethodId: z.string().optional(),
  returnUrl: z.string().url().optional()
});

const CreateSubscriptionSchema = z.object({
  userId: z.string().min(1),
  plan: z.nativeEnum(SubscriptionPlan),
  paymentMethodId: z.string().optional(),
  couponCode: z.string().optional(),
  trialDays: z.number().min(0).max(365).optional(),
  metadata: z.record(z.string()).optional()
});

const CreateOneTimePurchaseSchema = z.object({
  userId: z.string().min(1),
  type: z.nativeEnum(PurchaseType),
  customAmount: z.number().positive().optional(),
  paymentMethodId: z.string().optional(),
  metadata: z.record(z.string()).optional()
});

const AttachPaymentMethodSchema = z.object({
  paymentMethodId: z.string().min(1),
  customerId: z.string().min(1),
  setAsDefault: z.boolean().default(false)
});

const CreateInvoiceSchema = z.object({
  customerId: z.string().min(1),
  subscriptionId: z.string().optional(),
  type: z.enum(['subscription', 'one_time', 'usage_based', 'custom']),
  currency: z.string().min(3).max(3).default('usd'),
  lineItems: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitAmount: z.number(),
    metadata: z.record(z.string()).optional()
  })),
  taxRate: z.number().min(0).max(1).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  metadata: z.record(z.string()).optional()
});

// Utility function to extract user ID from request (would integrate with your auth system)
const getUserId = (req: Request): string => {
  // In production, extract from JWT token or session
  return req.headers['x-user-id'] as string || 'default_user';
};

// Utility function to handle async route errors
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: Function) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Payment Intent Endpoints
 */

// POST /api/payments/intents
export const createPaymentIntent = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = CreatePaymentIntentSchema.parse(req.body);
    const { amount, currency, paymentMethodId, customerId, description, metadata, returnUrl } = validatedData;

    // Validate amount
    const amountValidation = validatePaymentAmount(amount, currency);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_AMOUNT',
          message: amountValidation.error
        }
      });
    }

    const request: CreatePaymentIntentRequest = {
      amount,
      currency,
      paymentMethodId,
      customerId: customerId || getUserId(req),
      description: description || 'BMAD Platform Payment',
      metadata: {
        ...metadata,
        userId: getUserId(req),
        source: 'api'
      },
      returnUrl
    };

    const result = await paymentProcessor.createPaymentIntent(request);

    res.status(result.error ? 400 : 200).json({
      success: !result.error,
      data: result.error ? undefined : result.paymentIntent,
      requiresAction: result.requiresAction,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// POST /api/payments/intents/:id/confirm
export const confirmPaymentIntent = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: paymentIntentId } = req.params;
    const validatedData = ConfirmPaymentSchema.parse({
      paymentIntentId,
      ...req.body
    });

    const result = await paymentProcessor.confirmPayment(validatedData);

    res.status(result.error ? 400 : 200).json({
      success: !result.error,
      data: result.error ? undefined : result.paymentIntent,
      requiresAction: result.requiresAction,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Subscription Endpoints
 */

// POST /api/payments/subscriptions
export const createSubscription = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = CreateSubscriptionSchema.parse(req.body);
    
    const result = await subscriptionManager.createSubscription(validatedData);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: result.error ? undefined : result.subscription,
      requiresPaymentMethod: result.requiresPaymentMethod,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// PUT /api/payments/subscriptions/:id
export const updateSubscription = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: subscriptionId } = req.params;
    const validatedData = z.object({
      subscriptionId: z.string().min(1),
      newPlan: z.nativeEnum(SubscriptionPlan).optional(),
      paymentMethodId: z.string().optional(),
      prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']).default('create_prorations'),
      metadata: z.record(z.string()).optional()
    }).parse({
      subscriptionId,
      ...req.body
    });

    const result = await subscriptionManager.updateSubscription(validatedData);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: result.error ? undefined : result.subscription,
      prorationAmount: result.prorationAmount,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// DELETE /api/payments/subscriptions/:id
export const cancelSubscription = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: subscriptionId } = req.params;
    const validatedData = z.object({
      subscriptionId: z.string().min(1),
      immediately: z.boolean().default(false),
      reason: z.string().optional(),
      feedback: z.string().optional()
    }).parse({
      subscriptionId,
      ...req.body
    });

    const result = await subscriptionManager.cancelSubscription(validatedData as CancelSubscriptionRequest);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: result.error ? undefined : result.subscription,
      refundAmount: result.refundAmount,
      error: result.error
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/subscriptions/user/:userId
export const getUserSubscriptions = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const subscriptions = await subscriptionManager.getUserSubscriptions(userId);

    res.json({
      success: true,
      data: subscriptions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * One-Time Purchase Endpoints
 */

// POST /api/payments/purchases
export const createOneTimePurchase = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = CreateOneTimePurchaseSchema.parse(req.body);
    
    const result = await oneTimePurchaseManager.createPurchase(validatedData);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: {
        purchase: result.purchase,
        payment: result.payment
      },
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/purchases/user/:userId
export const getUserPurchases = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const purchases = oneTimePurchaseManager.getUserPurchases(userId);
    const activePurchases = oneTimePurchaseManager.getActivePurchases(userId);

    res.json({
      success: true,
      data: {
        allPurchases: purchases,
        activePurchases
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/purchases/:userId/access/:type
export const checkPurchaseAccess = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { userId, type } = req.params;
    
    if (!Object.values(PurchaseType).includes(type as PurchaseType)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PURCHASE_TYPE',
          message: 'Invalid purchase type'
        }
      });
    }

    const hasAccess = oneTimePurchaseManager.hasAccess(userId, type as PurchaseType);

    res.json({
      success: true,
      data: {
        hasAccess,
        purchaseType: type
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Payment Method Endpoints
 */

// POST /api/payments/methods/attach
export const attachPaymentMethod = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = AttachPaymentMethodSchema.parse(req.body);
    
    const result = await paymentProcessor.attachPaymentMethod(validatedData);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: result.error ? undefined : result.paymentMethod,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// DELETE /api/payments/methods/:id
export const detachPaymentMethod = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: paymentMethodId } = req.params;
    
    const result = await paymentProcessor.detachPaymentMethod(paymentMethodId);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      error: result.error
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/methods/customer/:customerId
export const listCustomerPaymentMethods = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const { type = 'card' } = req.query;
    
    const result = await paymentProcessor.listCustomerPaymentMethods(customerId, type as string);

    res.json({
      success: true,
      data: result.paymentMethods
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Invoice Endpoints
 */

// POST /api/payments/invoices
export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = CreateInvoiceSchema.parse(req.body);
    
    // Convert date string to Date object if provided
    const requestData = {
      ...validatedData,
      dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : undefined
    };

    const result = await invoiceGenerator.createInvoice(requestData as any);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: result.error ? undefined : result.invoice,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/invoices/:id
export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: invoiceId } = req.params;
    const invoice = invoiceGenerator.getInvoice(invoiceId);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'INVOICE_NOT_FOUND',
          message: 'Invoice not found'
        }
      });
    }

    res.json({
      success: true,
      data: invoice
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/invoices/:id/pdf
export const downloadInvoicePDF = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: invoiceId } = req.params;
    
    const result = await invoiceGenerator.generatePDF(invoiceId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PDF_GENERATION_FAILED',
          message: result.error
        }
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// POST /api/payments/invoices/:id/deliver
export const deliverInvoice = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id: invoiceId } = req.params;
    const { deliveryMethod, recipientEmail, webhookUrl, customMessage } = req.body;

    const result = await invoiceGenerator.deliverInvoice({
      invoiceId,
      deliveryMethod,
      recipientEmail,
      webhookUrl,
      customMessage
    });

    res.status(result.success ? 200 : 400).json({
      success: result.success,
      data: result.success ? result : undefined,
      error: result.success ? undefined : { code: 'DELIVERY_FAILED', message: result.error }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Refund Endpoints
 */

// POST /api/payments/refunds
export const processRefund = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = z.object({
      paymentTransactionId: z.string().min(1),
      amount: z.number().positive().optional(),
      reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).default('requested_by_customer'),
      metadata: z.record(z.string()).optional()
    }).parse(req.body);

    const result = await paymentProcessor.processRefund(validatedData);

    res.status(result.error ? 400 : 200).json({
      success: result.success,
      data: result.error ? undefined : result.refund,
      error: result.error
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Analytics and Reporting Endpoints
 */

// GET /api/payments/analytics/purchases
export const getPurchaseStatistics = asyncHandler(async (req: Request, res: Response) => {
  try {
    const statistics = oneTimePurchaseManager.getPurchaseStatistics();

    res.json({
      success: true,
      data: statistics
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

// GET /api/payments/analytics/dunning
export const getDunningStatistics = asyncHandler(async (req: Request, res: Response) => {
  try {
    const statistics = dunningManager.getDunningStatistics();

    res.json({
      success: true,
      data: statistics
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Configuration Endpoints
 */

// GET /api/payments/config
export const getPaymentConfig = asyncHandler(async (req: Request, res: Response) => {
  try {
    const config = {
      stripePublishableKey: stripeClient.getPublishableKey(),
      supportedCurrencies: ['usd', 'eur', 'gbp'],
      subscriptionPlans: Object.values(SubscriptionPlan),
      purchaseTypes: Object.values(PurchaseType)
    };

    res.json({
      success: true,
      data: config
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  }
});

/**
 * Health Check Endpoint
 */

// GET /api/payments/health
export const healthCheck = asyncHandler(async (req: Request, res: Response) => {
  try {
    const [
      paymentProcessorHealth,
      subscriptionManagerHealth,
      invoiceGeneratorHealth,
      dunningManagerHealth
    ] = await Promise.all([
      paymentProcessor.healthCheck(),
      subscriptionManager.healthCheck(),
      invoiceGenerator.healthCheck(),
      dunningManager.healthCheck()
    ]);

    const overallStatus = [
      paymentProcessorHealth,
      subscriptionManagerHealth,
      invoiceGeneratorHealth,
      dunningManagerHealth
    ].every(health => health.status === 'healthy') ? 'healthy' : 'degraded';

    res.status(overallStatus === 'healthy' ? 200 : 503).json({
      success: true,
      status: overallStatus,
      data: {
        paymentProcessor: paymentProcessorHealth,
        subscriptionManager: subscriptionManagerHealth,
        invoiceGenerator: invoiceGeneratorHealth,
        dunningManager: dunningManagerHealth,
        timestamp: new Date()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Health check failed'
      }
    });
  }
});

// Export all route handlers
export {
  // Payment Intents
  createPaymentIntent,
  confirmPaymentIntent,
  
  // Subscriptions
  createSubscription,
  updateSubscription,
  cancelSubscription,
  getUserSubscriptions,
  
  // One-time Purchases
  createOneTimePurchase,
  getUserPurchases,
  checkPurchaseAccess,
  
  // Payment Methods
  attachPaymentMethod,
  detachPaymentMethod,
  listCustomerPaymentMethods,
  
  // Invoices
  createInvoice,
  getInvoice,
  downloadInvoicePDF,
  deliverInvoice,
  
  // Refunds
  processRefund,
  
  // Analytics
  getPurchaseStatistics,
  getDunningStatistics,
  
  // Configuration
  getPaymentConfig,
  
  // Health
  healthCheck
};