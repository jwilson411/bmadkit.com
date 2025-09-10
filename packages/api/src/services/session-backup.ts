import { logger } from '../utils/logger';
import { RedisService } from './redis-service';

export interface SessionSnapshot {
  sessionId: string;
  userId: string;
  timestamp: Date;
  conversationState: {
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: Date;
      messageId: string;
    }>;
    currentStep: string;
    planningContext: Record<string, any>;
    documentState: Record<string, any>;
    agentStates: Record<string, any>;
  };
  userInteractions: {
    lastActivity: Date;
    currentPage: string;
    formData: Record<string, any>;
    unsavedChanges: boolean;
  };
  systemState: {
    activeAgents: string[];
    processingQueue: Array<{
      taskId: string;
      type: string;
      status: 'pending' | 'processing' | 'completed';
    }>;
    errorHistory: Array<{
      errorId: string;
      timestamp: Date;
      error: string;
      recovery?: string;
    }>;
  };
  metadata: {
    version: string;
    platform: string;
    userAgent?: string;
    checksum: string;
  };
}

export interface BackupConfig {
  autoBackupInterval: number; // milliseconds
  maxBackupsPerSession: number;
  compressionEnabled: boolean;
  retentionDays: number;
  incrementalBackups: boolean;
}

export interface RecoveryPoint {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: 'auto' | 'manual' | 'checkpoint';
  description: string;
  dataSize: number;
  isCompressed: boolean;
}

class SessionBackupService {
  private redis: RedisService;
  private backupConfig: BackupConfig;
  private activeBackupJobs = new Map<string, NodeJS.Timeout>();
  private compressionEnabled: boolean;

  constructor() {
    this.redis = new RedisService();
    this.backupConfig = {
      autoBackupInterval: 30000, // 30 seconds
      maxBackupsPerSession: 20,
      compressionEnabled: true,
      retentionDays: 7,
      incrementalBackups: true
    };
    this.compressionEnabled = this.backupConfig.compressionEnabled;
  }

  /**
   * Start automatic backup for a session
   */
  startAutomaticBackup(sessionId: string, userId: string): void {
    // Stop existing backup job if any
    this.stopAutomaticBackup(sessionId);

    const backupJob = setInterval(async () => {
      try {
        await this.createBackup(sessionId, userId, 'auto', 'Automatic backup');
      } catch (error) {
        logger.error(`Automatic backup failed for session ${sessionId}:`, error);
      }
    }, this.backupConfig.autoBackupInterval);

    this.activeBackupJobs.set(sessionId, backupJob);
    logger.info(`Started automatic backup for session: ${sessionId}`);
  }

  /**
   * Stop automatic backup for a session
   */
  stopAutomaticBackup(sessionId: string): void {
    const backupJob = this.activeBackupJobs.get(sessionId);
    if (backupJob) {
      clearInterval(backupJob);
      this.activeBackupJobs.delete(sessionId);
      logger.info(`Stopped automatic backup for session: ${sessionId}`);
    }
  }

