# BMAD Web UI Platform - Development Environment Setup

**Last Updated:** 2025-09-08  
**Version:** 1.0  
**Maintained By:** Senior Developer  

---

## Quick Start

For experienced developers who want to get started immediately:

```bash
# Clone and setup
git clone <repository-url> bmad-platform
cd bmad-platform
npm install

# Environment setup
cp .env.example .env.local
# Edit .env.local with your API keys (see Environment Configuration below)

# Database setup
npm run db:setup
npm run db:migrate

# Start development servers
npm run dev
```

**Expected Result:** Frontend at `http://localhost:3000`, API at `http://localhost:3001`, WebSocket at `http://localhost:3002`

---

## Prerequisites

### Required Software

| Software | Version | Purpose | Installation |
|----------|---------|---------|--------------|
| **Node.js** | 20.11.0 LTS | JavaScript runtime | [nodejs.org](https://nodejs.org/) |
| **npm** | 10.x+ | Package manager | Included with Node.js |
| **PostgreSQL** | 15.4+ | Primary database | [postgresql.org](https://postgresql.org/) or Docker |
| **Redis** | 7.2+ | Session caching | [redis.io](https://redis.io/) or Docker |
| **Git** | Latest | Version control | [git-scm.com](https://git-scm.com/) |

### Recommended Tools

- **VS Code** - IDE with TypeScript support
- **Docker Desktop** - For running PostgreSQL and Redis locally
- **Postman** or **Insomnia** - API testing
- **Redis Commander** - Redis database GUI

### External Service Accounts Needed

| Service | Purpose | Setup Responsibility | Required For Development |
|---------|---------|---------------------|--------------------------|
| **OpenAI API** | Primary LLM provider | User (requires payment) | ✅ Required |
| **Anthropic API** | Fallback LLM provider | User (requires payment) | ⚠️ Optional but recommended |
| **Stripe** | Payment processing | User (business verification) | ⚠️ Optional for core development |
| **Railway** | Hosting/deployment | User (requires payment) | ❌ Not needed for local dev |

---

## Detailed Setup Instructions

### 1. Repository Setup

```bash
# Clone the repository
git clone <repository-url> bmad-platform
cd bmad-platform

# Install all dependencies (monorepo)
npm install

# Verify monorepo structure
ls packages/
# Expected: api/, realtime/, shared/, web/, infrastructure/
```

### 2. Database Setup

#### Option A: Docker (Recommended)
```bash
# Start PostgreSQL and Redis with Docker Compose
docker-compose up -d postgres redis

# Verify containers are running
docker ps
# Expected: bmad-postgres and bmad-redis containers
```

#### Option B: Local Installation

**PostgreSQL:**
```bash
# macOS with Homebrew
brew install postgresql@15
brew services start postgresql@15

# Create development database
createdb bmad_development
createdb bmad_test
```

**Redis:**
```bash
# macOS with Homebrew  
brew install redis
brew services start redis

# Verify Redis is running
redis-cli ping
# Expected: PONG
```

### 3. Environment Configuration

```bash
# Copy environment template
cp .env.example .env.local

# Edit with your values
nano .env.local
```

**Required Environment Variables:**

```env
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/bmad_development"
TEST_DATABASE_URL="postgresql://username:password@localhost:5432/bmad_test"

# Redis Configuration  
REDIS_URL="redis://localhost:6379"

# LLM API Keys (Get from respective providers)
OPENAI_API_KEY="sk-..." # Required from OpenAI
ANTHROPIC_API_KEY="sk-ant-..." # Optional but recommended

# JWT Security
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"
JWT_EXPIRES_IN="24h"

# Development Settings
NODE_ENV="development"
LOG_LEVEL="debug"

# Optional: Stripe (for payment features)
STRIPE_SECRET_KEY="sk_test_..." # Optional for core development
STRIPE_WEBHOOK_SECRET="whsec_..." # Optional
```

### 4. Database Migration

```bash
# Navigate to API package
cd packages/api

# Generate Prisma client
npx prisma generate

# Run initial migrations
npx prisma migrate dev --name init

# Verify database schema
npx prisma studio
# Opens browser at http://localhost:5555
```

### 5. Development Server Startup

**Start all services with one command:**
```bash
# From project root
npm run dev
```

**Or start individual services:**

```bash
# Terminal 1: API Server
cd packages/api
npm run dev
# Runs on http://localhost:3001

# Terminal 2: WebSocket Server  
cd packages/realtime
npm run dev
# Runs on http://localhost:3002

# Terminal 3: Frontend
cd packages/web
npm run dev  
# Runs on http://localhost:3000
```

### 6. Verification Tests

**Test API Health:**
```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok","timestamp":"...","services":{"database":"connected","redis":"connected"}}
```

**Test WebSocket Connection:**
```bash
curl http://localhost:3002/health
# Expected: {"status":"ok","connections":0}
```

**Test Frontend:**
- Open `http://localhost:3000`
- Should see landing page with project input
- Check browser console for no errors

---

## Development Workflow

### Daily Development Commands

```bash
# Update dependencies
npm install

# Database operations
npm run db:reset      # Reset development database
npm run db:seed       # Add sample data
npm run db:migrate    # Apply new migrations

# Testing
npm test              # Run all tests
npm run test:watch    # Watch mode for development
npm run test:coverage # Coverage report

# Code quality
npm run lint          # ESLint checking
npm run lint:fix      # Auto-fix linting issues
npm run type-check    # TypeScript validation
```

### Package-Specific Commands

```bash
# API development
cd packages/api
npm run dev           # Start with nodemon
npm run test          # API tests only
npm run db:studio     # Prisma Studio

# Frontend development  
cd packages/web
npm run dev           # Vite dev server
npm run build         # Production build
npm run preview       # Preview build

# Real-time service
cd packages/realtime
npm run dev           # Socket.IO server
npm run test          # WebSocket tests
```

---

## Troubleshooting

### Common Issues

**"Cannot connect to database"**
```bash
# Check if PostgreSQL is running
pg_isready -h localhost -p 5432

# Check connection string in .env.local
# Make sure database exists
createdb bmad_development
```

**"Redis connection failed"**
```bash
# Check if Redis is running
redis-cli ping

# If using Docker
docker ps | grep redis
docker-compose up redis
```

**"OpenAI API key invalid"**
- Verify API key in .env.local
- Check OpenAI dashboard for usage limits
- Ensure billing is set up for OpenAI account

**"Port already in use"**
```bash
# Find process using port
lsof -i :3001
kill -9 <PID>

# Or use different ports in .env.local
API_PORT=3011
REALTIME_PORT=3012
WEB_PORT=3010
```

**TypeScript compilation errors**
```bash
# Clean and reinstall
npm run clean
npm install

# Regenerate Prisma client
cd packages/api
npx prisma generate
```

### Development Tools

**Prisma Studio** (Database GUI):
```bash
cd packages/api
npx prisma studio
# Opens at http://localhost:5555
```

**Redis Commander** (Redis GUI):
```bash
npm install -g redis-commander
redis-commander
# Opens at http://localhost:8081
```

### Logging and Debugging

**View application logs:**
```bash
# API logs
tail -f packages/api/logs/app.log

# Real-time service logs  
tail -f packages/realtime/logs/websocket.log
```

**Debug mode:**
```env
# Add to .env.local
LOG_LEVEL="debug"
DEBUG="bmad:*"
```

---

## IDE Setup

### VS Code Configuration

**Recommended Extensions:**
- TypeScript and JavaScript Language Features
- Prisma
- ESLint
- Prettier - Code formatter
- Thunder Client (API testing)
- Docker
- GitLens

**Workspace Settings (`.vscode/settings.json`):**
```json
{
  "typescript.preferences.includePackageJsonAutoImports": "auto",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "files.associations": {
    "*.prisma": "prisma"
  }
}
```

---

## Performance Considerations

### Development Optimization

**Fast refresh setup:**
- Vite dev server for instant frontend updates
- Nodemon for automatic API restarts
- TypeScript incremental compilation

**Database optimization:**
```bash
# Use connection pooling in development
DATABASE_URL="postgresql://username:password@localhost:5432/bmad_development?connection_limit=10"
```

**Memory usage:**
- Each service runs in separate process
- Expect ~200MB RAM usage for complete stack
- Use `npm run dev:light` for reduced memory usage (disables some features)

---

## Team Collaboration

### Code Standards

**Before committing:**
```bash
npm run lint          # Fix linting issues
npm run type-check    # Verify TypeScript
npm test              # All tests pass
```

**Git hooks:**
- Pre-commit: Linting and type checking
- Pre-push: Full test suite

### Database Changes

**Creating migrations:**
```bash
cd packages/api
npx prisma migrate dev --name descriptive_name
git add prisma/migrations/
```

**Never:**
- Modify existing migration files
- Commit without running migrations locally
- Reset production database

---

## Next Steps After Setup

1. **Verify Complete Setup:**
   - All services running without errors
   - Database connection established  
   - API endpoints responding
   - Frontend loading correctly

2. **Start Development:**
   - Choose a story from `docs/stories/`
   - Create feature branch: `git checkout -b feature/story-1.1`
   - Follow story acceptance criteria
   - Write tests first (TDD approach)

3. **Get Support:**
   - Check troubleshooting section above
   - Review architecture documentation
   - Ask Senior Developer for guidance

**Development Environment Setup Complete! 🎉**

Ready to start building the BMAD Web UI Platform.