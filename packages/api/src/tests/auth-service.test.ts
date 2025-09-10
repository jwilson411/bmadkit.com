import { AuthService } from '../services/auth';
import { getPrismaClient } from '../utils/database';
import { hashPassword, verifyPassword } from '../utils/auth';
import { generateTokenPair } from '../utils/jwt';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/email';
import { setCache, getCache, deleteCache } from '../utils/redis';

// Mock all dependencies
jest.mock('../utils/database');
jest.mock('../utils/auth');
jest.mock('../utils/jwt');
jest.mock('../utils/email');
jest.mock('../utils/redis');
jest.mock('../middleware/rate-limit');

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

(getPrismaClient as jest.Mock).mockReturnValue(mockPrisma);

const mockHashPassword = hashPassword as jest.MockedFunction<typeof hashPassword>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockGenerateTokenPair = generateTokenPair as jest.MockedFunction<typeof generateTokenPair>;
const mockSendWelcomeEmail = sendWelcomeEmail as jest.MockedFunction<typeof sendWelcomeEmail>;
const mockSendPasswordResetEmail = sendPasswordResetEmail as jest.MockedFunction<typeof sendPasswordResetEmail>;
const mockSetCache = setCache as jest.MockedFunction<typeof setCache>;
const mockGetCache = getCache as jest.MockedFunction<typeof getCache>;
const mockDeleteCache = deleteCache as jest.MockedFunction<typeof deleteCache>;

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerUser', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe'
      };

      // Mock dependencies
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockHashPassword.mockResolvedValue('hashed-password');
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE',
        createdAt: new Date(),
        lastLogin: null,
        preferences: JSON.stringify({ firstName: 'John', lastName: 'Doe' })
      });
      mockGenerateTokenPair.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      });
      mockSendWelcomeEmail.mockResolvedValue(undefined);

      const result = await AuthService.registerUser(userData);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens.accessToken).toBe('access-token');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' }
      });
      expect(mockHashPassword).toHaveBeenCalledWith('SecurePassword123!');
      expect(mockSendWelcomeEmail).toHaveBeenCalledWith('test@example.com', 'John');
    });

    it('should reject registration for existing email', async () => {
      const userData = {
        email: 'existing@example.com',
        password: 'SecurePassword123!'
      };

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        email: 'existing@example.com'
      });

      await expect(AuthService.registerUser(userData))
        .rejects.toThrow('User with this email already exists');
    });

    it('should not fail registration if welcome email fails', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePassword123!'
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockHashPassword.mockResolvedValue('hashed-password');
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE',
        createdAt: new Date(),
        lastLogin: null,
        preferences: '{}'
      });
      mockGenerateTokenPair.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      });
      mockSendWelcomeEmail.mockRejectedValue(new Error('Email service error'));

      const result = await AuthService.registerUser(userData);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
    });
  });

  describe('loginUser', () => {
    it('should login user with valid credentials', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'SecurePassword123!'
      };

      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        subscriptionTier: 'FREE',
        createdAt: new Date(),
        lastLogin: null,
        preferences: '{}'
      };

      // Mock rate limiting
      const { checkAccountLock, clearFailedLogin } = require('../middleware/rate-limit');
      checkAccountLock.mockResolvedValue(false);
      clearFailedLogin.mockResolvedValue(undefined);

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockVerifyPassword.mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockGenerateTokenPair.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      });

      const result = await AuthService.loginUser(credentials);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(result.user.email).toBe('test@example.com');
      expect(mockVerifyPassword).toHaveBeenCalledWith('SecurePassword123!', 'hashed-password');
    });

    it('should reject login with invalid password', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'WrongPassword'
      };

      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password'
      };

      const { checkAccountLock, trackFailedLogin } = require('../middleware/rate-limit');
      checkAccountLock.mockResolvedValue(false);
      trackFailedLogin.mockResolvedValue(undefined);

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockVerifyPassword.mockResolvedValue(false);

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Invalid email or password');

      expect(trackFailedLogin).toHaveBeenCalledWith('test@example.com');
    });

    it('should reject login for non-existent user', async () => {
      const credentials = {
        email: 'nonexistent@example.com',
        password: 'password'
      };

      const { checkAccountLock, trackFailedLogin } = require('../middleware/rate-limit');
      checkAccountLock.mockResolvedValue(false);
      trackFailedLogin.mockResolvedValue(undefined);

      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Invalid email or password');

      expect(trackFailedLogin).toHaveBeenCalledWith('nonexistent@example.com');
    });

    it('should reject login for locked account', async () => {
      const credentials = {
        email: 'locked@example.com',
        password: 'password'
      };

      const { checkAccountLock } = require('../middleware/rate-limit');
      checkAccountLock.mockResolvedValue(true);

      await expect(AuthService.loginUser(credentials))
        .rejects.toThrow('Account temporarily locked due to multiple failed attempts');
    });
  });

  describe('initiatePasswordReset', () => {
    it('should initiate password reset for existing user', async () => {
      const email = 'test@example.com';

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com'
      });
      mockSetCache.mockResolvedValue(undefined);
      mockSendPasswordResetEmail.mockResolvedValue(undefined);

      await AuthService.initiatePasswordReset(email);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' }
      });
      expect(mockSetCache).toHaveBeenCalledWith(
        expect.stringMatching(/^password-reset:/),
        expect.stringContaining('user-id'),
        15 * 60
      );
      expect(mockSendPasswordResetEmail).toHaveBeenCalled();
    });

    it('should not reveal if user does not exist', async () => {
      const email = 'nonexistent@example.com';

      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Should not throw error
      await expect(AuthService.initiatePasswordReset(email))
        .resolves.toBeUndefined();

      expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('completePasswordReset', () => {
    it('should reset password with valid token', async () => {
      const token = 'reset-token';
      const newPassword = 'NewPassword123!';

      mockGetCache.mockResolvedValue(JSON.stringify({
        userId: 'user-id',
        email: 'test@example.com'
      }));
      mockHashPassword.mockResolvedValue('new-hashed-password');
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'test@example.com'
      });
      mockDeleteCache.mockResolvedValue(undefined);

      const { clearFailedLogin } = require('../middleware/rate-limit');
      clearFailedLogin.mockResolvedValue(undefined);

      await AuthService.completePasswordReset(token, newPassword);

      expect(mockGetCache).toHaveBeenCalledWith('password-reset:reset-token');
      expect(mockHashPassword).toHaveBeenCalledWith(newPassword);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { passwordHash: 'new-hashed-password' }
      });
      expect(mockDeleteCache).toHaveBeenCalledWith('password-reset:reset-token');
    });

    it('should reject invalid or expired token', async () => {
      const token = 'invalid-token';
      const newPassword = 'NewPassword123!';

      mockGetCache.mockResolvedValue(null);

      await expect(AuthService.completePasswordReset(token, newPassword))
        .rejects.toThrow('Invalid or expired reset token');
    });
  });

  describe('getUserById', () => {
    it('should return user by ID', async () => {
      const userId = 'user-id';
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        subscriptionTier: 'FREE',
        createdAt: new Date(),
        lastLogin: null,
        preferences: '{}'
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await AuthService.getUserById(userId);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: expect.any(Object)
      });
    });

    it('should return null for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await AuthService.getUserById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateUserProfile', () => {
    it('should update user profile', async () => {
      const userId = 'user-id';
      const updates = {
        preferences: { theme: 'dark' }
      };

      const updatedUser = {
        id: 'user-id',
        email: 'test@example.com',
        preferences: JSON.stringify({ theme: 'dark' })
      };

      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await AuthService.updateUserProfile(userId, updates);

      expect(result).toEqual(updatedUser);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: updates,
        select: expect.any(Object)
      });
    });
  });
});