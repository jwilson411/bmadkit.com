# BMAD API

BMAD (Business Methodology for AI Development) API - Backend orchestration services for the BMAD platform.

## Overview

The BMAD API is the core backend service that orchestrates AI agent interactions, manages user sessions, and provides secure access to planning methodologies and document generation services.

## Features

- **Multi-Agent System**: Coordinates between Analyst, PM, UX Expert, and Architect agents
- **Session Management**: Redis-based session handling with secure JWT authentication
- **Document Management**: Automated generation of project briefs, PRDs, architecture docs, and user stories
- **Real-time Processing**: WebSocket support for live planning session updates
- **Security-First**: Comprehensive security middleware with rate limiting and input validation
- **Production-Ready**: Full CI/CD pipeline, monitoring, and error handling

## Tech Stack

- **Runtime**: Node.js 20.11.0 LTS
- **Framework**: Express.js 4.18.2
- **Language**: TypeScript 5.3.3
- **Database**: PostgreSQL 15.4 with Prisma 5.7.1 ORM
- **Cache**: Redis 7.2 for session management
- **Authentication**: JWT with bcryptjs password hashing
- **Validation**: express-validator with Zod schemas
- **Testing**: Jest with SuperTest
- **Security**: Helmet.js, CORS, rate limiting

## Quick Start

### Prerequisites

- Node.js 20.11.0 LTS
- PostgreSQL 15.4+
- Redis 7.2+

### Installation

1. Clone the repository and navigate to the API package:
   ```bash
   git clone <repo-url>
   cd bmadkit.com/packages/api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Run the setup script:
   ```bash
   ./scripts/setup.sh
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`.

## Environment Configuration

### Required Environment Variables

```env
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/bmad_dev"

# Redis Configuration  
REDIS_URL="redis://localhost:6379"

# Security Configuration
JWT_SECRET="your-super-secure-jwt-secret-key-minimum-32-characters-long"
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"
```

### Optional Environment Variables

```env
# Server Configuration
NODE_ENV="development"
PORT=3001
LOG_LEVEL="info"

# External Services
OPENAI_API_KEY="your-openai-api-key"
ANTHROPIC_API_KEY="your-anthropic-api-key"
STRIPE_SECRET_KEY="your-stripe-secret-key"
```

## API Endpoints

### Health & Status

- `GET /health` - Basic health check
- `GET /api/health` - Detailed health check with system info
- `GET /api/v1/status` - API status and version info

### Authentication (Coming Soon)

- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/refresh` - Token refresh

### Planning Sessions (Coming Soon)

- `POST /api/v1/sessions` - Create new planning session
- `GET /api/v1/sessions/:id` - Get session details
- `PUT /api/v1/sessions/:id` - Update session
- `DELETE /api/v1/sessions/:id` - Delete session

### Documents (Coming Soon)

- `GET /api/v1/sessions/:id/documents` - List session documents
- `GET /api/v1/documents/:id` - Get document by ID
- `POST /api/v1/documents/:id/export` - Export document

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm test` - Run test suite
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

### Database Operations

- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Run database migrations
- `npm run db:deploy` - Deploy migrations to production
- `npm run db:reset` - Reset database (development only)
- `npm run db:seed` - Seed database with initial data

### Testing

The API includes comprehensive test coverage:

- **Unit Tests**: Individual utility and middleware functions
- **Integration Tests**: API endpoint testing with SuperTest
- **Security Tests**: Authentication and validation testing
- **Database Tests**: Repository and query testing

Run tests with:
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Architecture

### Directory Structure

```
src/
├── controllers/     # Request handlers
├── middleware/      # Express middleware
├── services/        # Business logic
├── utils/          # Utility functions
├── tests/          # Test files
├── types/          # TypeScript definitions
└── app.ts          # Express app configuration
```

### Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcryptjs with salt rounds
- **Rate Limiting**: IP-based request throttling
- **Input Validation**: Comprehensive request validation
- **Security Headers**: Helmet.js security headers
- **CORS Configuration**: Cross-origin resource sharing
- **SQL Injection Protection**: Prisma ORM parameterized queries

### Error Handling

The API uses structured error handling with:
- Centralized error middleware
- Correlation ID tracking
- Comprehensive logging
- Secure error responses (no sensitive data leakage)

## Deployment

### Production Build

```bash
npm run build
npm run start
```

### Docker (Coming Soon)

```bash
docker build -t bmad-api .
docker run -p 3001:3001 bmad-api
```

### CI/CD

GitHub Actions workflows are included for:
- **CI**: Lint, test, and build on PR/push
- **Security**: Dependency audit and CodeQL analysis
- **Deploy**: Automated staging and production deployment

## Monitoring & Logging

### Structured Logging

The API uses Winston for structured logging with:
- Correlation ID tracking
- Request/response logging
- Error tracking
- Performance metrics

### Health Checks

- `/health` - Basic health endpoint
- `/api/health` - Detailed system health
- Database connectivity checks
- Redis connectivity checks

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for your changes
5. Ensure all tests pass (`npm test`)
6. Run linting (`npm run lint`)
7. Commit your changes (`git commit -m 'Add amazing feature'`)
8. Push to the branch (`git push origin feature/amazing-feature`)
9. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please open an issue in the GitHub repository or contact the development team.