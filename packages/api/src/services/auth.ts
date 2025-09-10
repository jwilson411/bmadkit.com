import { getPrismaClient } from '../utils/database';
import { hashPassword, verifyPassword } from '../utils/auth';
import { generateTokenPair, refreshTokenPair, blacklistToken } from '../utils/jwt';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/email';
import { setCache, getCache, deleteCache } from '../utils/redis';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { trackFailedLogin, clearFailedLogin, checkAccountLock } from '../middleware/rate-limit';

const prisma = getPrismaClient();

export interface RegisterUserData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface UserResponse {
  id: string;
  email: string;
  subscriptionTier: string;
  createdAt: Date;
  lastLogin?: Date | null;
  preferences?: any;
}

export interface AuthResponse {
  user: UserResponse;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

export class AuthService {
  // User registration
  static async registerUser(userData: RegisterUserData): Promise<AuthResponse> {
    const { email, password, firstName, lastName } = userData;
    
    try {
      logger.info('User registration attempt', { email });

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        logger.warn('Registration attempt with existing email', { email });
        throw new Error('User with this email already exists');
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user
      const newUser = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          subscriptionTier: 'FREE',
          preferences: JSON.stringify({
            firstName,
            lastName,
            emailNotifications: true,
            marketingEmails: false,
          }),
        },
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
          createdAt: true,
          lastLogin: true,
          preferences: true,
        },
      });

      // Generate token pair
      const tokens = await generateTokenPair({
        userId: newUser.id,
        email: newUser.email,
        subscriptionTier: newUser.subscriptionTier,
      });

      // Send welcome email
      try {
        await sendWelcomeEmail(newUser.email, firstName);
      } catch (emailError) {
        logger.warn('Failed to send welcome email', { 
          error: emailError, 
          userId: newUser.id 
        });
        // Don't fail registration if email fails
      }

      logger.info('User registered successfully', { 
        userId: newUser.id, 
        email: newUser.email 
      });

      return {
        user: newUser,
        tokens,
      };

    } catch (error) {
      logger.error('User registration failed', { error, email });
      throw error;
    }
  }

  // User login
  static async loginUser(credentials: LoginCredentials): Promise<AuthResponse> {
    const { email, password } = credentials;
    
    try {
      logger.info('User login attempt', { email });

      // Check if account is temporarily locked
      const isLocked = await checkAccountLock(email);
      if (isLocked) {
        logger.warn('Login attempt on locked account', { email });
        throw new Error('Account temporarily locked due to multiple failed attempts');
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          subscriptionTier: true,
          createdAt: true,
          lastLogin: true,
          preferences: true,
        },
      });

      if (!user) {
        await trackFailedLogin(email);
        logger.warn('Login attempt with non-existent email', { email });
        throw new Error('Invalid email or password');
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.passwordHash);
      
      if (!isValidPassword) {
        await trackFailedLogin(email);
        logger.warn('Login attempt with invalid password', { email, userId: user.id });
        throw new Error('Invalid email or password');
      }

      // Clear failed login attempts
      await clearFailedLogin(email);

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      // Generate token pair
      const tokens = await generateTokenPair({
        userId: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier,
      });

      logger.info('User logged in successfully', { 
        userId: user.id, 
        email: user.email 
      });

      // Remove password hash from response
      const { passwordHash, ...userResponse } = user;

      return {
        user: userResponse,
        tokens,
      };

    } catch (error) {
      logger.error('User login failed', { error, email });
      throw error;
    }
  }

  // Refresh token
  static async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      logger.debug('Token refresh attempt');

      // This requires getting user data for the new token
      // The refreshTokenPair function will handle the verification
      // We need to extract user info from the refresh token first
      const decoded = require('jsonwebtoken').decode(refreshToken) as any;
      
      if (!decoded || !decoded.userId) {
        throw new Error('Invalid refresh token');
      }

      // Get user data
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Generate new token pair
      const tokens = await refreshTokenPair(refreshToken, {
        userId: user.id,
        email: user.email,
        subscriptionTier: user.subscriptionTier,
      });

      logger.info('Tokens refreshed successfully', { userId: user.id });

      return tokens;

    } catch (error) {
      logger.error('Token refresh failed', { error });
      throw new Error('Token refresh failed');
    }
  }

  // Logout user
  static async logoutUser(accessToken: string): Promise<void> {
    try {
      // Extract JWT ID for blacklisting
      const decoded = require('jsonwebtoken').decode(accessToken) as any;
      
      if (decoded && decoded.jti) {
        await blacklistToken(decoded.jti);
        logger.info('User logged out successfully', { 
          userId: decoded.userId,
          jti: decoded.jti 
        });
      }

    } catch (error) {
      logger.error('Logout failed', { error });
      throw new Error('Logout failed');
    }
  }

  // Initiate password reset
  static async initiatePasswordReset(email: string): Promise<void> {
    try {
      logger.info('Password reset initiated', { email });

      // Check if user exists (but don't reveal this information)
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { id: true, email: true },
      });

      if (user) {
        // Generate reset token
        const resetToken = uuidv4();
        const resetKey = `password-reset:${resetToken}`;
        
        // Store reset token in Redis with 15 minute expiration
        await setCache(resetKey, JSON.stringify({
          userId: user.id,
          email: user.email,
          createdAt: new Date().toISOString(),
        }), 15 * 60); // 15 minutes

        // Create reset link (this would be the frontend URL in production)
        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

        // Send password reset email
        await sendPasswordResetEmail(user.email, resetToken, resetLink);

        logger.info('Password reset email sent', { userId: user.id });
      } else {
        logger.warn('Password reset requested for non-existent email', { email });
        // Still pretend we sent an email for security
      }

      // Always return success to prevent email enumeration
    } catch (error) {
      logger.error('Password reset initiation failed', { error, email });
      throw new Error('Password reset initiation failed');
    }
  }

  // Complete password reset
  static async completePasswordReset(token: string, newPassword: string): Promise<void> {
    try {
      logger.info('Password reset completion attempt', { token });

      const resetKey = `password-reset:${token}`;
      const resetData = await getCache(resetKey);

      if (!resetData) {
        logger.warn('Invalid or expired password reset token', { token });
        throw new Error('Invalid or expired reset token');
      }

      const { userId } = JSON.parse(resetData);

      // Hash new password
      const passwordHash = await hashPassword(newPassword);

      // Update user password
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      });

      // Clear reset token
      await deleteCache(resetKey);

      // Clear any failed login attempts
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      
      if (user) {
        await clearFailedLogin(user.email);
      }

      logger.info('Password reset completed successfully', { userId });

    } catch (error) {
      logger.error('Password reset completion failed', { error, token });
      throw error;
    }
  }

  // Get user by ID
  static async getUserById(userId: string): Promise<UserResponse | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
          createdAt: true,
          lastLogin: true,
          preferences: true,
        },
      });

      return user;

    } catch (error) {
      logger.error('Failed to get user by ID', { error, userId });
      return null;
    }
  }

  // Update user profile
  static async updateUserProfile(userId: string, updates: Partial<{ preferences: any }>): Promise<UserResponse | null> {
    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updates,
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
          createdAt: true,
          lastLogin: true,
          preferences: true,
        },
      });

      logger.info('User profile updated', { userId });

      return updatedUser;

    } catch (error) {
      logger.error('Failed to update user profile', { error, userId });
      throw new Error('Profile update failed');
    }
  }
}