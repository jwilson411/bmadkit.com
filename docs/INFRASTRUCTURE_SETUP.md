# BMAD Web UI Platform - Infrastructure Setup Procedures

**Last Updated:** 2025-09-08  
**Version:** 1.0  
**Maintained By:** Senior Developer  
**Purpose:** Complete infrastructure provisioning and deployment setup procedures

---

## Overview

This document provides step-by-step procedures for setting up the complete infrastructure for the BMAD Web UI Platform, from initial cloud account setup through production deployment. Follow these procedures in order for a successful deployment.

---

## Prerequisites

### Required Accounts & Services
| Service | Purpose | Account Type | Estimated Monthly Cost |
|---------|---------|--------------|----------------------|
| **Railway** | Primary hosting platform | Hobby ($5) or Pro ($20) | $5-$50 |
| **PostgreSQL** | Database service | Included with Railway | $0-$10 |
| **Redis Cloud** | Session caching | Free tier available | $0-$15 |
| **Stripe** | Payment processing | Business account | 2.9% + $0.30 per transaction |
| **Domain Provider** | Custom domain | Annual registration | $10-$15/year |
| **Email Service** | Transactional emails | SendGrid or similar | $0-$20 |

### Required Access
- GitHub repository admin access
- Railway account with payment method
- Domain registrar access for DNS management
- Email service provider admin access

---

## Phase 1: Cloud Platform Setup

### 1.1 Railway Account Setup

**Step 1: Account Creation**
```bash
# Visit railway.app and create account with GitHub
# Choose plan based on expected usage:
# - Hobby: $5/month for personal projects
# - Pro: $20/month for production applications
```

**Step 2: Project Creation**
```bash
# In Railway dashboard:
1. Click "New Project"
2. Choose "Deploy from GitHub repo" 
3. Connect your bmad-platform repository
4. Configure deployment settings:
   - Root Directory: packages/api (for API service)
   - Build Command: npm run build
   - Start Command: npm run start
```

**Step 3: Environment Configuration**
```bash
# In Railway project settings, add environment variables:
NODE_ENV=production
PORT=3001
JWT_SECRET=your-production-jwt-secret-very-long-and-secure
LOG_LEVEL=info
```

### 1.2 Database Setup

**PostgreSQL on Railway:**
```bash
# In Railway dashboard:
1. Click "Add Service" → "Database" → "PostgreSQL"
2. Railway auto-generates DATABASE_URL
3. Copy connection string for application configuration
4. Enable connection pooling (recommended for production)
```

**Database Configuration:**
```env
# Add to Railway environment variables
DATABASE_URL=postgresql://username:password@host:port/database
DATABASE_MAX_CONNECTIONS=10
DATABASE_SSL=true
```

### 1.3 Redis Cache Setup

**Option A: Railway Redis (Recommended)**
```bash
# In Railway dashboard:
1. Click "Add Service" → "Database" → "Redis"
2. Railway auto-generates REDIS_URL
3. Configure Redis for session storage and pub/sub
```

**Option B: Redis Cloud**
```bash
# Visit redislabs.com:
1. Create free account (30MB free tier)
2. Create new database
3. Copy connection details
4. Add to Railway environment variables
```

---

## Phase 2: Application Services Deployment

### 2.1 API Service Deployment

**Service Configuration:**
```yaml
# railway.json (place in packages/api/)
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Health Check Setup:**
```typescript
// Add to packages/api/src/routes/health.ts
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV
  });
});
```

### 2.2 Real-time Service Deployment

**Service Configuration:**
```yaml
# railway.json (place in packages/realtime/)
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

**WebSocket Configuration:**
```env
# Add to Railway realtime service environment
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
REDIS_URL=redis://username:password@host:port
API_SERVICE_URL=https://your-api-service.railway.app
```

### 2.3 Frontend Deployment

**Build Configuration:**
```yaml
# railway.json (place in packages/web/)
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "npm run preview"
  }
}
```

