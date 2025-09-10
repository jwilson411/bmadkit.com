# BMAD Platform Technology Stack

## Core Technology Stack

| Category | Technology | Version | Purpose | Rationale |
|----------|------------|---------|---------|-----------|
| **Language** | TypeScript | 5.3.3 | Primary development language | Strong typing prevents runtime errors in complex orchestration logic, excellent LLM SDK support |
| **Runtime** | Node.js | 20.11.0 LTS | JavaScript runtime | LTS stability, excellent async performance for real-time features, team expertise |
| **Framework** | Express.js | 4.18.2 | Backend API framework | Lightweight, mature ecosystem, Socket.IO integration, suitable for microservices |
| **Database** | PostgreSQL | 15.4 | Primary data store | ACID compliance for session integrity, JSON support for flexible schemas, Prisma compatibility |
| **ORM** | Prisma | 5.7.1 | Database abstraction | Type-safe queries, excellent migration system, perfect TypeScript integration |
| **Caching** | Redis | 7.2 | Session state and caching | In-memory performance for 45-minute sessions, pub/sub for real-time features |
| **Real-time** | Socket.IO | 4.7.4 | WebSocket communication | Automatic fallback support, room management, excellent Node.js integration |
| **Message Queue** | Bull Queue | 4.12.2 | Background job processing | Redis-based, perfect for orchestrating agent workflows, retry logic |
| **LLM Primary** | OpenAI SDK | 4.26.0 | GPT-4 integration | Most reliable provider, excellent documentation, proven performance |
| **LLM Fallback** | Anthropic SDK | 0.12.0 | Claude integration | Backup provider for 99.9% uptime, different capabilities for edge cases |
| **Authentication** | JWT + Passport | 0.7.0 / 0.6.0 | User authentication | Stateless tokens, mature ecosystem, Stripe integration ready |
| **Payments** | Stripe Node SDK | 14.12.0 | Payment processing | Industry standard, comprehensive billing features, webhook support |
| **Validation** | Zod | 3.22.4 | Runtime type validation | TypeScript-first, perfect for API validation, LLM response parsing |
| **Testing** | Jest + Supertest | 29.7.0 / 6.3.3 | Unit and integration testing | Mature ecosystem, excellent mocking, API testing capabilities |
| **Monitoring** | Winston + Sentry | 3.11.0 / 7.81.1 | Logging and error tracking | Production-ready logging, comprehensive error monitoring |
| **Process Management** | PM2 | 5.3.0 | Production process management | Zero-downtime deployment, clustering, monitoring |

## Cloud Infrastructure

- **Provider:** Multi-cloud (Vercel + Railway/AWS)
- **Key Services:** 
  - Vercel for frontend CDN and edge functions
  - Railway for backend services (development simplicity)
  - AWS SQS/SNS for production message queuing
  - AWS RDS PostgreSQL for managed database
- **Deployment Regions:** US-East (primary), US-West (secondary)

## Frontend Technologies

| Technology | Purpose | Version |
|------------|---------|---------|
| React | Frontend framework | 18+ |
| TypeScript | Type safety | 5.3.3 |
| Tailwind CSS | Styling framework | Latest |
| Redux Toolkit | State management | Latest |
| Socket.IO Client | Real-time communication | 4.7.4 |
| Vite | Build tool | Latest |

## Development Tools

- **Linting:** ESLint + Prettier with TypeScript-specific rules
- **Testing:** Jest for unit tests, Supertest for API testing
- **CI/CD:** GitHub Actions
- **Infrastructure:** Terraform 1.6.0
- **Containerization:** Docker (development environment)
- **Security Scanning:** Snyk for dependency vulnerabilities