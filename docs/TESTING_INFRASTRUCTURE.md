# BMAD Web UI Platform - Testing Infrastructure Documentation

**Last Updated:** 2025-09-08  
**Version:** 1.0  
**Maintained By:** QA (Quinn) & Senior Developer  
**Purpose:** Comprehensive testing strategy and infrastructure setup for the BMAD platform

---

## Overview

This document defines the complete testing infrastructure for the BMAD Web UI Platform, including testing strategies, tools, frameworks, and procedures to ensure 99.9% uptime and reliable user experience.

**Quality Goals:**
- 99.9% uptime during 45-minute planning sessions
- < 3 second page load times
- Zero data loss during session interruptions
- Comprehensive test coverage (>90% code coverage)

---

## Testing Strategy Matrix

| Test Type | Coverage | Tools | Responsibility | Automation Level |
|-----------|----------|-------|---------------|------------------|
| **Unit Tests** | Individual functions/components | Jest, Vitest | Senior Developer | 100% Automated |
| **Integration Tests** | Service-to-service communication | Jest, Supertest | QA (Quinn) | 100% Automated |
| **End-to-End Tests** | Complete user workflows | Playwright | QA (Quinn) | 90% Automated |
| **Load/Performance Tests** | 1K concurrent users | Artillery, k6 | QA (Quinn) | Automated via CI |
| **Security Tests** | Vulnerability scanning | OWASP ZAP | QA (Quinn) | 80% Automated |
| **Manual Testing** | User acceptance, edge cases | Manual | User | Manual |

---

## 1. Test Environment Setup

### 1.1 Development Testing Environment

**Local Development Stack:**
```bash
# Test database setup
DATABASE_URL="postgresql://test_user:test_pass@localhost:5432/bmad_test"
REDIS_URL="redis://localhost:6379/1"  # Use database 1 for tests
NODE_ENV="test"

# Test-specific environment variables
OPENAI_API_KEY="sk-test-fake-key-for-mocking"
ANTHROPIC_API_KEY="sk-ant-test-fake-key"
JWT_SECRET="test-jwt-secret-not-secure"
```

**Test Database Management:**
```bash
# packages/api/scripts/test-db-setup.sh
#!/bin/bash
echo "Setting up test database..."
createdb bmad_test
npm run db:migrate:test
npm run db:seed:test
echo "Test database ready"
```

### 1.2 CI/CD Testing Environment

**GitHub Actions Test Configuration:**
```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test_pass
          POSTGRES_USER: test_user  
          POSTGRES_DB: bmad_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run unit tests
        run: npm run test:unit
        
      - name: Run integration tests  
        run: npm run test:integration
        
      - name: Run E2E tests
        run: npm run test:e2e
        
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
```

---

## 2. Unit Testing Framework

### 2.1 Backend Unit Tests (Jest)

**Configuration:**
```typescript
// packages/api/jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/**/*'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts']
};
```

**Example Unit Test:**
```typescript
// packages/api/src/services/__tests__/auth.test.ts
import { AuthService } from '../auth';
import { User } from '../../models/user';
import bcrypt from 'bcrypt';

jest.mock('bcrypt');
jest.mock('../../models/user');

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    jest.clearAllMocks();
  });

  describe('registerUser', () => {
    it('should create user with hashed password', async () => {
      // Arrange
      const userData = { email: 'test@example.com', password: 'password123' };
      const hashedPassword = 'hashedPassword';
      
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      (User.create as jest.Mock).mockResolvedValue({ id: 1, ...userData });

      // Act
      const result = await authService.registerUser(userData);

      // Assert
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      expect(User.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        password_hash: hashedPassword
      });
    });

    it('should throw error for duplicate email', async () => {
      // Arrange
      const userData = { email: 'duplicate@example.com', password: 'password123' };
      (User.findUnique as jest.Mock).mockResolvedValue({ id: 1 });

      // Act & Assert
      await expect(authService.registerUser(userData)).rejects.toThrow('Email already exists');
    });
  });
});
```

