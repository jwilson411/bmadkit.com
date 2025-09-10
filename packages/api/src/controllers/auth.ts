import { Request, Response } from 'express';
import passport from '../config/passport';
import { AuthService } from '../services/auth';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';
import { ApiResponse } from '../middleware/error-handler';

// User registration
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Validate required fields
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Email and password are required',
          code: 'VALIDATION_ERROR',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const result = await AuthService.registerUser({
      email,
      password,
      firstName,
      lastName,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens,
        message: 'Registration successful',
      },
    };

    // Set secure cookie with refresh token
    res.cookie('refresh-token', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(201).json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Registration failed';
    
    logger.error('Registration controller error', {
      error,
      correlationId: req.headers['x-correlation-id'],
      body: { ...req.body, password: '[REDACTED]' },
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: errorMessage,
        code: 'REGISTRATION_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(400).json(response);
  }
};

// User login using Passport Local Strategy
export const login = async (req: Request, res: Response): Promise<void> => {
  passport.authenticate('local', async (err: any, user: any, info: any) => {
    if (err) {
      logger.error('Login authentication error', {
        error: err,
        correlationId: req.headers['x-correlation-id'],
      });

      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Authentication failed',
          code: 'AUTH_ERROR',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(500).json(response);
    }

    if (!user) {
      const message = info?.message || 'Invalid credentials';
      
      const response: ApiResponse = {
        success: false,
        error: {
          message,
          code: 'INVALID_CREDENTIALS',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(401).json(response);
    }

    try {
      // Generate tokens using our service
      const tokens = await AuthService.loginUser({
        email: user.email,
        password: req.body.password,
      });

      const response: ApiResponse = {
        success: true,
        data: {
          user: tokens.user,
          tokens: tokens.tokens,
          message: 'Login successful',
        },
      };

      // Set secure cookie with refresh token
      res.cookie('refresh-token', tokens.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json(response);

    } catch (serviceError) {
      logger.error('Login service error', {
        error: serviceError,
        userId: user.id,
        correlationId: req.headers['x-correlation-id'],
      });

      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Login failed',
          code: 'LOGIN_ERROR',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(500).json(response);
    }

  })(req, res);
};

// Refresh tokens
export const refreshTokens = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.['refresh-token'] || req.body.refreshToken;

    if (!refreshToken) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Refresh token required',
          code: 'MISSING_REFRESH_TOKEN',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(401).json(response);
    }

    const tokens = await AuthService.refreshTokens(refreshToken);

    const response: ApiResponse = {
      success: true,
      data: {
        tokens,
        message: 'Tokens refreshed successfully',
      },
    };

    // Update refresh token cookie
    res.cookie('refresh-token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.status(200).json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Token refresh failed';

    logger.error('Token refresh controller error', {
      error,
      correlationId: req.headers['x-correlation-id'],
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: errorMessage,
        code: 'TOKEN_REFRESH_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(401).json(response);
  }
};

// User logout
export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.split(' ')[1];

    if (accessToken) {
      await AuthService.logoutUser(accessToken);
    }

    // Clear refresh token cookie
    res.clearCookie('refresh-token');

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Logout successful',
      },
    };

    res.status(200).json(response);

  } catch (error) {
    logger.error('Logout controller error', {
      error,
      userId: req.user?.id,
      correlationId: req.headers['x-correlation-id'],
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: 'Logout failed',
        code: 'LOGOUT_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(500).json(response);
  }
};

// Initiate password reset
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Email is required',
          code: 'VALIDATION_ERROR',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(400).json(response);
    }

    await AuthService.initiatePasswordReset(email);

    // Always return success for security (prevent email enumeration)
    const response: ApiResponse = {
      success: true,
      data: {
        message: 'If an account with that email exists, a password reset link has been sent.',
      },
    };

    res.status(200).json(response);

  } catch (error) {
    logger.error('Password reset initiation error', {
      error,
      correlationId: req.headers['x-correlation-id'],
      body: req.body,
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: 'Password reset request failed',
        code: 'PASSWORD_RESET_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(500).json(response);
  }
};

// Complete password reset
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'Token and new password are required',
          code: 'VALIDATION_ERROR',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(400).json(response);
    }

    await AuthService.completePasswordReset(token, password);

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Password reset successful',
      },
    };

    res.status(200).json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Password reset failed';

    logger.error('Password reset completion error', {
      error,
      correlationId: req.headers['x-correlation-id'],
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: errorMessage,
        code: 'PASSWORD_RESET_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(400).json(response);
  }
};

// Get current user profile
export const getProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'User not authenticated',
          code: 'UNAUTHORIZED',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(401).json(response);
    }

    const user = await AuthService.getUserById(req.user.id);

    if (!user) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'User not found',
          code: 'USER_NOT_FOUND',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(404).json(response);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        user,
      },
    };

    res.status(200).json(response);

  } catch (error) {
    logger.error('Get profile controller error', {
      error,
      userId: req.user?.id,
      correlationId: req.headers['x-correlation-id'],
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: 'Failed to get profile',
        code: 'PROFILE_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(500).json(response);
  }
};

// Update user profile
export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: {
          message: 'User not authenticated',
          code: 'UNAUTHORIZED',
          correlationId: req.headers['x-correlation-id'] as string,
          timestamp: new Date().toISOString(),
        },
      };

      return res.status(401).json(response);
    }

    const { preferences } = req.body;

    const updatedUser = await AuthService.updateUserProfile(req.user.id, {
      preferences: preferences ? JSON.stringify(preferences) : undefined,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        user: updatedUser,
        message: 'Profile updated successfully',
      },
    };

    res.status(200).json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Profile update failed';

    logger.error('Update profile controller error', {
      error,
      userId: req.user?.id,
      correlationId: req.headers['x-correlation-id'],
    });

    const response: ApiResponse = {
      success: false,
      error: {
        message: errorMessage,
        code: 'PROFILE_UPDATE_ERROR',
        correlationId: req.headers['x-correlation-id'] as string,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(500).json(response);
  }
};

// Validate token (middleware endpoint)
export const validateToken = (req: AuthenticatedRequest, res: Response): void => {
  // If we reach here, the token is valid (middleware passed)
  const response: ApiResponse = {
    success: true,
    data: {
      user: req.user,
      message: 'Token is valid',
    },
  };

  res.status(200).json(response);
};