# BMAD Platform Coding Standards

## Core Standards

- **Languages & Runtimes:** TypeScript 5.3.3, Node.js 20.11.0 LTS
- **Style & Linting:** ESLint + Prettier with TypeScript-specific rules
- **Test Organization:** `*.test.ts` files co-located with source code

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | session-service.ts |
| Classes | PascalCase | SessionManager |
| Functions | camelCase | executeAgent |
| Constants | SCREAMING_SNAKE_CASE | MAX_SESSION_DURATION |
| Interfaces | PascalCase with 'I' prefix | ISessionManager |
| Types | PascalCase | SessionStatus |
| Enums | PascalCase | AgentType |
| Variables | camelCase | currentSession |
| Database Tables | snake_case | planning_sessions |
| API Endpoints | kebab-case | /api/sessions/start |

## File Organization

### Directory Structure
- Use kebab-case for all directory names
- Group related files by feature/domain
- Keep test files co-located with source files

### File Naming
- Use descriptive, specific names
- Include file type in name when helpful
- Examples: `session-manager.ts`, `auth.middleware.ts`, `user.model.ts`

## TypeScript Standards

### Type Definitions
```typescript
// Use interfaces for object shapes
interface SessionCreateRequest {
  projectInput: string;
  userPreferences?: UserPreferences;
}

// Use types for unions and computed types
type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED';
type SessionWithUser = Session & { user: User };

// Use enums for fixed sets of values
enum AgentType {
  ANALYST = 'ANALYST',
  PM = 'PM',
  UX_EXPERT = 'UX_EXPERT',
  ARCHITECT = 'ARCHITECT'
}
```

### Function Signatures
```typescript
// Use explicit return types for public functions
export async function createSession(
  request: SessionCreateRequest,
  userId?: string
): Promise<Session> {
  // implementation
}

// Use proper error handling with typed errors
export class SessionError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'SessionError';
  }
}
```

## Critical Rules

### 🚫 Never Do
- **No console.log in production code** - Use Winston logger with appropriate levels
- **No hardcoded secrets or API keys** - Use environment variables only
- **No raw SQL queries** - Use Prisma ORM except for complex analytics
- **No direct database access from controllers** - Use service layer
- **No business logic in middleware** - Keep middleware focused on cross-cutting concerns

### ✅ Always Do
- **All API responses must use ApiResponse wrapper type** - Ensures consistent response structure
- **Database queries must use Prisma ORM** - Provides type safety and migration management
- **LLM requests must go through LLM Gateway Service** - Centralized cost tracking and failover logic
- **All external API calls must implement circuit breaker pattern** - Prevents cascading failures
- **All inputs must be validated with Zod schemas** - Runtime type validation at API boundaries

## Logging Standards

### Winston Configuration
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'bmad-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});
```

### Required Context
```typescript
// Always include correlation ID and context
logger.info('Session created', {
  correlationId: req.correlationId,
  sessionId: session.id,
  userId: session.userId,
  agentType: AgentType.ANALYST
});

