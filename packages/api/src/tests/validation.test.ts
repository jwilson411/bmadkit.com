import request from 'supertest';
import express from 'express';
import { validateEmail, validatePassword, handleValidationErrors } from '../middleware/validation';

describe('Validation Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('Email Validation', () => {
    beforeEach(() => {
      app.post('/test-email', [
        validateEmail('email'),
        handleValidationErrors
      ], (req: express.Request, res: express.Response) => {
        res.json({ success: true });
      });
    });

    it('should accept valid email addresses', async () => {
      await request(app)
        .post('/test-email')
        .send({ email: 'test@example.com' })
        .expect(200);
    });

    it('should reject invalid email addresses', async () => {
      const response = await request(app)
        .post('/test-email')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should normalize email addresses', async () => {
      await request(app)
        .post('/test-email')
        .send({ email: 'Test@EXAMPLE.COM' })
        .expect(200);
    });
  });

  describe('Password Validation', () => {
    beforeEach(() => {
      app.post('/test-password', [
        validatePassword('password'),
        handleValidationErrors
      ], (req: express.Request, res: express.Response) => {
        res.json({ success: true });
      });
    });

    it('should accept strong passwords', async () => {
      await request(app)
        .post('/test-password')
        .send({ password: 'StrongPass123!' })
        .expect(200);
    });

    it('should reject weak passwords', async () => {
      const response = await request(app)
        .post('/test-password')
        .send({ password: 'weak' })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password'
          })
        ])
      );
    });

    it('should reject passwords without special characters', async () => {
      const response = await request(app)
        .post('/test-password')
        .send({ password: 'NoSpecialChar123' })
        .expect(400);

      expect(response.body.error.details[0]).toHaveProperty('field', 'password');
    });
  });

  describe('Multiple Validation Errors', () => {
    beforeEach(() => {
      app.post('/test-multiple', [
        validateEmail('email'),
        validatePassword('password'),
        handleValidationErrors
      ], (req: express.Request, res: express.Response) => {
        res.json({ success: true });
      });
    });

    it('should return all validation errors', async () => {
      const response = await request(app)
        .post('/test-multiple')
        .send({ 
          email: 'invalid-email',
          password: 'weak' 
        })
        .expect(400);

      expect(response.body.error.details.length).toBeGreaterThanOrEqual(2);
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'password' })
        ])
      );
    });
  });
});