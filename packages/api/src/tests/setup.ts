import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/bmad_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-32-characters-minimum';
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_USER = 'test@test.com';
process.env.SMTP_PASSWORD = 'test-password';
process.env.EMAIL_FROM = 'noreply@test.com';

// Mock environment before any imports
process.env.LOG_LEVEL = 'error';