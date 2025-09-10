# BMAD Platform Source Tree Structure

## Project Structure

```
bmad-platform/
├── packages/
│   ├── api/                     # Backend orchestration services
│   │   ├── src/
│   │   │   ├── services/        # Core business logic services
│   │   │   │   ├── orchestration.ts    # BMAD agent workflow engine
│   │   │   │   ├── session-manager.ts  # Session lifecycle management
│   │   │   │   ├── llm-gateway.ts      # Dual LLM provider integration
│   │   │   │   ├── auth.ts             # Authentication service
│   │   │   │   └── document-generator.ts # Document generation
│   │   │   ├── controllers/     # HTTP request handlers
│   │   │   │   ├── sessions.ts         # Session API endpoints
│   │   │   │   ├── auth.ts             # Authentication endpoints
│   │   │   │   ├── agents.ts           # Agent execution endpoints
│   │   │   │   └── documents.ts        # Document export endpoints
│   │   │   ├── middleware/      # Authentication, validation, logging
│   │   │   │   ├── auth.ts             # JWT validation middleware
│   │   │   │   ├── validation.ts       # Zod validation middleware
│   │   │   │   ├── rate-limit.ts       # Rate limiting
│   │   │   │   └── error-handler.ts    # Global error handling
│   │   │   ├── models/          # Prisma schema and database models
│   │   │   │   ├── user.ts            # User model
│   │   │   │   ├── session.ts         # Planning session model
│   │   │   │   ├── message.ts         # Conversation message model
│   │   │   │   ├── agent-execution.ts # Agent execution tracking
│   │   │   │   └── document.ts        # Document model
│   │   │   ├── utils/           # Shared utilities and helpers
│   │   │   │   ├── logger.ts          # Winston logging configuration
│   │   │   │   ├── circuit-breaker.ts # Circuit breaker implementation
│   │   │   │   ├── retry-logic.ts     # Exponential backoff retry
│   │   │   │   └── validation-schemas.ts # Zod validation schemas
│   │   │   └── app.ts           # Express application setup
│   │   ├── prisma/              # Database schema and migrations
│   │   │   ├── schema.prisma           # Prisma schema definition
│   │   │   ├── migrations/             # Database migrations
│   │   │   └── seed.ts                 # Database seeding
│   │   ├── tests/               # Test files
│   │   │   ├── integration/            # Integration tests
│   │   │   ├── unit/                   # Unit tests
│   │   │   └── fixtures/               # Test data fixtures
│   │   └── package.json
│   ├── realtime/               # WebSocket service
│   │   ├── src/
│   │   │   ├── handlers/        # Socket event handlers
│   │   │   │   ├── session.ts          # Session-specific handlers
│   │   │   │   ├── document.ts         # Document update handlers
│   │   │   │   └── agent.ts            # Agent status handlers
│   │   │   ├── middleware/      # Socket authentication
│   │   │   │   ├── auth.ts             # Socket authentication middleware
│   │   │   │   └── rate-limit.ts       # Connection rate limiting
│   │   │   ├── services/        # Real-time business logic
│   │   │   │   ├── broadcast.ts        # Message broadcasting
│   │   │   │   └── connection.ts       # Connection management
│   │   │   └── server.ts               # Socket.IO server setup
│   │   └── package.json
│   ├── web/                    # Frontend React application
│   │   ├── src/
│   │   │   ├── components/      # Reusable UI components
│   │   │   │   ├── layout/             # Layout components
│   │   │   │   ├── forms/              # Form components
│   │   │   │   ├── ui/                 # Basic UI elements
│   │   │   │   └── features/           # Feature-specific components
│   │   │   │       ├── landing/        # Landing page components
│   │   │   │       ├── session/        # Planning session components
│   │   │   │       ├── auth/           # Authentication components
│   │   │   │       └── documents/      # Document display components
│   │   │   ├── pages/           # Page components
│   │   │   │   ├── Home.tsx            # Landing page
│   │   │   │   ├── Planning.tsx        # Planning session page
│   │   │   │   ├── Login.tsx           # Login page
│   │   │   │   └── Dashboard.tsx       # User dashboard
│   │   │   ├── hooks/           # Custom React hooks
│   │   │   │   ├── useWebSocket.ts     # WebSocket connection hook
│   │   │   │   ├── useSession.ts       # Session management hook
│   │   │   │   └── useAuth.ts          # Authentication hook
│   │   │   ├── store/           # Redux store
│   │   │   │   ├── sessionSlice.ts     # Session state management
│   │   │   │   ├── authSlice.ts        # Authentication state
│   │   │   │   └── index.ts            # Store configuration
│   │   │   ├── services/        # API service layer
│   │   │   │   ├── api.ts              # Base API client
│   │   │   │   ├── session.ts          # Session API calls
│   │   │   │   └── auth.ts             # Authentication API calls
│   │   │   ├── types/           # TypeScript type definitions
│   │   │   │   ├── api.ts              # API response types
│   │   │   │   ├── session.ts          # Session types
│   │   │   │   └── auth.ts             # Authentication types
│   │   │   ├── utils/           # Frontend utilities
│   │   │   │   ├── formatting.ts       # Text/date formatting
│   │   │   │   └── validation.ts       # Form validation
│   │   │   ├── styles/          # CSS and styling
│   │   │   │   ├── globals.css         # Global styles
│   │   │   │   └── components.css      # Component styles
│   │   │   ├── App.tsx          # Root application component
│   │   │   └── main.tsx         # Application entry point
│   │   ├── public/              # Static assets
│   │   ├── index.html           # HTML template
│   │   ├── vite.config.ts       # Vite configuration
│   │   └── package.json
│   ├── shared/                 # Shared TypeScript types and utilities
│   │   ├── src/
│   │   │   ├── types/          # Common type definitions
│   │   │   │   ├── user.ts            # User-related types
│   │   │   │   ├── session.ts         # Session-related types
│   │   │   │   ├── agent.ts           # Agent-related types
│   │   │   │   ├── document.ts        # Document-related types
│   │   │   │   └── api.ts             # API contract types
│   │   │   ├── constants/      # Shared constants
│   │   │   │   ├── agents.ts          # Agent types and constants
│   │   │   │   └── errors.ts          # Error codes and messages
│   │   │   └── utils/          # Shared utility functions
│   │   │       ├── validation.ts      # Shared validation schemas
│   │   │       └── formatting.ts     # Shared formatting utilities
│   │   └── package.json
│   └── infrastructure/         # Infrastructure as Code
│       ├── terraform/          # Cloud resource definitions
│       │   ├── environments/          # Environment-specific configs
│       │   │   ├── development/
│       │   │   ├── staging/
│       │   │   └── production/
│       │   ├── modules/               # Reusable Terraform modules
│       │   │   ├── database/
│       │   │   ├── redis/
│       │   │   └── networking/
│       │   └── main.tf               # Main Terraform configuration
│       └── docker/             # Container configurations
│           ├── api.Dockerfile         # API service container
│           ├── realtime.Dockerfile    # Real-time service container
│           ├── web.Dockerfile         # Frontend container
│           └── docker-compose.yml     # Development environment
├── scripts/                    # Monorepo management and deployment
│   ├── build.sh                      # Build script
│   ├── deploy.sh                     # Deployment script
│   ├── test.sh                       # Testing script
│   └── setup.sh                      # Development setup
├── docs/                       # Project documentation
│   ├── architecture/                 # Architecture documentation
│   ├── api/                          # API documentation
│   └── deployment/                   # Deployment guides
├── .github/                    # GitHub configuration
│   └── workflows/                    # GitHub Actions workflows
│       ├── ci.yml                    # Continuous integration
│       ├── deploy.yml                # Deployment workflow
│       └── security.yml              # Security scanning
├── package.json               # Root workspace configuration
├── tsconfig.json             # TypeScript configuration
├── .eslintrc.js              # ESLint configuration
├── .prettierrc               # Prettier configuration
└── README.md                 # Project documentation
```

## Key Directory Purposes

### packages/api/
Core backend orchestration services handling BMAD agent workflows, session management, and LLM integration.

### packages/realtime/
WebSocket service providing real-time document streaming and progress updates during planning sessions.

### packages/web/
React frontend application implementing the "Planning Theater" user experience with real-time document viewing.

### packages/shared/
Common TypeScript types and utilities shared between frontend and backend services.

### packages/infrastructure/
Infrastructure as Code using Terraform for cloud resource management and Docker for containerization.

## Monorepo Structure Benefits

- **Shared Types**: Common type definitions prevent API contract mismatches
- **Coordinated Deployment**: Real-time features requiring frontend/backend synchronization
- **Code Sharing**: Utilities and constants shared across services
- **Unified Development**: Single repository for all platform components