// Never log sensitive information
logger.error('Authentication failed', {
  correlationId: req.correlationId,
  // ❌ Don't log: password, tokens, payment info
  email: user.email.substring(0, 3) + '***' // Masked PII
});
```

## Error Handling

### Error Hierarchy
```typescript
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class BusinessLogicError extends ApiError {
  constructor(message: string, code: string) {
    super(message, 400, code);
    this.name = 'BusinessLogicError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, field?: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class ExternalServiceError extends ApiError {
  constructor(service: string, originalError: Error) {
    super(`External service error: ${service}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.name = 'ExternalServiceError';
  }
}
```

### Error Response Format
```typescript
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    correlationId: string;
    timestamp: string;
  };
}
```

## API Standards

### Request/Response Format
```typescript
// Request validation with Zod
const CreateSessionSchema = z.object({
  projectInput: z.string().min(10).max(5000),
  userPreferences: z.object({
    industry: z.string().optional(),
    complexity: z.enum(['simple', 'medium', 'complex']).optional()
  }).optional()
});

// Controller pattern
export class SessionController {
  async createSession(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedData = CreateSessionSchema.parse(req.body);
      const session = await this.sessionService.createSession(validatedData, req.user?.id);
      
      res.status(201).json({
        success: true,
        data: session,
        correlationId: req.correlationId
      });
    } catch (error) {
      next(error); // Let error middleware handle
    }
  }
}
```

### Middleware Pattern
```typescript
export const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(new ValidationError('Invalid request data'));
    }
  };
};
```

## Database Standards

### Prisma Schema Conventions
```prisma
model PlanningSession {
  id              String   @id @default(cuid())
  userId          String?  @map("user_id")
  projectInput    String   @map("project_input")
  sessionData     Json     @map("session_data")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  user            User?    @relation(fields: [userId], references: [id])
  messages        ConversationMessage[]
  documents       Document[]

  @@map("planning_sessions")
  @@index([userId])
  @@index([createdAt])
}
```

### Query Patterns
```typescript
// Service layer pattern
export class SessionService {
  async createSession(data: CreateSessionData, userId?: string): Promise<Session> {
    return this.prisma.planningSession.create({
      data: {
        projectInput: data.projectInput,
        userId,
        sessionData: data.userPreferences || {},
        status: SessionStatus.ACTIVE
      },
      include: {
        user: true,
        messages: {
          orderBy: { sequenceNumber: 'asc' }
        }
      }
    });
  }

  // Always handle not found cases
  async getSessionById(id: string): Promise<Session> {
    const session = await this.prisma.planningSession.findUnique({
      where: { id },
      include: { user: true, messages: true }
    });

    if (!session) {
      throw new BusinessLogicError('Session not found', 'SESSION_NOT_FOUND');
    }

    return session;
  }
}
```

## Testing Standards

### Test File Organization
```typescript
// session-service.test.ts
describe('SessionService', () => {
  let service: SessionService;
  let mockPrisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaClient>();
    service = new SessionService(mockPrisma);
  });

  describe('createSession', () => {
    it('should create session with valid data', async () => {
      // Arrange
      const sessionData = { projectInput: 'Test project description' };
      const expectedSession = { id: 'session-1', ...sessionData };
      mockPrisma.planningSession.create.mockResolvedValue(expectedSession);

      // Act
      const result = await service.createSession(sessionData);

      // Assert
      expect(result).toEqual(expectedSession);
      expect(mockPrisma.planningSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining(sessionData),
        include: expect.any(Object)
      });
    });

    it('should throw validation error for invalid input', async () => {
      // Test error conditions
      const invalidData = { projectInput: '' };
      
      await expect(service.createSession(invalidData))
        .rejects
        .toThrow(ValidationError);
    });
  });
});
```

### Mock Patterns
```typescript
// Use factory pattern for test data
export const createMockSession = (overrides?: Partial<Session>): Session => ({
  id: 'session-1',
  userId: 'user-1',
  projectInput: 'Test project',
  status: SessionStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});
```

## Security Standards

### Input Validation
```typescript
// Always validate at API boundary
export const validateSessionCreate = z.object({
  projectInput: z.string()
    .min(10, 'Project description too short')
    .max(5000, 'Project description too long')
    .regex(/^[a-zA-Z0-9\s.,!?-]+$/, 'Invalid characters in project description'),
  userPreferences: z.object({
    industry: z.string().max(100).optional(),
    complexity: z.enum(['simple', 'medium', 'complex']).optional()
  }).optional()
});
```

### Authentication Middleware
```typescript
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      throw new ApiError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = await userService.getUserById(decoded.sub);
    next();
  } catch (error) {
    next(new ApiError('Invalid token', 401, 'INVALID_TOKEN'));
  }
};
```

### Data Sanitization
```typescript
// Sanitize user input before database storage
export const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .substring(0, 5000); // Limit length
};
```

## Performance Standards

### Query Optimization
```typescript
// Use select to limit data transfer
const sessions = await this.prisma.planningSession.findMany({
  select: {
    id: true,
    projectInput: true,
    status: true,
    createdAt: true,
    user: {
      select: { id: true, email: true } // Don't select sensitive data
    }
  },
  where: { userId },
  orderBy: { createdAt: 'desc' },
  take: 10 // Pagination
});
```

### Caching Patterns
```typescript
// Redis caching for frequently accessed data
export class SessionCache {
  async getSession(sessionId: string): Promise<Session | null> {
    const cached = await this.redis.get(`session:${sessionId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const session = await this.sessionService.getSession(sessionId);
    await this.redis.setex(`session:${sessionId}`, 300, JSON.stringify(session));
    return session;
  }
}
```

These coding standards ensure consistency, maintainability, and security across the BMAD platform codebase.