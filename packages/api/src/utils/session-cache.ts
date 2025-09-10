import Redis from 'ioredis';
import { logger } from './logger';
import { 
  PlanningSession, 
  ConversationMessage, 
  AgentState,
  SessionConfig,
  createDefaultSessionConfig 
} from '../models/planning-session';

export interface SessionCacheConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    maxRetriesPerRequest?: number;
    connectTimeout?: number;
    commandTimeout?: number;
  };
  ttl: {
    session: number; // seconds
    messages: number; // seconds
    agentState: number; // seconds
    locks: number; // seconds
  };
  compression: {
    enabled: boolean;
    threshold: number; // bytes
  };
  serialization: {
    pretty: boolean; // for debugging
  };
}

export class SessionCacheError extends Error {
  constructor(
    message: string,
    public operation: string,
    public sessionId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SessionCacheError';
  }
}

export class SessionCache {
  private redis: Redis;
  private config: SessionCacheConfig;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(config: Partial<SessionCacheConfig> = {}) {
    this.config = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        keyPrefix: 'bmad:session:',
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        commandTimeout: 5000,
        ...config.redis
      },
      ttl: {
        session: 3600, // 1 hour
        messages: 7200, // 2 hours
        agentState: 3600, // 1 hour
        locks: 300, // 5 minutes
        ...config.ttl
      },
      compression: {
        enabled: true,
        threshold: 1024, // 1KB
        ...config.compression
      },
      serialization: {
        pretty: process.env.NODE_ENV === 'development',
        ...config.serialization
      }
    };

    this.redis = new Redis({
      host: this.config.redis.host,
      port: this.config.redis.port,
      password: this.config.redis.password,
      db: this.config.redis.db,
      keyPrefix: this.config.redis.keyPrefix,
      maxRetriesPerRequest: this.config.redis.maxRetriesPerRequest,
      connectTimeout: this.config.redis.connectTimeout,
      commandTimeout: this.config.redis.commandTimeout,
      lazyConnect: true,
    });

    this.setupEventHandlers();
  }

  /**
   * Initialize the Redis connection
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;
    
    if (this.connectionPromise) {
      await this.connectionPromise;
      return;
    }

    this.connectionPromise = this.performConnect();
    await this.connectionPromise;
  }

  /**
   * Store session data in cache
   */
  async setSession(sessionId: string, session: PlanningSession): Promise<void> {
    try {
      await this.connect();
      
      const key = this.getSessionKey(sessionId);
      const serialized = this.serialize(session);
      const compressed = this.compress(serialized);
      
      await this.redis.setex(key, this.config.ttl.session, compressed);
      
      logger.debug('Session cached successfully', {
        sessionId,
        dataSize: compressed.length,
        ttl: this.config.ttl.session
      });

    } catch (error) {
      logger.error('Failed to cache session', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to cache session data',
        'setSession',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Retrieve session data from cache
   */
  async getSession(sessionId: string): Promise<PlanningSession | null> {
    try {
      await this.connect();
      
      const key = this.getSessionKey(sessionId);
      const compressed = await this.redis.get(key);
      
      if (!compressed) {
        logger.debug('Session not found in cache', { sessionId });
        return null;
      }
      
      const serialized = this.decompress(compressed);
      const session = this.deserialize(serialized) as PlanningSession;
      
      // Extend TTL on access
      await this.redis.expire(key, this.config.ttl.session);
      
      logger.debug('Session retrieved from cache', {
        sessionId,
        status: session.status,
        lastActive: session.lastActiveAt
      });
      
      return session;

    } catch (error) {
      logger.error('Failed to retrieve session from cache', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to retrieve session from cache',
        'getSession',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Store conversation messages for a session
   */
  async setMessages(sessionId: string, messages: ConversationMessage[]): Promise<void> {
    try {
      await this.connect();
      
      const key = this.getMessagesKey(sessionId);
      const serialized = this.serialize(messages);
      const compressed = this.compress(serialized);
      
      await this.redis.setex(key, this.config.ttl.messages, compressed);
      
      logger.debug('Messages cached successfully', {
        sessionId,
        messageCount: messages.length,
        dataSize: compressed.length
      });

    } catch (error) {
      logger.error('Failed to cache messages', {
        sessionId,
        messageCount: messages.length,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to cache messages',
        'setMessages',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Retrieve conversation messages from cache
   */
  async getMessages(sessionId: string): Promise<ConversationMessage[]> {
    try {
      await this.connect();
      
      const key = this.getMessagesKey(sessionId);
      const compressed = await this.redis.get(key);
      
      if (!compressed) {
        logger.debug('Messages not found in cache', { sessionId });
        return [];
      }
      
      const serialized = this.decompress(compressed);
      const messages = this.deserialize(serialized) as ConversationMessage[];
      
      // Extend TTL on access
      await this.redis.expire(key, this.config.ttl.messages);
      
      logger.debug('Messages retrieved from cache', {
        sessionId,
        messageCount: messages.length
      });
      
      return messages;

    } catch (error) {
      logger.error('Failed to retrieve messages from cache', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to retrieve messages from cache',
        'getMessages',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Store agent states for a session
   */
  async setAgentStates(sessionId: string, agentStates: AgentState[]): Promise<void> {
    try {
      await this.connect();
      
      const key = this.getAgentStatesKey(sessionId);
      const serialized = this.serialize(agentStates);
      const compressed = this.compress(serialized);
      
      await this.redis.setex(key, this.config.ttl.agentState, compressed);
      
      logger.debug('Agent states cached successfully', {
        sessionId,
        stateCount: agentStates.length,
        dataSize: compressed.length
      });

    } catch (error) {
      logger.error('Failed to cache agent states', {
        sessionId,
        stateCount: agentStates.length,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to cache agent states',
        'setAgentStates',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Retrieve agent states from cache
   */
  async getAgentStates(sessionId: string): Promise<AgentState[]> {
    try {
      await this.connect();
      
      const key = this.getAgentStatesKey(sessionId);
      const compressed = await this.redis.get(key);
      
      if (!compressed) {
        logger.debug('Agent states not found in cache', { sessionId });
        return [];
      }
      
      const serialized = this.decompress(compressed);
      const agentStates = this.deserialize(serialized) as AgentState[];
      
      // Extend TTL on access
      await this.redis.expire(key, this.config.ttl.agentState);
      
      logger.debug('Agent states retrieved from cache', {
        sessionId,
        stateCount: agentStates.length
      });
      
      return agentStates;

    } catch (error) {
      logger.error('Failed to retrieve agent states from cache', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to retrieve agent states from cache',
        'getAgentStates',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Acquire a distributed lock for session operations
   */
  async acquireLock(sessionId: string, operation: string = 'general'): Promise<string | null> {
    try {
      await this.connect();
      
      const lockKey = this.getLockKey(sessionId, operation);
      const lockValue = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const acquired = await this.redis.set(
        lockKey,
        lockValue,
        'EX',
        this.config.ttl.locks,
        'NX'
      );
      
      if (acquired === 'OK') {
        logger.debug('Lock acquired', { sessionId, operation, lockValue });
        return lockValue;
      }
      
      logger.debug('Lock acquisition failed', { sessionId, operation });
      return null;

    } catch (error) {
      logger.error('Failed to acquire lock', {
        sessionId,
        operation,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to acquire session lock',
        'acquireLock',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Release a distributed lock
   */
  async releaseLock(sessionId: string, lockValue: string, operation: string = 'general'): Promise<boolean> {
    try {
      await this.connect();
      
      const lockKey = this.getLockKey(sessionId, operation);
      
      // Use Lua script to ensure atomic check-and-delete
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.redis.eval(script, 1, lockKey, lockValue);
      const released = result === 1;
      
      if (released) {
        logger.debug('Lock released', { sessionId, operation, lockValue });
      } else {
        logger.warn('Lock release failed - value mismatch', { sessionId, operation });
      }
      
      return released;

    } catch (error) {
      logger.error('Failed to release lock', {
        sessionId,
        operation,
        lockValue,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to release session lock',
        'releaseLock',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Delete all session data from cache
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.connect();
      
      const keys = [
        this.getSessionKey(sessionId),
        this.getMessagesKey(sessionId),
        this.getAgentStatesKey(sessionId),
      ];
      
      const deleted = await this.redis.del(...keys);
      
      logger.info('Session data deleted from cache', {
        sessionId,
        keysDeleted: deleted
      });

    } catch (error) {
      logger.error('Failed to delete session from cache', {
        sessionId,
        error: (error as Error).message
      });
      throw new SessionCacheError(
        'Failed to delete session from cache',
        'deleteSession',
        sessionId,
        error as Error
      );
    }
  }

  /**
   * Check if session exists in cache
   */
  async hasSession(sessionId: string): Promise<boolean> {
    try {
      await this.connect();
      
      const key = this.getSessionKey(sessionId);
      const exists = await this.redis.exists(key);
      
      return exists === 1;

    } catch (error) {
      logger.error('Failed to check session existence', {
        sessionId,
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    memory: { used: number; peak: number };
    keyspace: { sessions: number; messages: number; agentStates: number };
    info: Record<string, any>;
  }> {
    try {
      await this.connect();
      
      const info = await this.redis.info();
      const keyspace = await this.redis.info('keyspace');
      
      // Parse memory info
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const peakMemoryMatch = info.match(/used_memory_peak:(\d+)/);
      
      const memory = {
        used: memoryMatch ? parseInt(memoryMatch[1]) : 0,
        peak: peakMemoryMatch ? parseInt(peakMemoryMatch[1]) : 0,
      };
      
      // Count keys by type
      const sessionKeys = await this.redis.keys(`${this.config.redis.keyPrefix}session:*`);
      const messageKeys = await this.redis.keys(`${this.config.redis.keyPrefix}messages:*`);
      const stateKeys = await this.redis.keys(`${this.config.redis.keyPrefix}agent-states:*`);
      
      return {
        connected: this.isConnected,
        memory,
        keyspace: {
          sessions: sessionKeys.length,
          messages: messageKeys.length,
          agentStates: stateKeys.length,
        },
        info: this.parseInfoString(info),
      };

    } catch (error) {
      logger.error('Failed to get cache statistics', {
        error: (error as Error).message
      });
      
      return {
        connected: this.isConnected,
        memory: { used: 0, peak: 0 },
        keyspace: { sessions: 0, messages: 0, agentStates: 0 },
        info: {},
      };
    }
  }

  /**
   * Gracefully shutdown the cache connection
   */
  async shutdown(): Promise<void> {
    try {
      if (this.isConnected) {
        await this.redis.quit();
        logger.info('Session cache disconnected gracefully');
      }
    } catch (error) {
      logger.warn('Error during cache shutdown', {
        error: (error as Error).message
      });
    }
  }

  // Private methods

  private async performConnect(): Promise<void> {
    try {
      await this.redis.connect();
      this.isConnected = true;
      
      logger.info('Session cache connected', {
        host: this.config.redis.host,
        port: this.config.redis.port,
        db: this.config.redis.db
      });

    } catch (error) {
      this.isConnected = false;
      logger.error('Failed to connect to session cache', {
        error: (error as Error).message,
        host: this.config.redis.host,
        port: this.config.redis.port
      });
      throw error;
    } finally {
      this.connectionPromise = null;
    }
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.isConnected = true;
      logger.info('Session cache connected');
    });

    this.redis.on('disconnect', () => {
      this.isConnected = false;
      logger.warn('Session cache disconnected');
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      logger.error('Session cache error', { error: error.message });
    });

    this.redis.on('reconnecting', () => {
      logger.info('Session cache reconnecting');
    });
  }

  private getSessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private getMessagesKey(sessionId: string): string {
    return `messages:${sessionId}`;
  }

  private getAgentStatesKey(sessionId: string): string {
    return `agent-states:${sessionId}`;
  }

  private getLockKey(sessionId: string, operation: string): string {
    return `lock:${sessionId}:${operation}`;
  }

  private serialize(data: any): string {
    return JSON.stringify(data, this.config.serialization.pretty ? undefined : null, 
                         this.config.serialization.pretty ? 2 : undefined);
  }

  private deserialize(data: string): any {
    return JSON.parse(data);
  }

  private compress(data: string): string {
    if (!this.config.compression.enabled || data.length < this.config.compression.threshold) {
      return data;
    }
    
    // Simple compression using built-in zlib
    // In production, you might want to use a more efficient compression library
    const zlib = require('zlib');
    return zlib.deflateSync(data).toString('base64');
  }

  private decompress(data: string): string {
    if (!this.config.compression.enabled) {
      return data;
    }
    
    // Try to decompress, if it fails, assume it's uncompressed
    try {
      const zlib = require('zlib');
      return zlib.inflateSync(Buffer.from(data, 'base64')).toString();
    } catch {
      return data;
    }
  }

  private parseInfoString(info: string): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const line of info.split('\r\n')) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = isNaN(Number(value)) ? value : Number(value);
      }
    }
    
    return result;
  }
}

// Export singleton instance
export const sessionCache = new SessionCache();