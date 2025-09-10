import { getConfig } from './config';
import { connectDatabase, testDatabaseConnection } from './database';
import { connectRedis, testRedisConnection } from './redis';
import { logger } from './logger';

export interface StartupCheck {
  name: string;
  check: () => Promise<boolean>;
  required: boolean;
}

export const performStartupChecks = async (): Promise<void> => {
  logger.info('Starting BMAD API startup checks...');

  const config = getConfig();
  
  const checks: StartupCheck[] = [
    {
      name: 'Configuration validation',
      check: async () => {
        try {
          getConfig();
          return true;
        } catch (error) {
          logger.error('Configuration validation failed', { error });
          return false;
        }
      },
      required: true,
    },
    {
      name: 'Database connection',
      check: async () => {
        if (!config.DATABASE_URL) {
          logger.warn('DATABASE_URL not configured, skipping database check');
          return true;
        }
        try {
          await connectDatabase();
          return await testDatabaseConnection();
        } catch (error) {
          logger.error('Database connection check failed', { error });
          return false;
        }
      },
      required: false,
    },
    {
      name: 'Redis connection',
      check: async () => {
        if (!config.REDIS_URL) {
          logger.warn('REDIS_URL not configured, skipping Redis check');
          return true;
        }
        try {
          await connectRedis();
          return await testRedisConnection();
        } catch (error) {
          logger.error('Redis connection check failed', { error });
          return false;
        }
      },
      required: false,
    },
  ];

  const results = await Promise.allSettled(
    checks.map(async (check) => ({
      name: check.name,
      success: await check.check(),
      required: check.required,
    }))
  );

  let hasRequiredFailures = false;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const { name, success, required } = result.value;
      if (success) {
        logger.info(`✅ ${name} passed`);
      } else {
        const level = required ? 'error' : 'warn';
        logger[level](`❌ ${name} failed`);
        if (required) {
          hasRequiredFailures = true;
        }
      }
    } else {
      const check = checks[index];
      logger.error(`💥 ${check.name} crashed`, { error: result.reason });
      if (check.required) {
        hasRequiredFailures = true;
      }
    }
  });

  if (hasRequiredFailures) {
    throw new Error('Required startup checks failed. Cannot continue.');
  }

  logger.info('🎉 BMAD API startup checks completed successfully');
};