### 2.2 Frontend Unit Tests (Vitest)

**Configuration:**
```typescript
// packages/web/vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
      ],
    },
  },
});
```

**Example Component Test:**
```typescript
// packages/web/src/components/__tests__/ProjectInput.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectInput } from '../ProjectInput';

describe('ProjectInput', () => {
  const mockOnSubmit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render input field with placeholder', () => {
    render(<ProjectInput onSubmit={mockOnSubmit} />);
    
    expect(screen.getByPlaceholderText(/describe your project idea/i)).toBeInTheDocument();
  });

  it('should validate input length', async () => {
    render(<ProjectInput onSubmit={mockOnSubmit} maxLength={100} />);
    
    const input = screen.getByRole('textbox');
    const longText = 'a'.repeat(150);
    
    fireEvent.change(input, { target: { value: longText } });
    fireEvent.click(screen.getByRole('button', { name: /start planning/i }));

    await waitFor(() => {
      expect(screen.getByText(/project description too long/i)).toBeInTheDocument();
    });
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should submit valid input', async () => {
    render(<ProjectInput onSubmit={mockOnSubmit} />);
    
    const input = screen.getByRole('textbox');
    const validInput = 'Build a mobile app for task management';
    
    fireEvent.change(input, { target: { value: validInput } });
    fireEvent.click(screen.getByRole('button', { name: /start planning/i }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(validInput);
    });
  });
});
```

---

## 3. Integration Testing Framework

### 3.1 API Integration Tests

**Test Setup:**
```typescript
// packages/api/src/test/integration/setup.ts
import { Express } from 'express';
import { createApp } from '../../app';
import { PrismaClient } from '@prisma/client';
import { createRedisClient } from '../../utils/redis';

export class TestEnvironment {
  public app: Express;
  public prisma: PrismaClient;
  public redis: any;

  async setup() {
    this.app = createApp();
    this.prisma = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } }
    });
    this.redis = createRedisClient(process.env.TEST_REDIS_URL);
    
    await this.prisma.$executeRaw`TRUNCATE TABLE "User", "PlanningSession" CASCADE`;
    await this.redis.flushdb();
  }

  async teardown() {
    await this.prisma.$disconnect();
    await this.redis.quit();
  }
}
```

**Example Integration Test:**
```typescript
// packages/api/src/test/integration/auth.test.ts
import request from 'supertest';
import { TestEnvironment } from './setup';

describe('Auth Integration Tests', () => {
  let testEnv: TestEnvironment;

  beforeAll(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterAll(async () => {
    await testEnv.teardown();
  });

  describe('POST /auth/register', () => {
    it('should register new user and return JWT', async () => {
      const userData = {
        email: 'integration@test.com',
        password: 'Password123!'
      };

      const response = await request(testEnv.app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toMatchObject({
        user: { email: userData.email },
        token: expect.stringMatching(/^eyJ/)
      });

      // Verify user was created in database
      const user = await testEnv.prisma.user.findUnique({
        where: { email: userData.email }
      });
      expect(user).toBeTruthy();
    });

    it('should reject duplicate email registration', async () => {
      const userData = {
        email: 'duplicate@test.com',
        password: 'Password123!'
      };

      // Register user first time
      await request(testEnv.app)
        .post('/auth/register')
        .send(userData)
        .expect(201);

      // Try to register again
      await request(testEnv.app)
        .post('/auth/register')
        .send(userData)
        .expect(409);
    });
  });

  describe('Session Management Integration', () => {
    it('should create session and maintain state', async () => {
      // Register and login user
      const loginResponse = await request(testEnv.app)
        .post('/auth/login')
        .send({ email: 'session@test.com', password: 'Password123!' });

      const token = loginResponse.body.token;

      // Create planning session
      const sessionResponse = await request(testEnv.app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({ project_input: 'Build a mobile app' })
        .expect(201);

      // Verify session in Redis
      const sessionData = await testEnv.redis.get(`session:${sessionResponse.body.id}`);
      expect(JSON.parse(sessionData)).toMatchObject({
        project_input: 'Build a mobile app',
        status: 'ACTIVE'
      });
    });
  });
});
```

