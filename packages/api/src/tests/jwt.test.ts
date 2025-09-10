import { generateTokenPair, verifyAccessToken, refreshTokenPair, blacklistToken } from '../utils/jwt';
import { getConfig } from '../utils/config';
import { setCache, getCache, deleteCache } from '../utils/redis';

// Mock dependencies
jest.mock('../utils/config');
jest.mock('../utils/redis');
jest.mock('fs');

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockSetCache = setCache as jest.MockedFunction<typeof setCache>;
const mockGetCache = getCache as jest.MockedFunction<typeof getCache>;
const mockDeleteCache = deleteCache as jest.MockedFunction<typeof deleteCache>;

describe('JWT Utilities', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      NODE_ENV: 'test',
      PORT: 3001,
      LOG_LEVEL: 'error',
      JWT_SECRET: 'test-jwt-secret-key-for-testing-purposes-32-characters-minimum'
    } as any);

    mockSetCache.mockResolvedValue(undefined);
    mockGetCache.mockResolvedValue(null);
    mockDeleteCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateTokenPair', () => {
    it('should generate access and refresh tokens', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      const result = await generateTokenPair(payload);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should store refresh token in Redis', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      await generateTokenPair(payload);

      expect(mockSetCache).toHaveBeenCalledWith(
        expect.stringMatching(/^refresh:/),
        expect.stringContaining('test-user-id'),
        7 * 24 * 60 * 60
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify valid access token', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      const { accessToken } = await generateTokenPair(payload);
      const decoded = await verifyAccessToken(accessToken);

      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.subscriptionTier).toBe(payload.subscriptionTier);
    });

    it('should reject invalid token', async () => {
      await expect(verifyAccessToken('invalid-token'))
        .rejects.toThrow('Invalid or expired access token');
    });

    it('should reject blacklisted token', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      const { accessToken } = await generateTokenPair(payload);
      
      // Mock blacklisted token
      mockGetCache.mockResolvedValue('blacklisted');

      await expect(verifyAccessToken(accessToken))
        .rejects.toThrow('Invalid or expired access token');
    });
  });

  describe('refreshTokenPair', () => {
    it('should generate new token pair with valid refresh token', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      const { refreshToken } = await generateTokenPair(payload);
      
      // Mock valid refresh token in Redis
      mockGetCache.mockResolvedValue(JSON.stringify({
        userId: payload.userId,
        createdAt: new Date().toISOString()
      }));

      const newTokens = await refreshTokenPair(refreshToken, payload);

      expect(newTokens).toHaveProperty('accessToken');
      expect(newTokens).toHaveProperty('refreshToken');
      expect(newTokens.accessToken).not.toBe(refreshToken);
    });

    it('should reject invalid refresh token', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      await expect(refreshTokenPair('invalid-token', payload))
        .rejects.toThrow('Token refresh failed');
    });
  });

  describe('blacklistToken', () => {
    it('should add token to blacklist', async () => {
      const jti = 'test-jti';

      await blacklistToken(jti);

      expect(mockSetCache).toHaveBeenCalledWith(
        `blacklist:${jti}`,
        'blacklisted',
        15 * 60
      );

      expect(mockDeleteCache).toHaveBeenCalledWith(
        `refresh:${jti}`
      );
    });
  });

  describe('Token Expiration', () => {
    it('should generate tokens with proper expiration times', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      const { accessToken, refreshToken } = await generateTokenPair(payload);

      // Decode tokens to check expiration
      const jwt = require('jsonwebtoken');
      const accessDecoded = jwt.decode(accessToken);
      const refreshDecoded = jwt.decode(refreshToken);

      expect(accessDecoded.exp).toBeDefined();
      expect(refreshDecoded.exp).toBeDefined();

      // Access token should expire before refresh token
      expect(accessDecoded.exp).toBeLessThan(refreshDecoded.exp);
    });
  });

  describe('Token Types', () => {
    it('should include type field in tokens', async () => {
      const payload = {
        userId: 'test-user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE'
      };

      const { accessToken, refreshToken } = await generateTokenPair(payload);

      const jwt = require('jsonwebtoken');
      const accessDecoded = jwt.decode(accessToken);
      const refreshDecoded = jwt.decode(refreshToken);

      expect(accessDecoded.type).toBe('access');
      expect(refreshDecoded.type).toBe('refresh');
    });
  });
});