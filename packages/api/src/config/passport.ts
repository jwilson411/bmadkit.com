import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { verifyPassword } from '../utils/auth';
import { verifyAccessToken } from '../utils/jwt';
import { getPrismaClient } from '../utils/database';
import { logger } from '../utils/logger';

const prisma = getPrismaClient();

// Local Strategy for username/password authentication
passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password',
  },
  async (email: string, password: string, done) => {
    try {
      logger.debug('Local authentication attempt', { email });

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          subscriptionTier: true,
          lastLogin: true,
          createdAt: true,
        },
      });

      if (!user) {
        logger.warn('Login attempt with non-existent email', { email });
        return done(null, false, { message: 'Invalid email or password' });
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.passwordHash);
      
      if (!isValidPassword) {
        logger.warn('Login attempt with invalid password', { email, userId: user.id });
        return done(null, false, { message: 'Invalid email or password' });
      }

      // Update last login timestamp
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      logger.info('User authenticated successfully via local strategy', { 
        userId: user.id, 
        email: user.email 
      });

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = user;
      return done(null, userWithoutPassword);

    } catch (error) {
      logger.error('Local authentication error', { error, email });
      return done(error);
    }
  }
));

// JWT Strategy for token-based authentication
passport.use(new JwtStrategy(
  {
    jwtFromRequest: ExtractJwt.fromExtractors([
      ExtractJwt.fromAuthHeaderAsBearerToken(),
      ExtractJwt.fromHeader('x-access-token'),
      (req) => {
        // Extract from cookies as fallback
        if (req && req.cookies) {
          return req.cookies['access-token'];
        }
        return null;
      },
    ]),
    secretOrKeyProvider: async (request, rawJwtToken, done) => {
      try {
        // This will be handled by our custom verification
        done(null, 'placeholder-secret');
      } catch (error) {
        done(error);
      }
    },
    algorithms: ['RS256', 'HS256'],
    passReqToCallback: true,
  },
  async (req: any, payload: any, done: any) => {
    try {
      // Extract the raw token from the request
      const token = ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromHeader('x-access-token'),
        (req) => req && req.cookies ? req.cookies['access-token'] : null,
      ])(req);

      if (!token) {
        return done(null, false, { message: 'No token provided' });
      }

      // Use our custom JWT verification
      const decoded = await verifyAccessToken(token);
      
      // Find user in database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          subscriptionTier: true,
          lastLogin: true,
          createdAt: true,
          preferences: true,
        },
      });

      if (!user) {
        logger.warn('JWT authentication failed: user not found', { userId: decoded.userId });
        return done(null, false, { message: 'User not found' });
      }

      logger.debug('User authenticated successfully via JWT strategy', { 
        userId: user.id, 
        email: user.email 
      });

      return done(null, user);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('JWT authentication failed', { error: errorMessage });
      return done(null, false, { message: 'Invalid or expired token' });
    }
  }
));

// Serialize user for session (not used in stateless JWT setup, but required by Passport)
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session (not used in stateless JWT setup, but required by Passport)
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        subscriptionTier: true,
        lastLogin: true,
        createdAt: true,
        preferences: true,
      },
    });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default passport;