### 3.2 WebSocket Integration Tests

```typescript
// packages/realtime/src/test/websocket.test.ts
import { io, Socket } from 'socket.io-client';
import { createServer } from '../server';

describe('WebSocket Integration Tests', () => {
  let server: any;
  let clientSocket: Socket;
  let serverSocket: any;

  beforeAll((done) => {
    server = createServer();
    server.listen(3003, () => {
      clientSocket = io('http://localhost:3003', {
        auth: { token: 'valid-jwt-token' }
      });
      
      server.on('connection', (socket: any) => {
        serverSocket = socket;
      });
      
      clientSocket.on('connect', done);
    });
  });

  afterAll(() => {
    server.close();
    clientSocket.close();
  });

  it('should join session room and receive updates', (done) => {
    const sessionId = 'test-session-123';
    
    // Join session room
    clientSocket.emit('join_session', { sessionId });

    // Listen for progress updates
    clientSocket.on('progress_updated', (data) => {
      expect(data).toMatchObject({
        sessionId,
        progress: expect.any(Number),
        agent: expect.any(String)
      });
      done();
    });

    // Simulate progress update from server
    setTimeout(() => {
      serverSocket.to(`session:${sessionId}`).emit('progress_updated', {
        sessionId,
        progress: 25,
        agent: 'ANALYST'
      });
    }, 100);
  });
});
```

---

## 4. End-to-End Testing Framework

### 4.1 Playwright E2E Tests

**Configuration:**
```typescript
// packages/e2e/playwright.config.ts
import { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    {
      name: 'Desktop Safari',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
};

export default config;
```

**Example E2E Test:**
```typescript
// packages/e2e/tests/planning-session.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Planning Session Flow', () => {
  test('complete planning session from input to document', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    
    // Verify landing page loads
    await expect(page.locator('h1')).toContainText('Start making your dreams a reality');
    
    // Input project idea
    const projectInput = 'Build a task management mobile app with AI features';
    await page.fill('[data-testid="project-input"]', projectInput);
    await page.click('[data-testid="start-planning"]');
    
    // Wait for planning session to start
    await expect(page.locator('[data-testid="session-status"]')).toContainText('Starting analysis');
    
    // Verify WebSocket connection established
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected');
    
    // Wait for first agent response
    await expect(page.locator('[data-testid="agent-message"]')).toBeVisible({ timeout: 10000 });
    
    // Interact with agent questions
    await page.fill('[data-testid="user-response"]', 'Yes, focus on productivity features');
    await page.click('[data-testid="send-response"]');
    
    // Wait for document generation to begin
    await expect(page.locator('[data-testid="document-preview"]')).toBeVisible({ timeout: 15000 });
    
    // Verify real-time updates
    await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible();
    
    // Wait for session completion
    await expect(page.locator('[data-testid="session-complete"]')).toBeVisible({ timeout: 45000 });
    
    // Verify final document
    await expect(page.locator('[data-testid="final-document"]')).toContainText('Mobile App Development Plan');
  });

  test('handles session interruption gracefully', async ({ page }) => {
    // Start planning session
    await page.goto('/');
    await page.fill('[data-testid="project-input"]', 'Test project interruption');
    await page.click('[data-testid="start-planning"]');
    
    // Wait for session to start
    await expect(page.locator('[data-testid="session-status"]')).toContainText('Starting analysis');
    
    // Simulate network interruption
    await page.setOfflineMode(true);
    
    // Verify offline state handling
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Reconnecting');
    
    // Restore network
    await page.setOfflineMode(false);
    
    // Verify session resumes
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected', { timeout: 10000 });
    await expect(page.locator('[data-testid="session-status"]')).not.toContainText('Error');
  });
});
```