  /**
   * Create a backup of the current session state
   */
  async createBackup(
    sessionId: string,
    userId: string,
    type: 'auto' | 'manual' | 'checkpoint' = 'manual',
    description: string = 'Manual backup'
  ): Promise<string> {
    try {
      const snapshot = await this.captureSessionSnapshot(sessionId, userId);
      const backupId = this.generateBackupId(sessionId);
      
      // Calculate checksum for data integrity
      snapshot.metadata.checksum = this.calculateChecksum(snapshot);
      
      // Compress data if enabled
      const serializedData = JSON.stringify(snapshot);
      const dataToStore = this.compressionEnabled 
        ? await this.compressData(serializedData)
        : serializedData;
      
      // Store backup in Redis
      const backupKey = `session:backup:${sessionId}:${backupId}`;
      await this.redis.setex(
        backupKey, 
        this.backupConfig.retentionDays * 24 * 60 * 60,
        dataToStore
      );
      
      // Store recovery point metadata
      const recoveryPoint: RecoveryPoint = {
        id: backupId,
        sessionId,
        timestamp: new Date(),
        type,
        description,
        dataSize: serializedData.length,
        isCompressed: this.compressionEnabled
      };
      
      const recoveryKey = `session:recovery:${sessionId}`;
      const existingRecoveryPoints = await this.getRecoveryPoints(sessionId);
      existingRecoveryPoints.push(recoveryPoint);
      
      // Keep only the latest backups
      if (existingRecoveryPoints.length > this.backupConfig.maxBackupsPerSession) {
        const oldPoints = existingRecoveryPoints.splice(
          0, 
          existingRecoveryPoints.length - this.backupConfig.maxBackupsPerSession
        );
        
        // Clean up old backups
        for (const oldPoint of oldPoints) {
          await this.redis.del(`session:backup:${sessionId}:${oldPoint.id}`);
        }
      }
      
      await this.redis.setex(
        recoveryKey,
        this.backupConfig.retentionDays * 24 * 60 * 60,
        JSON.stringify(existingRecoveryPoints)
      );
      
      logger.info(`Session backup created:`, {
        sessionId,
        backupId,
        type,
        dataSize: recoveryPoint.dataSize,
        compressed: recoveryPoint.isCompressed
      });
      
      return backupId;
    } catch (error) {
      logger.error(`Failed to create backup for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Restore session from a backup
   */
  async restoreSession(sessionId: string, backupId?: string): Promise<SessionSnapshot> {
    try {
      // Use latest backup if backupId not specified
      if (!backupId) {
        const recoveryPoints = await this.getRecoveryPoints(sessionId);
        if (recoveryPoints.length === 0) {
          throw new Error(`No backups found for session ${sessionId}`);
        }
        backupId = recoveryPoints[recoveryPoints.length - 1].id;
      }
      
      const backupKey = `session:backup:${sessionId}:${backupId}`;
      const backupData = await this.redis.get(backupKey);
      
      if (!backupData) {
        throw new Error(`Backup ${backupId} not found for session ${sessionId}`);
      }
      
      // Decompress if needed
      const recoveryPoints = await this.getRecoveryPoints(sessionId);
      const recoveryPoint = recoveryPoints.find(p => p.id === backupId);
      const serializedData = recoveryPoint?.isCompressed 
        ? await this.decompressData(backupData)
        : backupData;
      
      const snapshot: SessionSnapshot = JSON.parse(serializedData);
      
      // Verify data integrity
      const expectedChecksum = snapshot.metadata.checksum;
      snapshot.metadata.checksum = ''; // Remove for verification
      const actualChecksum = this.calculateChecksum(snapshot);
      
      if (expectedChecksum !== actualChecksum) {
        logger.warn(`Checksum mismatch for backup ${backupId}, data may be corrupted`);
      }
      
      snapshot.metadata.checksum = expectedChecksum; // Restore original
      
      logger.info(`Session restored from backup:`, {
        sessionId,
        backupId,
        timestamp: snapshot.timestamp,
        messageCount: snapshot.conversationState.messages.length
      });
      
      return snapshot;
    } catch (error) {
      logger.error(`Failed to restore session ${sessionId} from backup ${backupId}:`, error);
      throw error;
    }
  }

  /**
   * Get available recovery points for a session
   */
  async getRecoveryPoints(sessionId: string): Promise<RecoveryPoint[]> {
    try {
      const recoveryKey = `session:recovery:${sessionId}`;
      const data = await this.redis.get(recoveryKey);
      
      if (!data) {
        return [];
      }
      
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Failed to get recovery points for session ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Create a checkpoint backup (important state for recovery)
   */
  async createCheckpoint(
    sessionId: string, 
    userId: string, 
    description: string
  ): Promise<string> {
    return this.createBackup(sessionId, userId, 'checkpoint', description);
  }

  /**
   * Detect and handle session conflicts during recovery
   */
  async handleSessionConflict(
    sessionId: string,
    currentState: any,
    backupState: SessionSnapshot
  ): Promise<SessionSnapshot> {
    logger.warn(`Session conflict detected for ${sessionId}, attempting resolution`);
    
    // Merge strategies for different types of conflicts
    const resolvedState = { ...backupState };
    
    // Message conflict resolution: merge messages by timestamp
    if (currentState.conversationState?.messages && backupState.conversationState.messages) {
      const allMessages = [
        ...currentState.conversationState.messages,
        ...backupState.conversationState.messages
      ];
      
      // Remove duplicates and sort by timestamp
      const uniqueMessages = allMessages.filter((message, index, array) => 
        array.findIndex(m => m.messageId === message.messageId) === index
      ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      resolvedState.conversationState.messages = uniqueMessages;
    }
    
    // Form data conflict resolution: prefer current state
    if (currentState.userInteractions?.formData) {
      resolvedState.userInteractions.formData = {
        ...backupState.userInteractions.formData,
        ...currentState.userInteractions.formData
      };
    }
    
    // Update timestamp and add conflict resolution metadata
    resolvedState.timestamp = new Date();
    resolvedState.metadata.version = 'conflict-resolved';
    
    logger.info(`Session conflict resolved for ${sessionId}`);
    return resolvedState;
  }

  /**
   * Clean up expired backups
   */
  async cleanupExpiredBackups(): Promise<void> {
    try {
      const pattern = 'session:backup:*';
      const keys = await this.redis.keys(pattern);
      
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl <= 0) {
          await this.redis.del(key);
        }
      }
      
      logger.info(`Cleaned up expired session backups`);
    } catch (error) {
      logger.error('Failed to cleanup expired backups:', error);
    }
  }

  // Private methods

  private async captureSessionSnapshot(sessionId: string, userId: string): Promise<SessionSnapshot> {
    // Get current session state from various sources
    const conversationState = await this.getConversationState(sessionId);
    const userInteractions = await this.getUserInteractionState(sessionId);
    const systemState = await this.getSystemState(sessionId);
    
    return {
      sessionId,
      userId,
      timestamp: new Date(),
      conversationState,
      userInteractions,
      systemState,
      metadata: {
        version: '1.0',
        platform: 'BMAD',
        userAgent: 'BMAD-Platform/1.0',
        checksum: '' // Will be calculated after serialization
      }
    };
  }

  private async getConversationState(sessionId: string): Promise<SessionSnapshot['conversationState']> {
    // Fetch from conversation service
    const messagesKey = `session:messages:${sessionId}`;
    const contextKey = `session:context:${sessionId}`;
    const documentsKey = `session:documents:${sessionId}`;
    const agentsKey = `session:agents:${sessionId}`;
    
    const [messages, context, documents, agents] = await Promise.all([
      this.redis.get(messagesKey),
      this.redis.get(contextKey),
      this.redis.get(documentsKey),
      this.redis.get(agentsKey)
    ]);
    
    return {
      messages: messages ? JSON.parse(messages) : [],
      currentStep: 'planning',
      planningContext: context ? JSON.parse(context) : {},
      documentState: documents ? JSON.parse(documents) : {},
      agentStates: agents ? JSON.parse(agents) : {}
    };
  }

  private async getUserInteractionState(sessionId: string): Promise<SessionSnapshot['userInteractions']> {
    const interactionKey = `session:interactions:${sessionId}`;
    const data = await this.redis.get(interactionKey);
    
    return data ? JSON.parse(data) : {
      lastActivity: new Date(),
      currentPage: '/',
      formData: {},
      unsavedChanges: false
    };
  }

  private async getSystemState(sessionId: string): Promise<SessionSnapshot['systemState']> {
    const systemKey = `session:system:${sessionId}`;
    const data = await this.redis.get(systemKey);
    
    return data ? JSON.parse(data) : {
      activeAgents: [],
      processingQueue: [],
      errorHistory: []
    };
  }

  private generateBackupId(sessionId: string): string {
    return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateChecksum(data: any): string {
    // Simple checksum calculation (in production, use crypto.createHash)
    const serialized = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < serialized.length; i++) {
      const char = serialized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  private async compressData(data: string): Promise<string> {
    // Simple compression simulation (in production, use zlib or similar)
    return Buffer.from(data).toString('base64');
  }

  private async decompressData(data: string): Promise<string> {
    // Simple decompression simulation
    return Buffer.from(data, 'base64').toString();
  }

  /**
   * Get backup statistics for monitoring
   */
  getBackupStats(): {
    activeBackups: number;
    totalDataSize: number;
    compressionEnabled: boolean;
    retentionDays: number;
  } {
    return {
      activeBackups: this.activeBackupJobs.size,
      totalDataSize: 0, // Would calculate in production
      compressionEnabled: this.compressionEnabled,
      retentionDays: this.backupConfig.retentionDays
    };
  }

  /**
   * Destroy service and clean up resources
   */
  destroy(): void {
    for (const [sessionId, job] of this.activeBackupJobs) {
      clearInterval(job);
    }
    this.activeBackupJobs.clear();
    logger.info('Session backup service destroyed');
  }
}

// Redis service mock - replace with actual Redis implementation
class RedisService {
  private storage = new Map<string, { value: string; ttl?: number; expires?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.storage.get(key);
    if (!item) return null;
    
    if (item.expires && Date.now() > item.expires) {
      this.storage.delete(key);
      return null;
    }
    
    return item.value;
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    this.storage.set(key, {
      value,
      ttl: seconds,
      expires: Date.now() + (seconds * 1000)
    });
  }

  async del(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace('*', '.*'));
    return Array.from(this.storage.keys()).filter(key => regex.test(key));
  }

  async ttl(key: string): Promise<number> {
    const item = this.storage.get(key);
    if (!item || !item.expires) return -1;
    
    const remaining = item.expires - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }
}

export const sessionBackupService = new SessionBackupService();