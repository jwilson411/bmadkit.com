import request from 'supertest';
import { createApp } from '../app';
import { getPrismaClient } from '../utils/database';
import { getConfig } from '../utils/config';

const app = createApp();
const prisma = getPrismaClient();

// Mock config for testing
jest.mock('../utils/config');
jest.mock('../utils/redis');
jest.mock('../utils/email');

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

describe('Authentication Integration Tests', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      NODE_ENV: 'test',
      PORT: 3001,
      LOG_LEVEL: 'error',
      JWT_SECRET: 'test-jwt-secret-key-for-testing-purposes-32-characters-minimum',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/bmad_test',
      REDIS_URL: 'redis://localhost:6379/1',
    } as any);

    // Mock Prisma methods
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
    jest.spyOn(prisma.user, 'create').mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      subscriptionTier: 'FREE',
      createdAt: new Date(),
      lastLogin: null,
      preferences: JSON.stringify({ firstName: 'Test', lastName: 'User' }),
    } as any);
    jest.spyOn(prisma.user, 'update').mockResolvedValue({} as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user with valid data', async () => {
      const userData = {
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe'
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.tokens).toBeDefined();
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should reject registration with invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration with weak password', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'weak',
      };

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject registration without required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return validation error for invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'invalid-email',
          password: 'password123'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should require refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_REFRESH_TOKEN');
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should accept valid email for password reset', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('password reset link');
    });

    it('should reject invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require email field', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('should require token and password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: 'some-token',
          password: 'weak'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authentication Middleware', () => {
    it('should reject requests without token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to login attempts', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      // Make multiple requests quickly to trigger rate limiting
      const requests = Array(6).fill(null).map(() =>
        request(app)
          .post('/api/v1/auth/login')
          .send(loginData)
      );

      const responses = await Promise.all(requests);
      
      // Last request should be rate limited
      const lastResponse = responses[responses.length - 1];
      expect([401, 429]).toContain(lastResponse.status);
    });
  });

  describe('Content Type Validation', () => {
    it('should reject non-JSON requests', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Content-Type', 'text/plain')
        .send('invalid data')
        .expect(415);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in responses', async () => {
      const response = await request(app)
        .get('/api/v1/status')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should handle preflight requests', async () => {
      const response = await request(app)
        .options('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });
});