**Environment Configuration:**
```env
# Frontend environment variables
VITE_API_URL=https://your-api-service.railway.app
VITE_WS_URL=https://your-realtime-service.railway.app
VITE_STRIPE_PUBLIC_KEY=pk_live_your_stripe_public_key
```

---

## Phase 3: External Service Integration

### 3.1 Domain & DNS Setup

**Domain Configuration:**
```bash
# Purchase domain from provider (Namecheap, GoDaddy, etc.)
# In domain provider DNS settings, add CNAME records:

# Frontend
www.yourdomain.com → your-frontend-service.railway.app

# API  
api.yourdomain.com → your-api-service.railway.app

# WebSocket
ws.yourdomain.com → your-realtime-service.railway.app
```

**Railway Custom Domain Setup:**
```bash
# In Railway service settings:
1. Go to "Settings" → "Domains"
2. Click "Custom Domain"
3. Enter your domain (e.g., api.yourdomain.com)
4. Railway provides CNAME target
5. Add CNAME record in your DNS provider
6. Wait for SSL certificate generation (5-10 minutes)
```

### 3.2 SSL Certificate Management

**Automatic SSL (Railway handles this):**
```bash
# Railway automatically provisions SSL certificates via Let's Encrypt
# Certificates auto-renew every 90 days
# Monitor certificate status in Railway dashboard
```

**SSL Configuration Verification:**
```bash
# Test SSL setup
curl -I https://api.yourdomain.com/api/health
# Should return 200 OK with proper SSL headers
```

### 3.3 Email Service Setup

**SendGrid Configuration:**
```bash
# Create SendGrid account and verify sender identity
# Generate API key with Mail Send permissions
# Add to Railway API service environment:
SENDGRID_API_KEY=SG.your_api_key_here
FROM_EMAIL=noreply@yourdomain.com
FROM_NAME="BMAD Platform"
```

**Email Templates Setup:**
```bash
# Create email templates in SendGrid dashboard:
# 1. Welcome email (d-welcome-template-id)
# 2. Password reset (d-password-reset-template-id)  
# 3. Email verification (d-email-verify-template-id)
```

---

## Phase 4: Monitoring & Operations Setup

### 4.1 Application Monitoring

**Railway Built-in Monitoring:**
```bash
# Railway provides:
# - CPU/Memory usage graphs
# - Request/response metrics
# - Error rate tracking
# - Deployment history
```

**Custom Monitoring Setup:**
```typescript
// Add to packages/api/src/middleware/monitoring.ts
import { Request, Response, NextFunction } from 'express';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      timestamp: new Date().toISOString()
    });
  });
  
  next();
};
```

### 4.2 Error Tracking & Alerting

**Error Logging Setup:**
```bash
# Install winston for structured logging
npm install winston

# Add to packages/api/src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

**Railway Alerting:**
```bash
# In Railway dashboard:
1. Go to project settings
2. Enable deployment notifications
3. Add webhook URLs for Slack/Discord alerts
4. Configure CPU/Memory threshold alerts
```

### 4.3 Backup & Recovery

**Database Backup Strategy:**
```bash
# PostgreSQL automated backups (Railway Pro feature)
# Backups retained for 7 days
# Manual backup creation:
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

**Application Data Backup:**
```bash
# Create backup script (packages/api/scripts/backup.sh)
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL | gzip > backups/database_$DATE.sql.gz
echo "Backup completed: database_$DATE.sql.gz"
```

---

## Phase 5: Security & Compliance

### 5.1 Security Headers Configuration

**Express Security Middleware:**
```typescript
// Add to packages/api/src/app.ts
import helmet from 'helmet';
import cors from 'cors';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "wss:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
```

### 5.2 Environment Security

**Production Environment Variables:**
```env
# Never commit these to git - add via Railway dashboard
JWT_SECRET=super-long-random-string-minimum-32-characters
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
STRIPE_SECRET_KEY=sk_live_...
SENDGRID_API_KEY=SG.live...
OPENAI_API_KEY=sk-live...
ANTHROPIC_API_KEY=sk-ant-live...
```

