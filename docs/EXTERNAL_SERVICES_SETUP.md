# BMAD Web UI Platform - External Services Setup Guide

**Last Updated:** 2025-09-08  
**Version:** 1.0  
**Maintained By:** User (with Senior Developer assistance)  
**Purpose:** Step-by-step setup procedures for all external service integrations

---

## Overview

This guide provides detailed setup procedures for all external services required by the BMAD Web UI Platform. Each service includes account creation, configuration, and integration steps with security best practices.

**IMPORTANT:** Most external service accounts require human verification and payment authorization. These tasks are marked as **🧑 USER RESPONSIBILITY** in the responsibility matrix.

---

## Service Priority Matrix

| Service | Priority | Development Phase | Business Impact | Setup Complexity |
|---------|----------|-------------------|-----------------|------------------|
| **OpenAI API** | Critical | MVP Required | Core functionality | Medium |
| **PostgreSQL** | Critical | MVP Required | Data storage | Low (Railway managed) |
| **Redis** | Critical | MVP Required | Session management | Low (Railway managed) |
| **Domain & DNS** | High | Pre-launch | Professional appearance | Medium |
| **Anthropic API** | High | Post-MVP | Redundancy/quality | Medium |
| **Stripe** | Medium | Payment features | Revenue generation | High |
| **Email Service** | Medium | User management | User communication | Medium |

---

## 1. OpenAI API Setup (Critical - Required for MVP)

### 1.1 Account Creation & Verification
**👤 USER RESPONSIBILITY - Requires payment method**

1. **Create OpenAI Account:**
   ```bash
   # Visit: https://platform.openai.com/signup
   # Use business email address
   # Verify email address
   ```

2. **Add Payment Method:**
   ```bash
   # Navigate to: Settings → Billing
   # Add credit card or bank account
   # Set usage limits (recommended: $50/month to start)
   # Enable usage alerts at 80% of limit
   ```

3. **Generate API Key:**
   ```bash
   # Navigate to: API Keys section
   # Click "Create new secret key"
   # Name: "BMAD Platform Production" 
   # Copy key immediately (shown only once)
   ```

### 1.2 API Key Security Setup
**🤖 SENIOR DEVELOPER - Secure integration**

```env
# Add to Railway environment variables (NEVER commit to git)
OPENAI_API_KEY=sk-proj-...your-key-here
OPENAI_ORG_ID=org-...your-org-id  # Optional but recommended
OPENAI_MODEL=gpt-4  # Default model for planning sessions
OPENAI_MAX_TOKENS=4000  # Token limit per request
```

### 1.3 Usage Monitoring Setup
```typescript
// packages/api/src/services/openai.ts
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// Usage tracking middleware
export const trackOpenAIUsage = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('OpenAI API call', {
      endpoint: req.path,
      duration,
      timestamp: new Date().toISOString()
    });
  });
  
  next();
};
```

### 1.4 Cost Management
**👤 USER RESPONSIBILITY - Monitor spending**

- **Daily Budget:** Set $5-10/day initially
- **Usage Alerts:** Configure at 50%, 80%, 90%
- **Review Schedule:** Check usage weekly
- **Scaling Plan:** Increase limits based on user growth

---

## 2. Anthropic API Setup (High Priority - Backup LLM)

### 2.1 Account Creation
**👤 USER RESPONSIBILITY**

1. **Create Account:**
   ```bash
   # Visit: https://console.anthropic.com/
   # Sign up with business email
   # Complete identity verification (may take 24-48 hours)
   ```

2. **Request API Access:**
   ```bash
   # Fill out API access request form
   # Describe use case: "Business planning platform with AI agents"
   # Wait for approval (typically 1-3 business days)
   ```

### 2.2 API Configuration
**🤖 SENIOR DEVELOPER**

```env
# Add to Railway environment variables
ANTHROPIC_API_KEY=sk-ant-...your-key-here
ANTHROPIC_MODEL=claude-3-sonnet-20240229  # Recommended model
ANTHROPIC_MAX_TOKENS=4000
```

