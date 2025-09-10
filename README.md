# BMAD Platform - Business Methodology and Analysis Design

[![CI/CD](https://github.com/bmad/bmad-platform/workflows/CI/badge.svg)](https://github.com/bmad/bmad-platform/actions)
[![Coverage](https://codecov.io/gh/bmad/bmad-platform/branch/main/graph/badge.svg)](https://codecov.io/gh/bmad/bmad-platform)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-20.11.0+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.3.3+-blue.svg)](https://www.typescriptlang.org/)

**BMAD** is an AI-powered business methodology and analysis design platform that guides users through comprehensive business planning using orchestrated AI agents (Analyst → PM → UX Expert → Architect) with real-time document generation and export capabilities.

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/bmadkit.com.git
cd bmadkit.com

# Install dependencies
npm install

# Setup environment variables (automated script)
./scripts/setup-env.sh

# OR manually copy environment files:
# cp .env.example .env.local
# cp packages/api/.env.example packages/api/.env.local  
# cp packages/web/.env.example packages/web/.env.local
# cp packages/realtime/.env.example packages/realtime/.env.local

# Start the development environment
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

## 📋 Table of Contents

- [🏗️ Architecture Overview](#️-architecture-overview)
- [⚙️ Prerequisites](#️-prerequisites)
- [🔧 Installation & Setup](#-installation--setup)
- [🔐 Configuration & Secrets](#-configuration--secrets)
- [🏃‍♂️ Running the Application](#️-running-the-application)
- [🧪 Testing](#-testing)
- [🚀 Deployment](#-deployment)
- [📦 Package Structure](#-package-structure)
- [🔌 External Services](#-external-services)
- [🛠️ Development Workflow](#️-development-workflow)
- [📚 API Documentation](#-api-documentation)
- [🐛 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)

## 🏗️ Architecture Overview

BMAD is a full-stack TypeScript monorepo built with modern technologies:

- **Frontend**: React 18+ with TypeScript, Tailwind CSS, and Redux Toolkit
- **Backend**: Node.js with Express, PostgreSQL, Redis, and Socket.IO
- **AI Integration**: Dual LLM providers (OpenAI GPT-4 + Anthropic Claude) with failover
- **Real-time**: WebSocket connections for live document streaming
- **Payments**: Stripe integration for premium subscriptions
- **Infrastructure**: Multi-cloud deployment (Vercel + Railway/AWS)

### Core Workflow
1. **User Input**: Business idea or project requirements
2. **AI Orchestration**: Sequential agent execution (Analyst → PM → UX → Architect)
3. **Real-time Streaming**: Live document generation with WebSocket updates
4. **Export & Share**: Multi-format document export (PDF, DOCX, Markdown, JSON)

## ⚙️ Prerequisites

### Required Software
- **Node.js**: 20.11.0+ (LTS recommended)
- **npm**: 10.0.0+ (comes with Node.js)
- **PostgreSQL**: 15.4+ (for database)
- **Redis**: 7.2+ (for caching and real-time features)
- **Git**: Latest version

### Development Tools (Recommended)
- **VS Code** with recommended extensions
- **Docker** (optional, for containerized development)
- **Postman** or similar for API testing
- **pgAdmin** or similar for database management

### System Requirements
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 5GB free space
- **OS**: macOS 12+, Ubuntu 20.04+, or Windows 10+ with WSL2

## 🔧 Installation & Setup

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/your-org/bmadkit.com.git
cd bmadkit.com

# Install root dependencies and workspace packages
npm install

# Verify installation
npm run build
```

### 2. Database Setup

#### Option A: Local PostgreSQL Installation

```bash
# Install PostgreSQL (macOS with Homebrew)
brew install postgresql@15
brew services start postgresql@15

# Create database and user
createdb bmad_development
createuser -P bmad_user  # Set password when prompted

# Grant permissions
psql bmad_development
GRANT ALL PRIVILEGES ON DATABASE bmad_development TO bmad_user;
\q
```

#### Option B: Docker PostgreSQL

```bash
# Start PostgreSQL container
docker run --name bmad-postgres \
  -e POSTGRES_DB=bmad_development \
  -e POSTGRES_USER=bmad_user \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 \
  -d postgres:15

# Verify connection
docker exec -it bmad-postgres psql -U bmad_user -d bmad_development
```

### 3. Redis Setup

#### Option A: Local Redis Installation

```bash
# Install Redis (macOS with Homebrew)
brew install redis
brew services start redis

# Test connection
redis-cli ping
# Should respond: PONG
```

#### Option B: Docker Redis

```bash
# Start Redis container
docker run --name bmad-redis \
  -p 6379:6379 \
  -d redis:7.2-alpine

# Test connection
docker exec -it bmad-redis redis-cli ping
```

### 4. Initialize Database

```bash
# Navigate to API package
cd packages/api

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

## 🔐 Configuration & Secrets

### Environment Variables

The project includes comprehensive `.env.example` files for easy setup:

- **Root**: `.env.example` → `.env.local` (global configuration)
- **Backend API**: `packages/api/.env.example` → `packages/api/.env.local` (server config)  
- **Frontend**: `packages/web/.env.example` → `packages/web/.env.local` (client config)
- **WebSocket**: `packages/realtime/.env.example` → `packages/realtime/.env.local` (realtime config)
- **Testing**: `packages/api/.env.test.example` → `packages/api/.env.test` (test config)

**Quick Setup:**
```bash
# Automated setup (recommended)
./scripts/setup-env.sh

# Manual setup
cp .env.example .env.local
cp packages/api/.env.example packages/api/.env.local
cp packages/web/.env.example packages/web/.env.local  
cp packages/realtime/.env.example packages/realtime/.env.local
```

Create environment files for each package:

#### Root `.env.local`
```bash
# Development environment
NODE_ENV=development
LOG_LEVEL=debug

# Feature Flags
ENABLE_MONITORING=true
ENABLE_ANALYTICS=false
ENABLE_DEBUG_MODE=true
```

#### `packages/api/.env.local`
```bash
# Server Configuration
PORT=3001
HOST=localhost
API_BASE_URL=http://localhost:3001

# Database Configuration
DATABASE_URL="postgresql://bmad_user:your_password@localhost:5432/bmad_development"
DATABASE_POOL_SIZE=20

# Redis Configuration
REDIS_URL="redis://localhost:6379"
REDIS_PASSWORD=
REDIS_DB=0

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-min-32-characters"
JWT_EXPIRES_IN="24h"
JWT_REFRESH_EXPIRES_IN="7d"

# Session Configuration
SESSION_SECRET="your-session-secret-key-min-32-characters"
SESSION_MAX_AGE=86400000

# LLM Provider Configuration (Primary: OpenAI)
OPENAI_API_KEY="sk-your-openai-api-key"
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_MODEL="gpt-4-turbo-preview"
OPENAI_MAX_TOKENS=4000
OPENAI_TIMEOUT=30000

# LLM Provider Configuration (Fallback: Anthropic)
ANTHROPIC_API_KEY="sk-ant-your-anthropic-api-key"
ANTHROPIC_BASE_URL="https://api.anthropic.com"
ANTHROPIC_MODEL="claude-3-opus-20240229"
ANTHROPIC_MAX_TOKENS=4000
ANTHROPIC_TIMEOUT=30000

# Payment Processing (Stripe)
STRIPE_SECRET_KEY="sk_test_your-stripe-secret-key"
STRIPE_PUBLISHABLE_KEY="pk_test_your-stripe-publishable-key"
STRIPE_WEBHOOK_SECRET="whsec_your-webhook-secret"
STRIPE_PRICE_PREMIUM_MONTHLY="price_your-monthly-price-id"
STRIPE_PRICE_PREMIUM_YEARLY="price_your-yearly-price-id"

# Email Configuration (SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
FROM_EMAIL="noreply@bmad.com"
FROM_NAME="BMAD Platform"

# File Storage Configuration
UPLOAD_MAX_SIZE=10485760
ALLOWED_EXTENSIONS="pdf,docx,txt,md,json"
STATIC_FILES_PATH="./uploads"

# Monitoring & Analytics
SENTRY_DSN="https://your-sentry-dsn@sentry.io/project-id"
DATADOG_API_KEY="your-datadog-api-key"
ANALYTICS_API_KEY="your-analytics-api-key"

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_FAILED_REQUESTS=true

# Circuit Breaker Configuration
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=30000
CIRCUIT_BREAKER_RESET_TIMEOUT=60000

# Export Service Configuration
EXPORT_SERVICE_URL="http://localhost:3002"
EXPORT_TIMEOUT=300000
MAX_EXPORT_SIZE=104857600

# Security Configuration
CORS_ORIGIN="http://localhost:3000,https://yourdomain.com"
HELMET_ENABLED=true
TRUST_PROXY=false
```

#### `packages/web/.env.local`
```bash
# Frontend Configuration
REACT_APP_API_BASE_URL=http://localhost:3001
REACT_APP_WS_BASE_URL=ws://localhost:3001
REACT_APP_CDN_BASE_URL=http://localhost:3001/static

# Stripe Public Configuration
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_your-stripe-publishable-key

# Feature Flags
REACT_APP_ENABLE_ANALYTICS=false
REACT_APP_ENABLE_DEBUG=true
REACT_APP_ENABLE_PWA=true

# Authentication
REACT_APP_AUTH_COOKIE_NAME=bmad-session
REACT_APP_SESSION_TIMEOUT=86400000

# UI Configuration
REACT_APP_THEME=light
REACT_APP_LOCALE=en-US
REACT_APP_TIMEZONE=America/New_York
```

#### `packages/realtime/.env.local`
```bash
# WebSocket Server Configuration
WS_PORT=3002
WS_HOST=localhost

# CORS Configuration
WS_CORS_ORIGIN="http://localhost:3000"
WS_CORS_CREDENTIALS=true

# Connection Limits
WS_MAX_CONNECTIONS=1000
WS_CONNECTION_TIMEOUT=30000
WS_HEARTBEAT_INTERVAL=25000

# Room Management
WS_MAX_ROOM_SIZE=10
WS_ROOM_CLEANUP_INTERVAL=300000

# Redis Configuration (for WebSocket scaling)
REDIS_URL="redis://localhost:6379"
REDIS_ADAPTER_KEY="bmad:ws"
```

### Required External Accounts

#### 1. OpenAI Account (Primary LLM Provider)
1. Visit [platform.openai.com](https://platform.openai.com)
2. Create account and add payment method
3. Generate API key in API Keys section
4. Set usage limits (recommended: $50/month for development)
5. Copy API key to `OPENAI_API_KEY` in your `.env.local`

#### 2. Anthropic Account (Fallback LLM Provider)
1. Visit [console.anthropic.com](https://console.anthropic.com)
2. Join waitlist or create account
3. Generate API key once approved
4. Copy API key to `ANTHROPIC_API_KEY` in your `.env.local`

#### 3. Stripe Account (Payment Processing)
1. Visit [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create account and complete business verification
3. In **Developers → API Keys**:
   - Copy **Publishable key** to `STRIPE_PUBLISHABLE_KEY`
   - Copy **Secret key** to `STRIPE_SECRET_KEY`
4. In **Developers → Webhooks**:
   - Add endpoint: `http://localhost:3001/api/payments/webhook`
   - Select events: `payment_intent.succeeded`, `customer.subscription.created`, etc.
   - Copy signing secret to `STRIPE_WEBHOOK_SECRET`
5. In **Products**:
   - Create Premium Monthly product
   - Create Premium Yearly product
   - Copy price IDs to environment variables

#### 4. Email Service Account (Optional)
Choose one of the following:

**Gmail with App Password:**
1. Enable 2FA on your Google account
2. Generate App Password for "Mail"
3. Use Gmail SMTP settings above

**SendGrid:**
1. Create account at [sendgrid.com](https://sendgrid.com)
2. Generate API key
3. Update SMTP configuration:
   ```bash
   SMTP_HOST="smtp.sendgrid.net"
   SMTP_USER="apikey"
   SMTP_PASS="your-sendgrid-api-key"
   ```

#### 5. Monitoring Accounts (Optional but Recommended)

**Sentry (Error Monitoring):**
1. Create account at [sentry.io](https://sentry.io)
2. Create new project for Node.js
3. Copy DSN to `SENTRY_DSN`

**DataDog (Performance Monitoring):**
1. Create account at [datadoghq.com](https://datadoghq.com)
2. Generate API key
3. Copy to `DATADOG_API_KEY`

### Security Best Practices

1. **Never commit `.env` files** - they're gitignored for security
2. **Use strong secrets** - minimum 32 characters for JWT/session secrets
3. **Rotate API keys regularly** - especially for production environments
4. **Enable 2FA** on all external service accounts
5. **Use environment-specific keys** - separate keys for dev/staging/prod
6. **Monitor usage** - set up billing alerts on paid services

## 🏃‍♂️ Running the Application

### Development Mode

#### Start All Services
```bash
# From project root - starts all packages in development mode
npm run dev
```

This command starts:
- **Frontend** (React): [http://localhost:3000](http://localhost:3000)
- **Backend API** (Express): [http://localhost:3001](http://localhost:3001)
- **WebSocket Server**: [ws://localhost:3002](ws://localhost:3002)

#### Start Individual Services
```bash
# Start only the frontend
npm run dev:web

# Start only the API server
npm run dev:api

# Start only the WebSocket server
npm run dev:realtime

# Start only API and WebSocket (no frontend)
npm run dev:backend
```

### Production Mode

```bash
# Build all packages
npm run build

# Start in production mode
npm start
```

### Docker Development Environment (Alternative)

```bash
# Start all services with Docker Compose
docker-compose -f docker-compose.dev.yml up

# Stop services
docker-compose -f docker-compose.dev.yml down

# Rebuild containers
docker-compose -f docker-compose.dev.yml up --build
```

## 🧪 Testing

### Standard Testing

```bash
# Run all unit and integration tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run linting
npm run lint

# Run type checking
npm run type-check
```

### Advanced Edge Case Testing

BMAD includes comprehensive edge case testing covering 187+ scenarios:

```bash
# Run all edge case tests (includes chaos engineering, network resilience, etc.)
npm run test:edge-cases

# Run specific test categories
npm run test:integration     # Cross-story workflow tests
npm run test:chaos          # Chaos engineering tests  
npm run test:network        # Network resilience tests
npm run test:document-edge  # Large document handling

# Use the comprehensive test script
./scripts/run-edge-case-tests.sh

# Run specific category in watch mode
./scripts/run-edge-case-tests.sh -c chaos -w

# Run with verbose output
./scripts/run-edge-case-tests.sh -v
```

#### Edge Case Test Coverage
- **Cross-Story Integration**: Payment → Premium → Export workflows
- **Large Document Handling**: 100MB+ documents with memory management
- **Unicode Complexity**: Multilingual content with bidirectional text
- **Network Resilience**: Ultra-low bandwidth and partition recovery
- **Chaos Engineering**: Service failures and cascading error recovery
- **Resource Exhaustion**: Memory leaks and connection pool limits

### Test Database Setup

```bash
# Setup test database
createdb bmad_test
GRANT ALL PRIVILEGES ON DATABASE bmad_test TO bmad_user;

# Run database tests
cd packages/api
DATABASE_URL="postgresql://bmad_user:password@localhost:5432/bmad_test" npm test
```

### Manual Testing Checklist

#### Basic Functionality
- [ ] User registration and login
- [ ] Session creation with project input
- [ ] Agent workflow execution (Analyst → PM → UX → Architect)
- [ ] Real-time document streaming
- [ ] Document export in all formats (PDF, DOCX, MD, JSON)
- [ ] Payment flow and premium activation

#### Edge Cases
- [ ] Large project inputs (5000+ characters)
- [ ] Unicode content (emojis, non-Latin scripts)
- [ ] Network interruptions during agent execution
- [ ] Export during active document generation
- [ ] Multiple concurrent sessions
- [ ] Payment failure recovery

## 🚀 Deployment

### Environment Setup

#### Staging Environment
```bash
# Build for staging
npm run build:staging

# Deploy to staging
npm run deploy:staging
```

#### Production Environment
```bash
# Build for production
npm run build:prod

# Deploy to production (requires proper credentials)
npm run deploy:prod
```

### Deployment Platforms

#### Vercel (Frontend)
1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on git push

#### Railway (Backend)
1. Connect your GitHub repository to Railway
2. Create PostgreSQL and Redis add-ons
3. Set environment variables
4. Deploy API and WebSocket services

#### AWS (Production)
1. Use Terraform configurations in `packages/infrastructure/`
2. Set up RDS PostgreSQL and ElastiCache Redis
3. Configure ECS for containerized services
4. Set up ALB for load balancing

### Production Configuration

#### Database
```bash
# Production PostgreSQL (RDS)
DATABASE_URL="postgresql://username:password@your-rds-endpoint:5432/bmad_production"
DATABASE_SSL_MODE="require"
DATABASE_POOL_SIZE=20
```

#### Redis
```bash
# Production Redis (ElastiCache)
REDIS_URL="redis://your-elasticache-endpoint:6379"
REDIS_TLS_ENABLED=true
```

#### Security
```bash
# Production security settings
NODE_ENV=production
HELMET_ENABLED=true
TRUST_PROXY=true
CORS_ORIGIN="https://yourdomain.com"
RATE_LIMIT_STRICT=true
```

### Health Checks

The application includes comprehensive health check endpoints:

- **API Health**: `GET /api/health`
- **Database Health**: `GET /api/health/database`
- **Redis Health**: `GET /api/health/redis`
- **LLM Providers**: `GET /api/health/llm`
- **Overall Status**: `GET /api/health/status`

## 📦 Package Structure

```
bmadkit.com/
├── packages/
│   ├── api/                    # Backend Express.js API
│   │   ├── src/
│   │   │   ├── controllers/    # HTTP request handlers
│   │   │   ├── middleware/     # Authentication, validation, etc.
│   │   │   ├── services/       # Business logic (LLM, payments, etc.)
│   │   │   ├── models/         # Database models (Prisma)
│   │   │   ├── utils/          # Shared utilities
│   │   │   └── tests/          # Comprehensive test suites
│   │   ├── prisma/             # Database schema and migrations
│   │   └── package.json
│   ├── web/                    # Frontend React application
│   │   ├── src/
│   │   │   ├── components/     # Reusable UI components
│   │   │   ├── pages/          # Page components and routing
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── services/       # API client and utilities
│   │   │   ├── store/          # Redux state management
│   │   │   └── types/          # TypeScript type definitions
│   │   └── package.json
│   ├── realtime/               # WebSocket server
│   │   ├── src/
│   │   │   ├── handlers/       # WebSocket event handlers
│   │   │   ├── services/       # Real-time business logic
│   │   │   └── middleware/     # WebSocket authentication
│   │   └── package.json
│   ├── shared/                 # Shared TypeScript types and utilities
│   │   ├── src/
│   │   │   ├── types/          # Shared type definitions
│   │   │   ├── constants/      # Shared constants
│   │   │   └── utils/          # Shared utility functions
│   │   └── package.json
│   └── infrastructure/         # Infrastructure as Code
│       ├── terraform/          # AWS/cloud resource definitions
│       └── docker/             # Container configurations
├── scripts/                    # Build and deployment scripts
├── docs/                       # Project documentation
│   ├── architecture/           # Architecture documentation
│   ├── api/                    # API documentation
│   ├── testing/                # Testing guides and results
│   └── deployment/             # Deployment guides
├── .github/                    # GitHub Actions workflows
├── package.json               # Root workspace configuration
└── README.md                  # This file
```

## 🔌 External Services

### Required Services

| Service | Purpose | Cost | Setup Required |
|---------|---------|------|----------------|
| **OpenAI API** | Primary LLM provider | ~$20-100/month | API key, payment method |
| **Anthropic API** | Fallback LLM provider | ~$20-100/month | API key (waitlist) |
| **Stripe** | Payment processing | 2.9% + 30¢/transaction | Business verification |
| **PostgreSQL** | Primary database | Free (local) / $15+/month (hosted) | Database setup |
| **Redis** | Caching & real-time | Free (local) / $10+/month (hosted) | Redis instance |

### Optional Services

| Service | Purpose | Cost | Benefits |
|---------|---------|------|----------|
| **Sentry** | Error monitoring | Free tier / $26+/month | Production error tracking |
| **DataDog** | Performance monitoring | Free tier / $15+/month | APM and logging |
| **SendGrid** | Email delivery | Free tier / $15+/month | Reliable email delivery |
| **Vercel** | Frontend hosting | Free tier / $20+/month | Easy deployments |
| **Railway** | Backend hosting | Free tier / $10+/month | Simple PostgreSQL/Redis |

### Service Limits & Quotas

#### OpenAI API
- **Free Tier**: $5 credit (expires after 3 months)
- **Rate Limits**: 3 requests/minute (free), 3500 requests/minute (paid)
- **Token Limits**: 150,000 tokens/month (free), unlimited (paid)
- **Recommended Budget**: $50-100/month for development

#### Anthropic API
- **Access**: Currently waitlist-based
- **Rate Limits**: Varies by tier
- **Recommended**: Apply early, fallback provider

#### Stripe
- **Transaction Fee**: 2.9% + 30¢ per successful charge
- **International**: +1.5% for international cards
- **Disputes**: $15 chargeback fee
- **Volume Discounts**: Available for high-volume businesses

## 🛠️ Development Workflow

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: add your feature description"

# Run tests before pushing
npm run test:full-suite
npm run lint
npm run type-check

# Push and create PR
git push origin feature/your-feature-name
```

### Code Standards

#### TypeScript
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Always specify return types for public functions
- Use proper error handling with typed errors

#### Naming Conventions
- **Files**: kebab-case (`session-manager.ts`)
- **Functions**: camelCase (`createSession`)
- **Classes**: PascalCase (`SessionManager`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_SESSION_DURATION`)
- **Database**: snake_case (`planning_sessions`)

#### Testing Requirements
- Unit tests for all business logic
- Integration tests for API endpoints
- Edge case tests for critical paths
- Minimum 80% code coverage

### Database Migrations

```bash
# Create new migration
cd packages/api
npx prisma migrate dev --name your_migration_name

# Apply migrations to production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### Adding New Features

1. **Update Prisma Schema** (if database changes needed)
2. **Create/Update API Endpoints** in `packages/api/src/controllers/`
3. **Add Business Logic** in `packages/api/src/services/`
4. **Create Frontend Components** in `packages/web/src/components/`
5. **Add Tests** for all new functionality
6. **Update Documentation** including API docs and README

## 📚 API Documentation

### Authentication Endpoints

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/refresh
```

### Session Management

```http
POST   /api/sessions                    # Create new planning session
GET    /api/sessions                    # List user sessions
GET    /api/sessions/:id                # Get session details
PATCH  /api/sessions/:id                # Update session
DELETE /api/sessions/:id                # Delete session
POST   /api/sessions/:id/messages       # Add message to session
GET    /api/sessions/:id/messages       # Get session messages
```

### Agent Workflow

```http
POST /api/sessions/:id/agents/execute   # Execute agent (Analyst/PM/UX/Architect)
GET  /api/sessions/:id/agents/status    # Get current agent status
POST /api/sessions/:id/agents/transition # Transition to next agent
POST /api/sessions/:id/agents/retry     # Retry failed agent execution
```

### Document Management

```http
GET  /api/sessions/:id/document         # Get current document
POST /api/sessions/:id/export           # Export document (PDF/DOCX/MD/JSON)
GET  /api/sessions/:id/exports          # List session exports
GET  /api/sessions/:id/exports/:exportId # Download specific export
```

### Payment & Subscription

```http
POST /api/payments/create-intent        # Create Stripe payment intent
POST /api/payments/webhook              # Stripe webhook endpoint
GET  /api/subscriptions                 # Get user subscription
POST /api/subscriptions/cancel          # Cancel subscription
```

### Real-time WebSocket Events

```javascript
// Client-side WebSocket connection
const socket = io('ws://localhost:3002');

// Join session room
socket.emit('join-session', { sessionId: 'session-123' });

// Listen for document updates
socket.on('document-updated', (data) => {
  console.log('Document updated:', data);
});

// Listen for agent status changes
socket.on('agent-status-changed', (data) => {
  console.log('Agent status:', data);
});
```

### Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional error context",
    "correlationId": "uuid-for-tracking",
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

Common error codes:
- `AUTHENTICATION_REQUIRED`: User must be logged in
- `PREMIUM_REQUIRED`: Feature requires premium subscription
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `LLM_PROVIDER_UNAVAILABLE`: AI service temporarily unavailable
- `SESSION_NOT_FOUND`: Session does not exist
- `VALIDATION_ERROR`: Invalid request data

## 🐛 Troubleshooting

### Common Issues

#### Database Connection Failed
```bash
Error: Connection refused at localhost:5432
```
**Solution**: Ensure PostgreSQL is running
```bash
# macOS
brew services start postgresql@15

# Docker
docker start bmad-postgres
```

#### Redis Connection Failed
```bash
Error: ECONNREFUSED 127.0.0.1:6379
```
**Solution**: Ensure Redis is running
```bash
# macOS
brew services start redis

# Docker
docker start bmad-redis
```

#### OpenAI API Key Invalid
```bash
Error: 401 Unauthorized - Invalid API key
```
**Solution**: 
1. Check API key in `.env.local`
2. Verify key is active in OpenAI dashboard
3. Ensure billing is set up

#### Stripe Webhook Verification Failed
```bash
Error: Webhook signature verification failed
```
**Solution**:
1. Verify `STRIPE_WEBHOOK_SECRET` in `.env.local`
2. Ensure webhook endpoint is `http://localhost:3001/api/payments/webhook`
3. Check webhook events are properly configured

#### Build Failures
```bash
Error: TypeScript compilation failed
```
**Solution**:
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Check TypeScript errors
npm run type-check

# Fix linting issues
npm run lint --fix
```

#### Memory Issues During Testing
```bash
Error: Process out of memory
```
**Solution**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Run edge case tests with memory monitoring
npm run test:edge-cases
```

### Performance Issues

#### Slow Agent Responses
1. Check LLM provider API status
2. Monitor network latency
3. Verify token limits aren't exceeded
4. Check database query performance

#### High Memory Usage
1. Enable memory monitoring: `npm run test:edge-cases`
2. Check for memory leaks in long-running sessions
3. Monitor Docker container resources
4. Review Redis memory usage

#### WebSocket Connection Issues
1. Check CORS configuration
2. Verify WebSocket port (3002) is accessible
3. Monitor connection limits
4. Check Redis adapter configuration

### Debug Mode

Enable comprehensive debugging:

```bash
# Enable debug logging
export LOG_LEVEL=debug
export DEBUG=bmad:*

# Run with debug output
npm run dev

# Enable chaos testing (development)
export ENABLE_CHAOS_TESTING=true
```

### Getting Help

1. **Check logs** in `./logs/` directory
2. **Review test results** in `./test-results/`
3. **Monitor health endpoints**: `GET /api/health`
4. **Check external service status**:
   - [OpenAI Status](https://status.openai.com)
   - [Stripe Status](https://status.stripe.com)
   - [Anthropic Status](https://status.anthropic.com)

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Follow the development workflow above
4. Ensure all tests pass
5. Submit a pull request

### Pull Request Requirements

- [ ] All tests pass (`npm run test:full-suite`)
- [ ] Code follows style guidelines (`npm run lint`)
- [ ] TypeScript types are correct (`npm run type-check`)
- [ ] Documentation is updated
- [ ] Edge case tests added for new features
- [ ] Performance impact considered

### Code Review Process

1. Automated CI/CD checks must pass
2. At least one code review required
3. Edge case testing validation
4. Security review for sensitive changes
5. Performance impact assessment

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenAI for GPT-4 API
- Anthropic for Claude API
- The TypeScript and React communities
- All contributors and testers

---

**Need Help?** 

- 📧 Email: support@bmad.com
- 💬 Discord: [Join our community](https://discord.gg/bmad)
- 📖 Docs: [docs.bmad.com](https://docs.bmad.com)
- 🐛 Issues: [GitHub Issues](https://github.com/your-org/bmadkit.com/issues)

---

**Happy Building! 🚀**