### 4.2 Cross-Browser Testing

```typescript
// packages/e2e/tests/cross-browser.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Cross-Browser Compatibility', () => {
  ['chromium', 'firefox', 'webkit'].forEach(browserName => {
    test(`responsive design works in ${browserName}`, async ({ page, browserName: browser }) => {
      test.skip(browser !== browserName, `This test only runs on ${browserName}`);
      
      await page.goto('/');
      
      // Test mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(page.locator('[data-testid="mobile-menu"]')).toBeVisible();
      
      // Test tablet viewport  
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.locator('[data-testid="tablet-layout"]')).toBeVisible();
      
      // Test desktop viewport
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator('[data-testid="desktop-layout"]')).toBeVisible();
    });
  });
});
```

---

## 5. Performance Testing Framework

### 5.1 Load Testing with Artillery

**Configuration:**
```yaml
# packages/load-tests/artillery.yml
config:
  target: 'https://api.yourdomain.com'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
    - duration: 60
      arrivalRate: 100
      name: "Peak load"
  processor: "./flows.js"

scenarios:
  - name: "Complete Planning Session"
    weight: 70
    flow:
      - post:
          url: "/auth/register"
          json:
            email: "load{{ $randomString() }}@test.com"
            password: "LoadTest123!"
          capture:
            json: "$.token"
            as: "authToken"
      
      - post:
          url: "/api/sessions"
          headers:
            Authorization: "Bearer {{ authToken }}"
          json:
            project_input: "Load test project {{ $randomString() }}"
          capture:
            json: "$.id"
            as: "sessionId"
      
      - ws:
          url: "/ws"
          headers:
            Authorization: "Bearer {{ authToken }}"
          onConnect:
            - emit:
                event: "join_session"
                data:
                  sessionId: "{{ sessionId }}"
          onMessage:
            - think: 2
            - emit:
                event: "user_response"
                data:
                  message: "Continue with standard features"

  - name: "API Health Checks"
    weight: 30
    flow:
      - get:
          url: "/api/health"
          expect:
            - statusCode: 200
```

### 5.2 WebSocket Load Testing

```javascript
// packages/load-tests/websocket-load.js
const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

const CONCURRENT_CONNECTIONS = 1000;
const TEST_DURATION = 300000; // 5 minutes

async function loadTestWebSockets() {
  const connections = [];
  const metrics = {
    connected: 0,
    failed: 0,
    messagesReceived: 0,
    avgLatency: 0
  };

  console.log(`Starting WebSocket load test with ${CONCURRENT_CONNECTIONS} connections...`);

  for (let i = 0; i < CONCURRENT_CONNECTIONS; i++) {
    try {
      const token = jwt.sign({ userId: `load-test-${i}` }, process.env.JWT_SECRET);
      const socket = io('ws://localhost:3002', {
        auth: { token },
        transports: ['websocket']
      });

      socket.on('connect', () => {
        metrics.connected++;
        console.log(`Connected: ${metrics.connected}/${CONCURRENT_CONNECTIONS}`);
      });

      socket.on('disconnect', () => {
        metrics.failed++;
      });

      socket.on('progress_updated', (data) => {
        metrics.messagesReceived++;
      });

      connections.push(socket);
      
      // Stagger connection attempts
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      metrics.failed++;
    }
  }

  // Run test for specified duration
  await new Promise(resolve => setTimeout(resolve, TEST_DURATION));

  // Cleanup
  connections.forEach(socket => socket.disconnect());
  
  console.log('Load test results:', metrics);
  return metrics;
}

if (require.main === module) {
  loadTestWebSockets().catch(console.error);
}
```

---

## 6. Security Testing Framework

### 6.1 Automated Security Testing