### 2.3 Failover Implementation
```typescript
// packages/api/src/services/llm.ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

class LLMService {
  private openai: OpenAI;
  private anthropic: Anthropic;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async generateResponse(prompt: string, useOpenAI: boolean = true) {
    try {
      if (useOpenAI) {
        return await this.callOpenAI(prompt);
      } else {
        return await this.callAnthropic(prompt);
      }
    } catch (error) {
      // Automatic failover to backup provider
      logger.warn('Primary LLM failed, switching to backup', { error });
      return useOpenAI ? await this.callAnthropic(prompt) : await this.callOpenAI(prompt);
    }
  }
}
```

---

## 3. Stripe Payment Processing (Medium Priority - Post-MVP)

### 3.1 Stripe Account Setup
**👤 USER RESPONSIBILITY - Business verification required**

1. **Create Stripe Account:**
   ```bash
   # Visit: https://dashboard.stripe.com/register
   # Use business information
   # Complete business verification (requires documentation)
   # Process can take 2-7 business days
   ```

2. **Business Verification Documents:**
   - Business registration certificate
   - Tax ID documentation
   - Bank account information
   - Photo ID of business owner

### 3.2 Stripe Configuration
**🤖 SENIOR DEVELOPER - After user provides keys**

```env
# Add to Railway environment variables
STRIPE_SECRET_KEY=sk_test_...  # Start with test key
STRIPE_PUBLIC_KEY=pk_test_...  # Frontend needs this
STRIPE_WEBHOOK_SECRET=whsec_...  # For webhook verification
STRIPE_PRICE_ID_PREMIUM=price_...  # Premium subscription price ID
```

### 3.3 Webhook Setup
```bash
# In Stripe Dashboard → Developers → Webhooks
# Add endpoint: https://api.yourdomain.com/webhooks/stripe
# Select events:
# - customer.subscription.created
# - customer.subscription.updated
# - customer.subscription.deleted  
# - invoice.payment_succeeded
# - invoice.payment_failed
```

### 3.4 Integration Implementation
```typescript
// packages/api/src/controllers/stripe.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export const createSubscription = async (req: Request, res: Response) => {
  try {
    const { customerId, priceId } = req.body;
    
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
    });
    
    res.json(subscription);
  } catch (error) {
    logger.error('Stripe subscription creation failed', { error });
    res.status(500).json({ error: 'Subscription creation failed' });
  }
};
```

---

## 4. Email Service Setup (Medium Priority)

### 4.1 SendGrid Account Setup
**👤 USER RESPONSIBILITY**

1. **Create Account:**
   ```bash
   # Visit: https://sendgrid.com/
   # Sign up with business email
   # Verify domain ownership
   ```

2. **Domain Authentication:**
   ```bash
   # In SendGrid Dashboard → Settings → Sender Authentication
   # Add your domain (e.g., yourdomain.com)
   # Add DNS records provided by SendGrid
   # Verify domain authentication (24-48 hours)
   ```

### 4.2 API Key Generation
```bash
# Navigate to: Settings → API Keys
# Click "Create API Key"
# Name: "BMAD Platform Production"
# Permissions: "Mail Send" (full access)
# Copy and secure the key immediately
```

### 4.3 Email Templates Setup
**🤖 SENIOR DEVELOPER - After user provides access**

```typescript
// packages/api/src/services/email.ts
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export const sendWelcomeEmail = async (email: string, name: string) => {
  const msg = {
    to: email,
    from: process.env.FROM_EMAIL!,
    templateId: 'd-welcome-template-id',
    dynamicTemplateData: {
      name,
      loginUrl: `${process.env.FRONTEND_URL}/login`
    },
  };

  try {
    await sgMail.send(msg);
    logger.info('Welcome email sent', { email });
  } catch (error) {
    logger.error('Welcome email failed', { email, error });
    throw error;
  }
};
```

### 4.4 Email Templates Required
Create these templates in SendGrid dashboard:

