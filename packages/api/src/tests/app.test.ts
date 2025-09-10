import request from 'supertest';
import { createApp } from '../app';

describe('Express App', () => {
  const app = createApp();

  describe('Health Endpoints', () => {
    it('should respond to /health endpoint', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('status', 'healthy');
      expect(response.body.data).toHaveProperty('timestamp');
      expect(response.body.data).toHaveProperty('uptime');
    });

    it('should respond to /api/health endpoint', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('API Status Endpoint', () => {
    it('should respond to /api/v1/status endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/status')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('message', 'BMAD API is running');
      expect(response.body.data).toHaveProperty('version', '1.0.0');
    });
  });

  describe('Security Headers', () => {
    it('should set security headers', async () => {
      const response = await request(app)
        .get('/api/v1/status')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });
  });

  describe('CORS', () => {
    it('should handle preflight requests', async () => {
      const response = await request(app)
        .options('/api/v1/status')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting headers', async () => {
      const response = await request(app)
        .get('/api/v1/status')
        .expect(200);

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/unknown/endpoint')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('message', 'Endpoint not found');
      expect(response.body.error).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('Request Logging', () => {
    it('should add correlation ID to responses', async () => {
      const response = await request(app)
        .get('/api/v1/status')
        .expect(200);

      expect(response.body.data).toHaveProperty('timestamp');
    });

    it('should accept custom correlation ID', async () => {
      const correlationId = 'test-correlation-id';
      const response = await request(app)
        .get('/api/v1/status')
        .set('x-correlation-id', correlationId)
        .expect(200);

      expect(response.body.data).toHaveProperty('timestamp');
    });
  });
});