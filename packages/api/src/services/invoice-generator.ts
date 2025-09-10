import { z } from 'zod';
import { EventEmitter } from 'events';
import PDFDocument from 'pdfkit';
import { promises as fs } from 'fs';
import path from 'path';
import { stripeClient } from '../utils/stripe-client';
import type { Stripe } from 'stripe';
import { formatCurrency } from '../models/payment';

// Invoice types and statuses
export enum InvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  VOID = 'void',
  UNCOLLECTIBLE = 'uncollectible'
}

export enum InvoiceType {
  SUBSCRIPTION = 'subscription',
  ONE_TIME = 'one_time',
  USAGE_BASED = 'usage_based',
  CUSTOM = 'custom'
}

// Invoice data schemas
export const InvoiceLineItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number().positive(),
  unitAmount: z.number(),
  amount: z.number(),
  currency: z.string().min(3).max(3),
  metadata: z.record(z.string()).optional()
});

export const InvoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  stripeInvoiceId: z.string().optional(),
  customerId: z.string(),
  subscriptionId: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus),
  type: z.nativeEnum(InvoiceType),
  currency: z.string().min(3).max(3),
  subtotal: z.number(),
  tax: z.number().default(0),
  total: z.number(),
  amountDue: z.number(),
  amountPaid: z.number().default(0),
  lineItems: z.array(InvoiceLineItemSchema),
  dueDate: z.date().optional(),
  paidAt: z.date().optional(),
  voidedAt: z.date().optional(),
  issueDate: z.date(),
  periodStart: z.date().optional(),
  periodEnd: z.date().optional(),
  customerDetails: z.object({
    name: z.string(),
    email: z.string().email(),
    address: z.object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional()
    }).optional(),
    phone: z.string().optional(),
    taxId: z.string().optional()
  }),
  companyDetails: z.object({
    name: z.string(),
    address: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string()
    }),
    email: z.string().email(),
    phone: z.string().optional(),
    website: z.string().url().optional(),
    taxId: z.string().optional(),
    logoUrl: z.string().url().optional()
  }),
  notes: z.string().optional(),
  footerText: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;

// Invoice generation requests
export interface CreateInvoiceRequest {
  customerId: string;
  subscriptionId?: string;
  type: InvoiceType;
  currency?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    metadata?: Record<string, string>;
  }>;
  taxRate?: number;
  dueDate?: Date;
  periodStart?: Date;
  periodEnd?: Date;
  notes?: string;
  metadata?: Record<string, string>;
}

export interface InvoiceDeliveryRequest {
  invoiceId: string;
  deliveryMethod: 'email' | 'webhook' | 'download';
  recipientEmail?: string;
  webhookUrl?: string;
  customMessage?: string;
}

export interface InvoiceDeliveryResult {
  invoiceId: string;
  deliveryMethod: string;
  success: boolean;
  deliveredAt?: Date;
  error?: string;
  trackingId?: string;
}

// Tax calculation service integration
interface TaxCalculationRequest {
  customerId: string;
  lineItems: InvoiceLineItem[];
  currency: string;
  customerAddress?: any;
}

interface TaxCalculationResult {
  totalTax: number;
  taxBreakdown: Array<{
    type: string;
    rate: number;
    amount: number;
    jurisdiction: string;
  }>;
}

// Company configuration
const COMPANY_DETAILS = {
  name: 'BMAD Planning Solutions',
  address: {
    line1: '123 Business District',
    line2: 'Suite 456',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'USA'
  },
  email: 'billing@bmadkit.com',
  phone: '+1 (555) 123-4567',
  website: 'https://bmadkit.com',
  taxId: '12-3456789',
  logoUrl: 'https://bmadkit.com/assets/logo.png'
};

export class InvoiceGenerator extends EventEmitter {
  private static instance: InvoiceGenerator;
  private stripe: Stripe;
  
  // Invoice storage (in production, use database)
  private invoiceCache: Map<string, Invoice> = new Map();
  private deliveryTracking: Map<string, InvoiceDeliveryResult[]> = new Map();
  