1. **Welcome Email** (Template ID: d-welcome-template-id)
2. **Password Reset** (Template ID: d-password-reset-template-id)  
3. **Email Verification** (Template ID: d-email-verify-template-id)
4. **Subscription Confirmation** (Template ID: d-subscription-template-id)

---

## 5. Domain & DNS Setup (High Priority - Pre-Launch)

### 5.1 Domain Registration
**👤 USER RESPONSIBILITY**

1. **Choose Domain Registrar:**
   - **Namecheap** (recommended for simplicity)
   - **GoDaddy** (widely used)
   - **Google Domains** (good integration)

2. **Domain Selection:**
   ```bash
   # Recommended format: [brandname].com
   # Check availability for:
   # - Primary domain: bmadkit.com
   # - Alternative: bmadplatform.com
   # - Backup: getbmad.com
   ```

### 5.2 DNS Configuration
**🤖 SENIOR DEVELOPER - After domain purchase**

```bash
# Add these DNS records in your domain provider:

# Main website
Type: CNAME
Name: @
Value: your-frontend-service.railway.app

# API subdomain  
Type: CNAME
Name: api
Value: your-api-service.railway.app

# WebSocket subdomain
Type: CNAME  
Name: ws
Value: your-realtime-service.railway.app

# Email authentication (for SendGrid)
Type: CNAME
Name: em1234  # SendGrid provides specific values
Value: u1234567.wl-em.sendgrid.net
```

### 5.3 SSL Certificate Setup
```bash
# Railway automatically handles SSL certificates
# Verify SSL configuration:
curl -I https://yourdomain.com
# Should return SSL headers without errors

# Test all subdomains:
curl -I https://api.yourdomain.com/api/health
curl -I https://ws.yourdomain.com/health
```

---

## 6. Database & Cache Services (Critical - Managed Services)

### 6.1 PostgreSQL Setup (Railway)
**🤖 SENIOR DEVELOPER - Managed service**

```bash
# Railway automatically provisions PostgreSQL
# Configuration in Railway dashboard:
# - Version: PostgreSQL 14+
# - Storage: 1GB initially (auto-scaling)
# - Connections: 20 concurrent connections
# - Backup: Daily automated backups (7 days retention)
```

### 6.2 Redis Setup (Railway)
**🤖 SENIOR DEVELOPER - Managed service**

```bash
# Railway Redis configuration:
# - Version: Redis 7.x
# - Memory: 256MB initially
# - Persistence: RDB snapshots
# - Usage: Session storage + pub/sub for WebSocket
```

### 6.3 Connection Configuration
```env
# Automatically provided by Railway:
DATABASE_URL=postgresql://username:password@hostname:port/database
REDIS_URL=redis://hostname:port

# Additional configuration:
DATABASE_POOL_SIZE=10
REDIS_TTL=1800  # 30 minutes session timeout
```

---

## 7. Security & Monitoring Services

### 7.1 JWT Secret Generation
**🤖 SENIOR DEVELOPER**

```bash
# Generate secure JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Add to Railway environment:
JWT_SECRET=your-generated-secret-here
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
```

### 7.2 Rate Limiting Configuration
```typescript
// packages/api/src/middleware/rateLimit.ts
import rateLimit from 'express-rate-limit';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes  
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
```

---

## 8. Development vs Production Configuration

### 8.1 Environment Separation
```bash
# Development (.env.local)
NODE_ENV=development
OPENAI_API_KEY=sk-test-key  # Use test/dev keys when available
STRIPE_SECRET_KEY=sk_test_...
SENDGRID_API_KEY=SG.test...
LOG_LEVEL=debug

# Production (Railway environment variables)
NODE_ENV=production  
OPENAI_API_KEY=sk-proj-live-key
STRIPE_SECRET_KEY=sk_live_...
SENDGRID_API_KEY=SG.live...
LOG_LEVEL=info
```

### 8.2 Service URLs Configuration
```env
# Development
API_URL=http://localhost:3001
WS_URL=http://localhost:3002
FRONTEND_URL=http://localhost:3000

# Production  
API_URL=https://api.yourdomain.com
WS_URL=https://ws.yourdomain.com  
FRONTEND_URL=https://yourdomain.com
```

