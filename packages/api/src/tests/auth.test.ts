import { generateToken, verifyToken, hashPassword, verifyPassword } from '../utils/auth';
import { getConfig } from '../utils/config';

jest.mock('../utils/config');

describe('Auth Utilities', () => {
  const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      NODE_ENV: 'test',
      PORT: 3001,
      LOG_LEVEL: 'error',
      JWT_SECRET: 'test-jwt-secret-key-for-testing-purposes-32-characters-minimum'
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('JWT Token Operations', () => {
    const testPayload = {
      userId: 'test-user-id',
      email: 'test@example.com',
      subscriptionTier: 'FREE'
    };

    it('should generate a valid JWT token', () => {
      const token = generateToken(testPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should verify a valid JWT token', () => {
      const token = generateToken(testPayload);
      const decoded = verifyToken(token);
      
      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.email).toBe(testPayload.email);
      expect(decoded.subscriptionTier).toBe(testPayload.subscriptionTier);
    });

    it('should throw error for invalid token', () => {
      expect(() => verifyToken('invalid-token')).toThrow('Invalid token');
    });

    it('should throw error when JWT_SECRET is missing', () => {
      mockGetConfig.mockReturnValue({
        NODE_ENV: 'test',
        PORT: 3001,
        LOG_LEVEL: 'error'
      } as any);

      expect(() => generateToken(testPayload)).toThrow('JWT_SECRET is required for token generation');
    });
  });

  describe('Password Operations', () => {
    const testPassword = 'TestPassword123!';

    it('should hash a password', async () => {
      const hashedPassword = await hashPassword(testPassword);
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(testPassword);
      expect(hashedPassword.length).toBeGreaterThan(50);
    });

    it('should verify correct password', async () => {
      const hashedPassword = await hashPassword(testPassword);
      const isValid = await verifyPassword(testPassword, hashedPassword);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hashedPassword = await hashPassword(testPassword);
      const isValid = await verifyPassword('wrongpassword', hashedPassword);
      expect(isValid).toBe(false);
    });
  });
});