**OWASP ZAP Integration:**
```javascript
// packages/security-tests/zap-scan.js
const ZapClient = require('zaproxy');

async function runSecurityScan() {
  const zap = new ZapClient({
    proxy: 'http://localhost:8080'
  });

  try {
    // Start ZAP daemon
    await zap.core.newSession();
    
    // Spider the application
    console.log('Starting spider scan...');
    const spiderScanId = await zap.spider.scan('http://localhost:3000');
    
    // Wait for spider to complete
    while (true) {
      const status = await zap.spider.status(spiderScanId);
      if (status === '100') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Run active security scan
    console.log('Starting active security scan...');
    const activeScanId = await zap.ascan.scan('http://localhost:3000');
    
    // Wait for active scan to complete
    while (true) {
      const status = await zap.ascan.status(activeScanId);
      if (status === '100') break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Generate report
    const htmlReport = await zap.core.htmlreport();
    require('fs').writeFileSync('security-report.html', htmlReport);
    
    // Get alerts
    const alerts = await zap.core.alerts('High');
    if (alerts.length > 0) {
      console.error(`Found ${alerts.length} high-priority security issues`);
      process.exit(1);
    }
    
    console.log('Security scan completed successfully');
  } catch (error) {
    console.error('Security scan failed:', error);
    process.exit(1);
  }
}

runSecurityScan();
```

### 6.2 Authentication Security Tests

```typescript
// packages/api/src/test/security/auth-security.test.ts
import request from 'supertest';
import { app } from '../../app';

describe('Authentication Security Tests', () => {
  describe('JWT Security', () => {
    it('should reject invalid JWT tokens', async () => {
      await request(app)
        .get('/api/sessions')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should reject expired JWT tokens', async () => {
      const expiredToken = jwt.sign(
        { userId: 1 },
        process.env.JWT_SECRET!,
        { expiresIn: '-1h' }
      );

      await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('should prevent JWT token manipulation', async () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
      const manipulatedToken = validToken.slice(0, -5) + 'XXXXX';

      await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${manipulatedToken}`)
        .expect(401);
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit authentication attempts', async () => {
      const loginData = { email: 'test@example.com', password: 'wrongpassword' };

      // Make 6 failed login attempts (limit is 5)
      for (let i = 0; i < 6; i++) {
        const response = await request(app)
          .post('/auth/login')
          .send(loginData);
        
        if (i < 5) {
          expect(response.status).toBe(401);
        } else {
          expect(response.status).toBe(429);
          expect(response.body.message).toContain('Too many attempts');
        }
      }
    });
  });

  describe('Input Validation Security', () => {
    it('should prevent SQL injection in email field', async () => {
      const maliciousData = {
        email: "'; DROP TABLE users; --",
        password: 'password123'
      };

      await request(app)
        .post('/auth/register')
        .send(maliciousData)
        .expect(400);
    });

    it('should prevent XSS in user input', async () => {
      const maliciousData = {
        project_input: '<script>alert("XSS")</script>'
      };

      const token = await getValidToken();
      
      await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send(maliciousData)
        .expect(400);
    });
  });
});
```

---

## 7. Test Data Management

### 7.1 Test Data Factory

```typescript
// packages/shared/src/test/factories.ts
import { faker } from '@faker-js/faker';

export class TestDataFactory {
  static createUser(overrides = {}) {
    return {
      email: faker.internet.email(),
      password: 'Password123!',
      created_at: new Date(),
      ...overrides
    };
  }

  static createPlanningSession(userId?: string, overrides = {}) {
    return {
      id: faker.string.uuid(),
      user_id: userId || faker.string.uuid(),
      project_input: faker.lorem.sentence(),
      status: 'ACTIVE',
      created_at: new Date(),
      session_data: {
        messages: [],
        current_agent: 'ANALYST'
      },
      ...overrides
    };
  }