---

## 9. Cost Estimation & Monitoring

### 9.1 Monthly Cost Breakdown (Estimated)

| Service | Development | Production | Notes |
|---------|-------------|------------|--------|
| **Railway Hosting** | $5 | $20-50 | Scales with usage |
| **OpenAI API** | $10-30 | $50-200 | Depends on user activity |
| **Anthropic API** | $5-15 | $20-100 | Backup/premium features |
| **Stripe Processing** | $0 | 2.9% + $0.30/transaction | Only when processing payments |
| **SendGrid Email** | Free | $15-50 | Free tier: 100 emails/day |
| **Domain Registration** | $15/year | $15/year | Annual cost |
| **Total Monthly** | $20-50 | $120-435 | Excluding transaction fees |

### 9.2 Cost Optimization Strategies

1. **LLM Usage Optimization:**
   ```typescript
   // Implement response caching
   const cachedResponse = await redis.get(`prompt:${promptHash}`);
   if (cachedResponse) return JSON.parse(cachedResponse);
   ```

2. **Email Usage Optimization:**
   - Use transactional emails only
   - Batch notifications when possible  
   - Implement unsubscribe handling

3. **Database Optimization:**
   - Connection pooling
   - Query optimization
   - Regular cleanup of old sessions

---

## 10. Security Checklist

### 10.1 API Key Security
- [ ] All API keys stored in Railway environment variables
- [ ] No API keys committed to git repository
- [ ] API keys have appropriate scopes/permissions
- [ ] Usage monitoring enabled for all paid APIs
- [ ] Rate limiting implemented for all services

### 10.2 Domain Security  
- [ ] SSL certificates active on all domains
- [ ] HSTS headers configured
- [ ] CORS properly configured for production domains
- [ ] DNS records properly configured

### 10.3 Service Security
- [ ] Webhook endpoints secured with signature verification
- [ ] Database connections use SSL
- [ ] Redis connections secured
- [ ] Email templates prevent HTML injection

---

## 11. Testing & Validation Procedures

### 11.1 Service Integration Testing
```bash
# Test each service integration
npm run test:integration

# Specific service tests:
npm run test:openai      # Test OpenAI API integration
npm run test:stripe      # Test Stripe webhook handling  
npm run test:email       # Test email template sending
npm run test:auth        # Test JWT and session handling
```

### 11.2 Production Readiness Checklist
- [ ] All service accounts created and verified
- [ ] All API keys properly configured  
- [ ] Domain DNS properly configured
- [ ] SSL certificates active
- [ ] Email sending functional
- [ ] Payment processing tested (in test mode)
- [ ] Monitoring and alerting configured
- [ ] Cost limits and alerts set up

---

## 12. Troubleshooting Guide

### 12.1 Common Issues

**OpenAI API Errors:**
```bash
# Rate limit exceeded
Error: 429 Too Many Requests
Solution: Implement exponential backoff retry logic

# Invalid API key
Error: 401 Unauthorized  
Solution: Verify API key in Railway environment variables
```

**Email Delivery Issues:**
```bash
# Domain not authenticated
Error: The from address does not match a verified Sender Identity
Solution: Complete domain authentication in SendGrid

# Template not found
Error: Template not found
Solution: Verify template ID in SendGrid dashboard
```

**Stripe Integration Issues:**
```bash
# Webhook signature invalid
Error: Webhook signature verification failed
Solution: Verify STRIPE_WEBHOOK_SECRET matches Stripe dashboard

# Test vs Live key mismatch
Error: No such customer  
Solution: Ensure test/live keys match environment
```

### 12.2 Support Resources

- **OpenAI:** https://help.openai.com/
- **Anthropic:** https://support.anthropic.com/
- **Stripe:** https://support.stripe.com/
- **SendGrid:** https://docs.sendgrid.com/
- **Railway:** https://docs.railway.app/

---

**External Services Setup Status:** Ready for Implementation  
**Next Review:** 2025-10-08  
**Owner:** User (account creation) + Senior Developer (integration)