**Secrets Management:**
```bash
# Use Railway's built-in secrets management
# Rotate secrets quarterly
# Monitor secret access in Railway dashboard
# Use least privilege principle for API keys
```

---

## Phase 6: CI/CD Pipeline Setup

### 6.1 GitHub Actions Configuration

**Deployment Workflow:**
```yaml
# .github/workflows/deploy.yml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm test
        
      - name: Build application
        run: npm run build
        
      - name: Deploy to Railway
        uses: bencox/railway-deploy@v1
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
```

### 6.2 Pre-deployment Checks

**Quality Gate Configuration:**
```bash
# Pre-deployment checks (run in CI/CD)
npm run lint          # Code quality
npm run type-check    # TypeScript validation  
npm test              # All tests pass
npm run build         # Build succeeds
```

---

## Phase 7: Production Validation

### 7.1 Deployment Verification

**Health Check Validation:**
```bash
# Verify all services are running
curl https://api.yourdomain.com/api/health
curl https://ws.yourdomain.com/health  
curl https://yourdomain.com

# Expected responses:
# API: {"status":"ok","timestamp":"..."}
# WebSocket: {"status":"ok","connections":0}
# Frontend: 200 OK with HTML content
```

### 7.2 Integration Testing

**End-to-End Validation:**
```bash
# Test user registration flow
curl -X POST https://api.yourdomain.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'

# Test WebSocket connection
node -e "
const io = require('socket.io-client');
const socket = io('wss://ws.yourdomain.com');
socket.on('connect', () => console.log('Connected'));
"
```

### 7.3 Performance Validation

**Load Testing:**
```bash
# Install Artillery for load testing
npm install -g artillery

# Create load test config (load-test.yml)
config:
  target: 'https://api.yourdomain.com'
  phases:
    - duration: 60
      arrivalRate: 10

scenarios:
  - name: "Health check"
    requests:
      - get:
          url: "/api/health"

# Run load test
artillery run load-test.yml
```

---

## Troubleshooting Guide

### Common Deployment Issues

**Build Failures:**
```bash
# Check Railway build logs
# Common issues:
# 1. Missing dependencies in package.json
# 2. TypeScript compilation errors
# 3. Environment variable not set

# Fix: Update package.json and environment variables
```

**Database Connection Issues:**
```bash
# Verify DATABASE_URL format
# Check firewall settings
# Verify SSL requirements
# Test connection with psql client
```

**WebSocket Connection Issues:**
```bash
# Check CORS configuration
# Verify WebSocket upgrade headers
# Check Railway service networking
# Test with WebSocket client
```

### Performance Issues

**High Memory Usage:**
```bash
# Monitor Railway dashboard
# Check for memory leaks in code
# Optimize database queries
# Implement connection pooling
```

**Slow Response Times:**
```bash
# Add response time monitoring
# Optimize database queries
# Implement caching strategies
# Check Railway service resources
```

---

## Maintenance Procedures

### Regular Maintenance Tasks

**Weekly:**
- Review application logs for errors
- Check Railway resource usage
- Monitor SSL certificate status
- Review database performance metrics

**Monthly:**
- Update dependencies (security patches)
- Review and rotate API keys
- Analyze cost usage and optimize
- Backup critical configuration

**Quarterly:**
- Conduct security audit
- Review and update documentation
- Performance optimization review
- Disaster recovery testing

---

## Support & Escalation

### Railway Support
- Dashboard support chat (Pro plan)
- Community Discord: discord.gg/railway
- Documentation: docs.railway.app

### Emergency Procedures
1. **Service Outage**: Check Railway status page
2. **Database Issues**: Review connection logs and metrics  
3. **Security Incident**: Rotate affected credentials immediately
4. **Performance Degradation**: Scale resources via Railway dashboard

---

**Infrastructure Setup Status:** Production Ready  
**Next Review:** 2025-10-08  
**Maintained By:** Senior Developer