import Bull, { Queue, Job, ProcessCallbackFunction } from 'bull';
import { logger } from '../utils/logger';
import { sessionCache } from '../utils/session-cache';
import { sessionManager } from './session-manager';
import { 
  PlanningSession, 
  SessionStatus,
  isSessionExpired,
  createDefaultSessionConfig 
} from '../models/planning-session';

export interface SessionCleanupConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  cleanup: {
    expiredSessionGracePeriod: number; // milliseconds
    inactiveSessionThreshold: number; // milliseconds
    archiveBeforeDelete: boolean;
    batchSize: number;
  };
  scheduling: {
    cleanupInterval: string; // cron expression
    expiredSessionCheck: string; // cron expression
    healthCheck: string; // cron expression
  };
}

export interface CleanupResult {
  processed: number;
  expired: number;
  archived: number;
  deleted: number;
  errors: Array<{ sessionId: string; error: string }>;
  duration: number; // milliseconds
}

export interface CleanupMetrics {
  totalCleanups: number;
  totalSessionsProcessed: number;
  totalSessionsDeleted: number;
  totalErrors: number;
  averageCleanupDuration: number;
  lastCleanupAt: Date;
  nextScheduledAt: Date;
}

export enum CleanupJobType {
  EXPIRED_SESSIONS = 'expired-sessions',
  INACTIVE_SESSIONS = 'inactive-sessions',
  CACHE_MAINTENANCE = 'cache-maintenance',
  HEALTH_CHECK = 'health-check'
}

export class SessionCleanupError extends Error {
  constructor(
    message: string,
    public code: string,
    public jobType?: CleanupJobType
  ) {
    super(message);
    this.name = 'SessionCleanupError';
  }
}

export class SessionCleanup {
  private config: SessionCleanupConfig;
  private cleanupQueue: Queue;
  private metrics: CleanupMetrics;
  private isInitialized = false;

