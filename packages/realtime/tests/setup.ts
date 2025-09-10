import { jest } from '@jest/globals';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-jest';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Suppress console.log during tests unless LOG_LEVEL=debug
if (process.env.LOG_LEVEL !== 'debug') {
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
}

// Global test cleanup
afterAll(async () => {
  // Give time for connections to close
  await new Promise(resolve => setTimeout(resolve, 1000));
});