  static createLLMResponse(overrides = {}) {
    return {
      content: faker.lorem.paragraphs(3),
      role: 'assistant',
      timestamp: new Date(),
      agent: 'ANALYST',
      ...overrides
    };
  }
}
```

### 7.2 Test Database Seeding

```typescript
// packages/api/src/test/seed.ts
import { PrismaClient } from '@prisma/client';
import { TestDataFactory } from '@shared/test/factories';

const prisma = new PrismaClient();

export async function seedTestDatabase() {
  // Clean existing data
  await prisma.planningSession.deleteMany();
  await prisma.user.deleteMany();

  // Create test users
  const testUsers = await Promise.all([
    prisma.user.create({ data: TestDataFactory.createUser({ email: 'admin@test.com' }) }),
    prisma.user.create({ data: TestDataFactory.createUser({ email: 'user@test.com' }) }),
    prisma.user.create({ data: TestDataFactory.createUser({ email: 'premium@test.com' }) })
  ]);

  // Create test sessions
  for (const user of testUsers) {
    await prisma.planningSession.create({
      data: TestDataFactory.createPlanningSession(user.id)
    });
  }

  console.log('Test database seeded successfully');
}

if (require.main === module) {
  seedTestDatabase()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
```

---

## 8. Continuous Integration Testing Pipeline

### 8.1 Complete CI/CD Test Pipeline

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      
      - name: Start test services
        run: |
          docker-compose -f docker-compose.test.yml up -d
          sleep 10
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint code
        run: npm run lint
      
      - name: Type check
        run: npm run type-check
      
      - name: Unit tests
        run: npm run test:unit -- --coverage
      
      - name: Integration tests
        run: npm run test:integration
      
      - name: Build applications
        run: npm run build
      
      - name: E2E tests
        run: npm run test:e2e
      
      - name: Security scan
        run: npm run test:security
      
      - name: Performance tests
        run: npm run test:performance
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
      
      - name: Cleanup
        if: always()
        run: docker-compose -f docker-compose.test.yml down

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - name: Deploy to Railway
        uses: bencox/railway-deploy@v1
        with:
          railway_token: ${{ secrets.RAILWAY_TOKEN }}
      
      - name: Run smoke tests
        run: npm run test:smoke -- --baseUrl=${{ secrets.PRODUCTION_URL }}
```

---

## 9. Test Reporting and Monitoring

### 9.1 Test Results Dashboard

```typescript
// packages/test-dashboard/src/reporter.ts
export class TestReporter {
  static async generateReport() {
    const results = {
      timestamp: new Date(),
      suite: 'BMAD Platform Tests',
      coverage: await this.getCoverageData(),
      performance: await this.getPerformanceMetrics(),
      security: await this.getSecurityResults(),
      e2e: await this.getE2EResults()
    };

    // Generate HTML report
    await this.generateHTMLReport(results);
    
    // Send to monitoring dashboard
    await this.sendToMonitoring(results);
    
    // Slack notification if failures
    if (results.failures > 0) {
      await this.sendSlackAlert(results);
    }
  }

  static async getCoverageData() {
    // Read coverage reports from all packages
    const coverage = {
      api: require('../packages/api/coverage/coverage-summary.json'),
      web: require('../packages/web/coverage/coverage-summary.json'),
      realtime: require('../packages/realtime/coverage/coverage-summary.json')
    };

    return coverage;
  }
}
```

### 9.2 Test Metrics Collection

```typescript
// packages/shared/src/test/metrics.ts
export class TestMetrics {
  static async recordTestRun(testType: string, duration: number, result: 'pass' | 'fail') {
    const metrics = {
      testType,
      duration,
      result,
      timestamp: new Date(),
      branch: process.env.GITHUB_REF,
      commit: process.env.GITHUB_SHA
    };

    // Store in time-series database (e.g., InfluxDB)
    await this.storeMetrics(metrics);
  }

  static async getTestTrends(days: number = 30) {
    // Query test metrics for trend analysis
    return await this.queryMetrics({
      from: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      to: new Date()
    });
  }
}
```

---

## 10. Quality Gates and Standards

### 10.1 Quality Gate Configuration

```typescript
// quality-gates.config.ts
export const qualityGates = {
  coverage: {
    minimum: 90, // 90% minimum coverage
    branches: 85,
    functions: 90,
    lines: 90,
    statements: 90
  },
  
  performance: {
    loadTime: 3000, // Max 3 seconds page load
    apiResponse: 500, // Max 500ms API response
    concurrent: 1000 // Support 1K concurrent users
  },
  
  security: {
    highSeverityIssues: 0, // Zero high-severity security issues
    mediumSeverityIssues: 5 // Max 5 medium-severity issues
  },
  
  e2e: {
    successRate: 95, // 95% E2E test success rate
    maxDuration: 1800 // Max 30 minutes for full E2E suite
  }
};

export function checkQualityGates(results: TestResults): boolean {
  const checks = [
    results.coverage.total >= qualityGates.coverage.minimum,
    results.performance.avgLoadTime <= qualityGates.performance.loadTime,
    results.security.highSeverity === qualityGates.security.highSeverityIssues,
    results.e2e.successRate >= qualityGates.e2e.successRate
  ];

  return checks.every(check => check);
}
```

### 10.2 Test Environment Health Checks

```bash
#!/bin/bash
# test-health-check.sh

echo "Checking test environment health..."

# Check test database connection
if ! pg_isready -h localhost -p 5432 -U test_user; then
  echo "❌ Test database not accessible"
  exit 1
fi

# Check test Redis connection  
if ! redis-cli -p 6379 ping | grep -q PONG; then
  echo "❌ Test Redis not accessible"
  exit 1
fi

# Check test services are running
if ! curl -f http://localhost:3001/api/health; then
  echo "❌ Test API service not responding"
  exit 1
fi

# Check WebSocket service
if ! curl -f http://localhost:3002/health; then
  echo "❌ Test WebSocket service not responding"
  exit 1
fi

# Check frontend service
if ! curl -f http://localhost:3000; then
  echo "❌ Test frontend service not responding"
  exit 1
fi

echo "✅ All test environment services healthy"
```

---

## 11. Performance Testing Standards

### 11.1 Performance Benchmarks

| Metric | Target | Critical Threshold | Measurement Method |
|--------|---------|-------------------|-------------------|
| **Page Load Time** | < 2s | < 3s | Lighthouse, Playwright |
| **API Response Time** | < 200ms | < 500ms | Artillery, k6 |
| **WebSocket Connection** | < 100ms | < 200ms | Custom WebSocket tests |
| **Database Query Time** | < 50ms | < 100ms | Prisma query logging |
| **Memory Usage** | < 512MB | < 1GB | Node.js memory monitoring |
| **CPU Usage** | < 70% | < 90% | System monitoring |
| **Concurrent Users** | 1,000 | 500 minimum | Load testing |

### 11.2 Performance Test Scripts

```bash
#!/bin/bash
# run-performance-tests.sh

echo "Running performance test suite..."

# API load testing
echo "Testing API endpoints..."
artillery run packages/load-tests/api-load.yml

# WebSocket load testing  
echo "Testing WebSocket performance..."
node packages/load-tests/websocket-load.js

# Database performance testing
echo "Testing database performance..."
npm run test:db-performance

# Frontend performance testing
echo "Testing frontend performance..."
npx lighthouse http://localhost:3000 --output=json --output-path=lighthouse-report.json

# Generate performance report
node packages/performance-tests/generate-report.js

echo "Performance tests completed"
```

---

**Testing Infrastructure Status:** Production Ready  
**Coverage Target:** >90% code coverage  
**Performance Target:** 1K concurrent users, <3s load time  
**Next Review:** 2025-10-08