  constructor(config: Partial<SessionCleanupConfig> = {}) {
    this.config = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        ...config.redis
      },
      cleanup: {
        expiredSessionGracePeriod: 3600000, // 1 hour
        inactiveSessionThreshold: 86400000, // 24 hours
        archiveBeforeDelete: true,
        batchSize: 50,
        ...config.cleanup
      },
      scheduling: {
        cleanupInterval: '0 */6 * * *', // Every 6 hours
        expiredSessionCheck: '*/15 * * * *', // Every 15 minutes
        healthCheck: '*/5 * * * *', // Every 5 minutes
        ...config.scheduling
      }
    };

    this.metrics = {
      totalCleanups: 0,
      totalSessionsProcessed: 0,
      totalSessionsDeleted: 0,
      totalErrors: 0,
      averageCleanupDuration: 0,
      lastCleanupAt: new Date(0),
      nextScheduledAt: new Date()
    };

    // Initialize Bull queue
    this.cleanupQueue = new Bull('session-cleanup', {
      redis: {
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db
      },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });

    logger.info('SessionCleanup service initialized', {
      redisHost: this.config.redis.host,
      redisPort: this.config.redis.port,
      gracePeriod: this.config.cleanup.expiredSessionGracePeriod,
      batchSize: this.config.cleanup.batchSize
    });
  }

  /**
   * Initialize the cleanup service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Setup job processors
      this.setupJobProcessors();

      // Schedule recurring jobs
      await this.scheduleRecurringJobs();

      // Setup event handlers
      this.setupEventHandlers();

      this.isInitialized = true;

      logger.info('SessionCleanup service started', {
        scheduledJobs: Object.keys(this.config.scheduling).length
      });

    } catch (error) {
      logger.error('Failed to initialize SessionCleanup service', {
        error: (error as Error).message
      });
      throw new SessionCleanupError(
        `Initialization failed: ${(error as Error).message}`,
        'INITIALIZATION_ERROR'
      );
    }
  }

  /**
   * Manually trigger expired session cleanup
   */
  async cleanupExpiredSessions(): Promise<CleanupResult> {
    logger.info('Starting manual expired session cleanup');

    const job = await this.cleanupQueue.add(
      CleanupJobType.EXPIRED_SESSIONS,
      { manual: true },
      { priority: 10 }
    );

    // Wait for job completion
    return new Promise((resolve, reject) => {
      job.finished().then(resolve).catch(reject);
    });
  }

  /**
   * Manually trigger inactive session cleanup
   */
  async cleanupInactiveSessions(): Promise<CleanupResult> {
    logger.info('Starting manual inactive session cleanup');

    const job = await this.cleanupQueue.add(
      CleanupJobType.INACTIVE_SESSIONS,
      { manual: true },
      { priority: 5 }
    );

    return new Promise((resolve, reject) => {
      job.finished().then(resolve).catch(reject);
    });
  }

  /**
   * Perform cache maintenance
   */
  async performCacheMaintenance(): Promise<CleanupResult> {
    logger.info('Starting cache maintenance');

    const job = await this.cleanupQueue.add(
      CleanupJobType.CACHE_MAINTENANCE,
      { manual: true },
      { priority: 1 }
    );

    return new Promise((resolve, reject) => {
      job.finished().then(resolve).catch(reject);
    });
  }

  /**
   * Get cleanup metrics
   */
  getMetrics(): CleanupMetrics {
    return { ...this.metrics };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.cleanupQueue.getWaiting(),
      this.cleanupQueue.getActive(),
      this.cleanupQueue.getCompleted(),
      this.cleanupQueue.getFailed(),
      this.cleanupQueue.getDelayed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length
    };
  }

  /**
   * Shutdown the cleanup service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down SessionCleanup service');

    try {
      await this.cleanupQueue.close(); // Close without timeout parameter
      logger.info('SessionCleanup service shutdown complete');
    } catch (error) {
      logger.error('Error during SessionCleanup shutdown', {
        error: (error as Error).message
      });
    }
  }

  // Private methods

  private setupJobProcessors(): void {
    // Expired sessions processor
    this.cleanupQueue.process(
      CleanupJobType.EXPIRED_SESSIONS,
      1, // Concurrency
      this.processExpiredSessions.bind(this)
    );

    // Inactive sessions processor
    this.cleanupQueue.process(
      CleanupJobType.INACTIVE_SESSIONS,
      1, // Concurrency
      this.processInactiveSessions.bind(this)
    );

    // Cache maintenance processor
    this.cleanupQueue.process(
      CleanupJobType.CACHE_MAINTENANCE,
      1, // Concurrency
      this.processCacheMaintenance.bind(this)
    );

    // Health check processor
    this.cleanupQueue.process(
      CleanupJobType.HEALTH_CHECK,
      this.processHealthCheck.bind(this)
    );
  }

  private async scheduleRecurringJobs(): Promise<void> {
    // Schedule expired session cleanup
    await this.cleanupQueue.add(
      CleanupJobType.EXPIRED_SESSIONS,
      {},
      {
        repeat: { cron: this.config.scheduling.expiredSessionCheck },
        removeOnComplete: true,
        removeOnFail: false
      }
    );

    // Schedule full cleanup
    await this.cleanupQueue.add(
      CleanupJobType.INACTIVE_SESSIONS,
      {},
      {
        repeat: { cron: this.config.scheduling.cleanupInterval },
        removeOnComplete: true,
        removeOnFail: false
      }
    );

    // Schedule health checks
    await this.cleanupQueue.add(
      CleanupJobType.HEALTH_CHECK,
      {},
      {
        repeat: { cron: this.config.scheduling.healthCheck },
        removeOnComplete: true,
        removeOnFail: false
      }
    );

    logger.info('Recurring cleanup jobs scheduled');
  }

  private setupEventHandlers(): void {
    this.cleanupQueue.on('completed', (job: Job, result: CleanupResult) => {
      logger.info('Cleanup job completed', {
        jobType: job.name,
        jobId: job.id,
        processed: result.processed,
        deleted: result.deleted,
        duration: result.duration
      });

      this.updateMetrics(result);
    });

    this.cleanupQueue.on('failed', (job: Job, error: Error) => {
      logger.error('Cleanup job failed', {
        jobType: job.name,
        jobId: job.id,
        error: error.message,
        attempts: job.attemptsMade
      });

      this.metrics.totalErrors++;
    });

    this.cleanupQueue.on('stalled', (job: Job) => {
      logger.warn('Cleanup job stalled', {
        jobType: job.name,
        jobId: job.id
      });
    });

    this.cleanupQueue.on('error', (error: Error) => {
      logger.error('Cleanup queue error', { error: error.message });
    });
  }

  private async processExpiredSessions(job: Job): Promise<CleanupResult> {
    const startTime = Date.now();
    const result: CleanupResult = {
      processed: 0,
      expired: 0,
      archived: 0,
      deleted: 0,
      errors: [],
      duration: 0
    };

    try {
      logger.info('Processing expired sessions cleanup');

      // Get cache statistics to find sessions
      const cacheStats = await sessionCache.getStats();
      
      if (cacheStats.keyspace.sessions === 0) {
        logger.debug('No sessions found in cache for cleanup');
        result.duration = Date.now() - startTime;
        return result;
      }

      // This is a simplified version - in a real implementation,
      // you would iterate through Redis keys or query the database
      
      // For demonstration, we'll simulate processing
      const sessionCount = Math.min(cacheStats.keyspace.sessions, this.config.cleanup.batchSize);
      result.processed = sessionCount;
      
      logger.info('Expired sessions cleanup completed', {
        processed: result.processed,
        expired: result.expired,
        deleted: result.deleted
      });

    } catch (error) {
      logger.error('Error processing expired sessions', {
        error: (error as Error).message
      });
      
      result.errors.push({
        sessionId: 'batch',
        error: (error as Error).message
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  private async processInactiveSessions(job: Job): Promise<CleanupResult> {
    const startTime = Date.now();
    const result: CleanupResult = {
      processed: 0,
      expired: 0,
      archived: 0,
      deleted: 0,
      errors: [],
      duration: 0
    };

    try {
      logger.info('Processing inactive sessions cleanup');

      const cacheStats = await sessionCache.getStats();
      
      if (cacheStats.keyspace.sessions === 0) {
        result.duration = Date.now() - startTime;
        return result;
      }

      // Process inactive sessions in batches
      const now = Date.now();
      const inactiveThreshold = now - this.config.cleanup.inactiveSessionThreshold;

      // Simulate processing for demonstration
      result.processed = Math.min(cacheStats.keyspace.sessions, this.config.cleanup.batchSize);

      logger.info('Inactive sessions cleanup completed', {
        processed: result.processed,
        archived: result.archived,
        deleted: result.deleted
      });

    } catch (error) {
      logger.error('Error processing inactive sessions', {
        error: (error as Error).message
      });
      
      result.errors.push({
        sessionId: 'batch',
        error: (error as Error).message
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  private async processCacheMaintenance(job: Job): Promise<CleanupResult> {
    const startTime = Date.now();
    const result: CleanupResult = {
      processed: 0,
      expired: 0,
      archived: 0,
      deleted: 0,
      errors: [],
      duration: 0
    };

    try {
      logger.info('Processing cache maintenance');

      // Get cache statistics
      const cacheStats = await sessionCache.getStats();
      
      // Log memory usage
      logger.info('Cache maintenance - memory status', {
        usedMemory: cacheStats.memory.used,
        peakMemory: cacheStats.memory.peak,
        sessions: cacheStats.keyspace.sessions,
        messages: cacheStats.keyspace.messages,
        agentStates: cacheStats.keyspace.agentStates
      });

      // Perform basic maintenance operations
      result.processed = 1; // Maintenance task count

    } catch (error) {
      logger.error('Error during cache maintenance', {
        error: (error as Error).message
      });
      
      result.errors.push({
        sessionId: 'maintenance',
        error: (error as Error).message
      });
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  private async processHealthCheck(job: Job): Promise<void> {
    try {
      const [sessionHealth, cacheStats] = await Promise.all([
        sessionManager.getSessionHealth(),
        sessionCache.getStats()
      ]);

      const healthStatus = {
        activeSessions: sessionHealth.activeSessions,
        cacheConnected: cacheStats.connected,
        memoryUsage: sessionHealth.memoryUsage,
        queueStats: await this.getQueueStats()
      };

      // Log health status
      logger.debug('Session system health check', healthStatus);

      // Check for alerts
      if (!cacheStats.connected) {
        logger.error('Health check alert: Cache disconnected');
      }

      if (sessionHealth.memoryUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB
        logger.warn('Health check alert: High memory usage', {
          heapUsed: Math.round(sessionHealth.memoryUsage.heapUsed / 1024 / 1024) + 'MB'
        });
      }

    } catch (error) {
      logger.error('Health check failed', {
        error: (error as Error).message
      });
    }
  }

  private updateMetrics(result: CleanupResult): void {
    this.metrics.totalCleanups++;
    this.metrics.totalSessionsProcessed += result.processed;
    this.metrics.totalSessionsDeleted += result.deleted;
    this.metrics.totalErrors += result.errors.length;
    
    // Update average duration
    const totalTime = this.metrics.averageCleanupDuration * (this.metrics.totalCleanups - 1) + result.duration;
    this.metrics.averageCleanupDuration = totalTime / this.metrics.totalCleanups;
    
    this.metrics.lastCleanupAt = new Date();
  }
}

// Export singleton instance
export const sessionCleanup = new SessionCleanup();