  // Invoice numbering
  private nextInvoiceNumber: number = 1000;

  private constructor() {
    super();
    this.stripe = stripeClient.getStripeClient();
  }

  static getInstance(): InvoiceGenerator {
    if (!InvoiceGenerator.instance) {
      InvoiceGenerator.instance = new InvoiceGenerator();
    }
    return InvoiceGenerator.instance;
  }

  /**
   * Create a new invoice
   */
  async createInvoice(request: CreateInvoiceRequest): Promise<{ invoice: Invoice; success: boolean; error?: string }> {
    try {
      const {
        customerId,
        subscriptionId,
        type,
        currency = 'usd',
        lineItems,
        taxRate = 0,
        dueDate,
        periodStart,
        periodEnd,
        notes,
        metadata = {}
      } = request;

      // Generate invoice number
      const invoiceNumber = this.generateInvoiceNumber();
      const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Get customer details
      const customerDetails = await this.getCustomerDetails(customerId);

      // Process line items
      const processedLineItems: InvoiceLineItem[] = lineItems.map((item, index) => ({
        id: `li_${invoiceId}_${index}`,
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        amount: item.quantity * item.unitAmount,
        currency,
        metadata: item.metadata
      }));

      // Calculate subtotal
      const subtotal = processedLineItems.reduce((sum, item) => sum + item.amount, 0);

      // Calculate tax
      const tax = await this.calculateTax({
        customerId,
        lineItems: processedLineItems,
        currency,
        customerAddress: customerDetails.address
      });

      // Calculate total
      const total = subtotal + tax.totalTax;

      // Create invoice
      const invoice: Invoice = {
        id: invoiceId,
        number: invoiceNumber,
        customerId,
        subscriptionId,
        status: InvoiceStatus.OPEN,
        type,
        currency,
        subtotal,
        tax: tax.totalTax,
        total,
        amountDue: total,
        amountPaid: 0,
        lineItems: processedLineItems,
        dueDate,
        issueDate: new Date(),
        periodStart,
        periodEnd,
        customerDetails,
        companyDetails: COMPANY_DETAILS,
        notes,
        metadata: {
          ...metadata,
          taxBreakdown: tax.taxBreakdown,
          createdBy: 'invoice-generator'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Store invoice
      this.invoiceCache.set(invoiceId, invoice);

      // Create corresponding Stripe invoice if needed
      if (type === InvoiceType.SUBSCRIPTION && subscriptionId) {
        try {
          const stripeInvoice = await this.createStripeInvoice(invoice);
          invoice.stripeInvoiceId = stripeInvoice.id;
          this.invoiceCache.set(invoiceId, invoice);
        } catch (error) {
          console.warn('Failed to create Stripe invoice:', error);
          // Continue without Stripe invoice - internal invoice is still valid
        }
      }

      // Emit event
      this.emit('invoice.created', { invoice });

      return { invoice, success: true };

    } catch (error) {
      return {
        invoice: {} as Invoice,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Generate PDF invoice
   */
  async generatePDF(invoiceId: string): Promise<{ buffer: Buffer; filename: string; success: boolean; error?: string }> {
    try {
      const invoice = this.invoiceCache.get(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      // Collect PDF data
      doc.on('data', buffer => buffers.push(buffer));
      
      return new Promise((resolve, reject) => {
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve({
            buffer: pdfBuffer,
            filename: `invoice-${invoice.number}.pdf`,
            success: true
          });
        });

        doc.on('error', (error) => {
          reject({
            buffer: Buffer.alloc(0),
            filename: '',
            success: false,
            error: error.message
          });
        });

        // Generate PDF content
        this.renderPDFContent(doc, invoice);
        doc.end();
      });

    } catch (error) {
      return {
        buffer: Buffer.alloc(0),
        filename: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Deliver invoice via specified method
   */
  async deliverInvoice(request: InvoiceDeliveryRequest): Promise<InvoiceDeliveryResult> {
    try {
      const { invoiceId, deliveryMethod, recipientEmail, webhookUrl, customMessage } = request;
      
      const invoice = this.invoiceCache.get(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      let result: InvoiceDeliveryResult;

      switch (deliveryMethod) {
        case 'email':
          result = await this.deliverByEmail(invoice, recipientEmail, customMessage);
          break;
        case 'webhook':
          result = await this.deliverByWebhook(invoice, webhookUrl);
          break;
        case 'download':
          result = await this.prepareForDownload(invoice);
          break;
        default:
          throw new Error(`Unsupported delivery method: ${deliveryMethod}`);
      }

      // Track delivery
      const deliveries = this.deliveryTracking.get(invoiceId) || [];
      deliveries.push(result);
      this.deliveryTracking.set(invoiceId, deliveries);

      // Emit event
      this.emit('invoice.delivered', { invoice, result });

      return result;

    } catch (error) {
      const errorResult: InvoiceDeliveryResult = {
        invoiceId: request.invoiceId,
        deliveryMethod: request.deliveryMethod,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };

      // Track failed delivery
      const deliveries = this.deliveryTracking.get(request.invoiceId) || [];
      deliveries.push(errorResult);
      this.deliveryTracking.set(request.invoiceId, deliveries);

      return errorResult;
    }
  }

  /**
   * Mark invoice as paid
   */
  async markAsPaid(invoiceId: string, paidAmount: number, paidAt: Date = new Date()): Promise<{ success: boolean; error?: string }> {
    try {
      const invoice = this.invoiceCache.get(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      const updatedInvoice: Invoice = {
        ...invoice,
        status: paidAmount >= invoice.amountDue ? InvoiceStatus.PAID : InvoiceStatus.OPEN,
        amountPaid: paidAmount,
        amountDue: Math.max(0, invoice.total - paidAmount),
        paidAt: paidAmount >= invoice.amountDue ? paidAt : invoice.paidAt,
        updatedAt: new Date()
      };

      this.invoiceCache.set(invoiceId, updatedInvoice);

      // Emit event
      this.emit('invoice.paid', { invoice: updatedInvoice, paidAmount, paidAt });

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Void an invoice
   */
  async voidInvoice(invoiceId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const invoice = this.invoiceCache.get(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      if (invoice.status === InvoiceStatus.PAID) {
        throw new Error('Cannot void a paid invoice');
      }

      const voidedInvoice: Invoice = {
        ...invoice,
        status: InvoiceStatus.VOID,
        voidedAt: new Date(),
        metadata: {
          ...invoice.metadata,
          voidReason: reason,
          voidedBy: 'invoice-generator'
        },
        updatedAt: new Date()
      };

      this.invoiceCache.set(invoiceId, voidedInvoice);

      // Void Stripe invoice if exists
      if (voidedInvoice.stripeInvoiceId) {
        try {
          await this.stripe.invoices.voidInvoice(voidedInvoice.stripeInvoiceId);
        } catch (error) {
          console.warn('Failed to void Stripe invoice:', error);
        }
      }

      // Emit event
      this.emit('invoice.voided', { invoice: voidedInvoice, reason });

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get invoice by ID
   */
  getInvoice(invoiceId: string): Invoice | null {
    return this.invoiceCache.get(invoiceId) || null;
  }

  /**
   * Get customer invoices
   */
  getCustomerInvoices(customerId: string): Invoice[] {
    return Array.from(this.invoiceCache.values())
      .filter(invoice => invoice.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get delivery history for invoice
   */
  getDeliveryHistory(invoiceId: string): InvoiceDeliveryResult[] {
    return this.deliveryTracking.get(invoiceId) || [];
  }

  // Private helper methods

  private generateInvoiceNumber(): string {
    const year = new Date().getFullYear();
    const number = this.nextInvoiceNumber++;
    return `INV-${year}-${number.toString().padStart(4, '0')}`;
  }

  private async getCustomerDetails(customerId: string): Promise<any> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId) as Stripe.Customer;
      
      return {
        name: customer.name || customer.email || 'Unknown Customer',
        email: customer.email || '',
        address: customer.address ? {
          line1: customer.address.line1,
          line2: customer.address.line2,
          city: customer.address.city,
          state: customer.address.state,
          postalCode: customer.address.postal_code,
          country: customer.address.country
        } : undefined,
        phone: customer.phone,
        taxId: customer.tax_ids?.data[0]?.value
      };
    } catch (error) {
      // Return default details if customer not found
      return {
        name: 'Unknown Customer',
        email: '',
        address: undefined,
        phone: undefined,
        taxId: undefined
      };
    }
  }

  private async calculateTax(request: TaxCalculationRequest): Promise<TaxCalculationResult> {
    // Simplified tax calculation - in production, integrate with tax service like TaxJar
    const { lineItems, customerAddress } = request;
    
    // Default tax rate based on location
    let taxRate = 0;
    if (customerAddress?.state === 'CA') {
      taxRate = 0.0875; // 8.75% CA tax rate
    } else if (customerAddress?.country === 'USA') {
      taxRate = 0.05; // 5% default US tax rate
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const totalTax = Math.round(subtotal * taxRate);

    return {
      totalTax,
      taxBreakdown: taxRate > 0 ? [{
        type: 'sales_tax',
        rate: taxRate,
        amount: totalTax,
        jurisdiction: customerAddress?.state || customerAddress?.country || 'Unknown'
      }] : []
    };
  }

  private async createStripeInvoice(invoice: Invoice): Promise<Stripe.Invoice> {
    const stripeInvoice = await stripeClient.createInvoice({
      customerId: invoice.customerId,
      description: `${invoice.companyDetails.name} - Invoice ${invoice.number}`,
      metadata: {
        internal_invoice_id: invoice.id,
        invoice_number: invoice.number,
        invoice_type: invoice.type
      },
      dueDate: invoice.dueDate ? Math.floor(invoice.dueDate.getTime() / 1000) : undefined
    });

    return stripeInvoice;
  }

  private renderPDFContent(doc: PDFKit.PDFDocument, invoice: Invoice): void {
    const { companyDetails, customerDetails } = invoice;

    // Header with company logo and details
    doc.fontSize(20).text(companyDetails.name, 50, 50);
    doc.fontSize(10)
       .text(companyDetails.address.line1, 50, 80)
       .text(`${companyDetails.address.city}, ${companyDetails.address.state} ${companyDetails.address.postalCode}`, 50, 95)
       .text(companyDetails.email, 50, 110)
       .text(companyDetails.phone || '', 50, 125);

    // Invoice title and number
    doc.fontSize(24).text('INVOICE', 400, 50);
    doc.fontSize(12).text(`Invoice #: ${invoice.number}`, 400, 80);
    doc.text(`Date: ${invoice.issueDate.toLocaleDateString()}`, 400, 100);
    if (invoice.dueDate) {
      doc.text(`Due Date: ${invoice.dueDate.toLocaleDateString()}`, 400, 120);
    }

    // Bill to section
    doc.fontSize(14).text('Bill To:', 50, 180);
    doc.fontSize(10)
       .text(customerDetails.name, 50, 200)
       .text(customerDetails.email, 50, 215);
    
    if (customerDetails.address) {
      const addr = customerDetails.address;
      doc.text(addr.line1 || '', 50, 230);
      if (addr.line2) doc.text(addr.line2, 50, 245);
      doc.text(`${addr.city || ''}, ${addr.state || ''} ${addr.postalCode || ''}`, 50, 260);
    }

    // Line items table
    const tableTop = 300;
    const itemHeight = 20;
    
    // Table headers
    doc.fontSize(10)
       .text('Description', 50, tableTop, { width: 250 })
       .text('Qty', 300, tableTop, { width: 50, align: 'right' })
       .text('Unit Price', 350, tableTop, { width: 80, align: 'right' })
       .text('Amount', 430, tableTop, { width: 80, align: 'right' });

    // Header underline
    doc.moveTo(50, tableTop + 15).lineTo(510, tableTop + 15).stroke();

    // Line items
    let yPosition = tableTop + 30;
    invoice.lineItems.forEach((item) => {
      doc.text(item.description, 50, yPosition, { width: 250 })
         .text(item.quantity.toString(), 300, yPosition, { width: 50, align: 'right' })
         .text(formatCurrency(item.unitAmount, invoice.currency), 350, yPosition, { width: 80, align: 'right' })
         .text(formatCurrency(item.amount, invoice.currency), 430, yPosition, { width: 80, align: 'right' });
      
      yPosition += itemHeight;
    });

    // Totals section
    const totalsTop = yPosition + 30;
    doc.moveTo(350, totalsTop - 10).lineTo(510, totalsTop - 10).stroke();

    doc.text('Subtotal:', 350, totalsTop, { width: 80, align: 'right' })
       .text(formatCurrency(invoice.subtotal, invoice.currency), 430, totalsTop, { width: 80, align: 'right' });

    if (invoice.tax > 0) {
      doc.text('Tax:', 350, totalsTop + 20, { width: 80, align: 'right' })
         .text(formatCurrency(invoice.tax, invoice.currency), 430, totalsTop + 20, { width: 80, align: 'right' });
    }

    doc.fontSize(12)
       .text('Total:', 350, totalsTop + 40, { width: 80, align: 'right' })
       .text(formatCurrency(invoice.total, invoice.currency), 430, totalsTop + 40, { width: 80, align: 'right' });

    // Footer notes
    if (invoice.notes) {
      doc.fontSize(10).text('Notes:', 50, totalsTop + 80);
      doc.text(invoice.notes, 50, totalsTop + 100, { width: 460 });
    }

    if (invoice.footerText) {
      doc.text(invoice.footerText, 50, 700, { width: 460, align: 'center' });
    }
  }

  private async deliverByEmail(invoice: Invoice, recipientEmail?: string, customMessage?: string): Promise<InvoiceDeliveryResult> {
    // In production, integrate with email service like SendGrid
    const email = recipientEmail || invoice.customerDetails.email;
    
    console.log(`Sending invoice ${invoice.number} to ${email}`);
    
    // Generate PDF
    const pdfResult = await this.generatePDF(invoice.id);
    if (!pdfResult.success) {
      throw new Error(`Failed to generate PDF: ${pdfResult.error}`);
    }

    // Simulate email delivery
    return {
      invoiceId: invoice.id,
      deliveryMethod: 'email',
      success: true,
      deliveredAt: new Date(),
      trackingId: `email_${Date.now()}`
    };
  }

  private async deliverByWebhook(invoice: Invoice, webhookUrl?: string): Promise<InvoiceDeliveryResult> {
    if (!webhookUrl) {
      throw new Error('Webhook URL is required for webhook delivery');
    }

    console.log(`Delivering invoice ${invoice.number} via webhook to ${webhookUrl}`);
    
    // Simulate webhook delivery
    return {
      invoiceId: invoice.id,
      deliveryMethod: 'webhook',
      success: true,
      deliveredAt: new Date(),
      trackingId: `webhook_${Date.now()}`
    };
  }

  private async prepareForDownload(invoice: Invoice): Promise<InvoiceDeliveryResult> {
    console.log(`Preparing invoice ${invoice.number} for download`);
    
    return {
      invoiceId: invoice.id,
      deliveryMethod: 'download',
      success: true,
      deliveredAt: new Date(),
      trackingId: `download_${Date.now()}`
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const details = {
      invoiceCacheSize: this.invoiceCache.size,
      deliveryTrackingSize: this.deliveryTracking.size,
      nextInvoiceNumber: this.nextInvoiceNumber,
      totalInvoices: this.invoiceCache.size,
      paidInvoices: Array.from(this.invoiceCache.values()).filter(inv => inv.status === InvoiceStatus.PAID).length,
      timestamp: new Date()
    };

    return { status: 'healthy', details };
  }
}

// Export singleton instance
export const invoiceGenerator = InvoiceGenerator.getInstance();
export default invoiceGenerator;