import { Router } from 'express';
import * as authController from '../controllers/auth';
import { authenticateToken } from '../middleware/auth';
import { loginRateLimit, registrationRateLimit, passwordResetRateLimit } from '../middleware/rate-limit';
import { validateEmail, validatePassword, handleValidationErrors, validateContentType } from '../middleware/validation';

const router = Router();

// Apply JSON content type validation to all routes
router.use(validateContentType(['application/json']));

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', 
  registrationRateLimit,
  [
    validateEmail('email'),
    validatePassword('password'),
    handleValidationErrors,
  ],
  authController.register
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login',
  loginRateLimit,
  [
    validateEmail('email'),
    handleValidationErrors,
  ],
  authController.login
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public (but requires refresh token)
 */
router.post('/refresh',
  authController.refreshTokens
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user (blacklist access token)
 * @access  Private
 */
router.post('/logout',
  authenticateToken,
  authController.logout
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Initiate password reset
 * @access  Public
 */
router.post('/forgot-password',
  passwordResetRateLimit,
  [
    validateEmail('email'),
    handleValidationErrors,
  ],
  authController.forgotPassword
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Complete password reset
 * @access  Public (but requires reset token)
 */
router.post('/reset-password',
  [
    validatePassword('password'),
    handleValidationErrors,
  ],
  authController.resetPassword
);

/**
 * @route   GET /api/v1/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile',
  authenticateToken,
  authController.getProfile
);

/**
 * @route   PUT /api/v1/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile',
  authenticateToken,
  authController.updateProfile
);

/**
 * @route   GET /api/v1/auth/validate
 * @desc    Validate access token
 * @access  Private
 */
router.get('/validate',
  authenticateToken,
  authController.validateToken
);

export default router;