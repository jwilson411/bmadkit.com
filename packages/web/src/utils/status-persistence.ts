import { z } from 'zod';
import type { AgentPhase, ProjectType } from './status-message-library';
import type { SessionMetrics, TimeEstimationResult } from './time-estimation';

// Persistence schemas
const PersistentAgentStatusSchema = z.object({
  currentPhase: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  status: z.enum(['IDLE', 'WORKING', 'TRANSITIONING', 'COMPLETED', 'ERROR']),
  progress: z.number().min(0).max(1),
  currentActivity: z.string().optional(),
  lastUpdate: z.string().transform(str => new Date(str)),
  estimatedCompletion: z.string().transform(str => new Date(str)).optional(),
  metadata: z.record(z.any()).optional()
});

const PersistentSessionMetricsSchema = z.object({
  workflowExecutionId: z.string(),
  startTime: z.string().transform(str => new Date(str)),
  currentTime: z.string().transform(str => new Date(str)),
  currentPhase: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  completedPhases: z.array(z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'])),
  phaseStartTimes: z.record(z.string().transform(str => new Date(str))),
  phaseCompletionTimes: z.record(z.string().transform(str => new Date(str))),
  userResponseTimes: z.array(z.number()),
  totalInteractions: z.number(),
  projectComplexity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  projectType: z.enum(['WEB_APPLICATION', 'MOBILE_APP', 'API_SERVICE', 'DESKTOP_APPLICATION', 'ECOMMERCE', 'SAAS_PLATFORM', 'DATA_PLATFORM', 'IOT_SYSTEM']).optional()
});

const PersistentDisplayStateSchema = z.object({
  currentMessageId: z.string().optional(),
  messageHistory: z.array(z.object({
    id: z.string(),
    message: z.string(),
    timestamp: z.string().transform(str => new Date(str)),
    agentPhase: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'])
  })),
  isTransitioning: z.boolean(),
  showTimeEstimate: z.boolean(),
  animationState: z.enum(['idle', 'working', 'transitioning', 'celebrating']),
  lastRotation: z.string().transform(str => new Date(str)).optional()
});

export type PersistentAgentStatus = z.infer<typeof PersistentAgentStatusSchema>;
export type PersistentSessionMetrics = z.infer<typeof PersistentSessionMetricsSchema>;
export type PersistentDisplayState = z.infer<typeof PersistentDisplayStateSchema>;

export interface StatusPersistenceOptions {
  enableAutoSave?: boolean;
  saveInterval?: number; // milliseconds
  maxHistoryItems?: number;
  compressionEnabled?: boolean;
  encryptionKey?: string;
}

export interface RecoveredSessionData {
  agentStatus: PersistentAgentStatus | null;
  sessionMetrics: PersistentSessionMetrics | null;
  displayState: PersistentDisplayState | null;
  timestamp: Date;
  isValid: boolean;
  recoveryScore: number; // 0-1, indicates data completeness/freshness
}

export interface PersistenceMetadata {
  version: string;
  timestamp: Date;
  workflowExecutionId: string;
  sessionDuration: number; // minutes
  dataIntegrity: 'COMPLETE' | 'PARTIAL' | 'CORRUPTED';
  recoveryAttempts: number;
}

export class StatusPersistenceEngine {
  private static instance: StatusPersistenceEngine;
  private options: StatusPersistenceOptions;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private readonly STORAGE_PREFIX = 'bmad_status_';
  private readonly VERSION = '1.0.0';

  constructor(options: StatusPersistenceOptions = {}) {
    this.options = {
      enableAutoSave: true,
      saveInterval: 30000, // 30 seconds
      maxHistoryItems: 50,
      compressionEnabled: true,
      ...options
    };
  }

  static getInstance(options?: StatusPersistenceOptions): StatusPersistenceEngine {
    if (!StatusPersistenceEngine.instance) {
      StatusPersistenceEngine.instance = new StatusPersistenceEngine(options);
    }
    return StatusPersistenceEngine.instance;
  }

  /**
   * Save complete session state to storage
   */
  saveSessionState(
    workflowExecutionId: string,
    agentStatus: any,
    sessionMetrics: any,
    displayState: any
  ): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const persistenceData = this.preparePersistenceData(
          workflowExecutionId,
          agentStatus,
          sessionMetrics,
          displayState
        );

        const compressed = this.options.compressionEnabled 
          ? this.compressData(persistenceData)
          : persistenceData;

        const encrypted = this.options.encryptionKey
          ? this.encryptData(compressed, this.options.encryptionKey)
          : compressed;

        localStorage.setItem(
          `${this.STORAGE_PREFIX}${workflowExecutionId}`,
          JSON.stringify(encrypted)
        );

        // Save metadata separately for quick recovery checks
        this.saveMetadata(workflowExecutionId, persistenceData);

        resolve(true);
      } catch (error) {
        console.error('Failed to save session state:', error);
        resolve(false);
      }
    });
  }

  /**
   * Recover session state from storage
   */
  async recoverSessionState(workflowExecutionId: string): Promise<RecoveredSessionData> {
    try {
      const rawData = localStorage.getItem(`${this.STORAGE_PREFIX}${workflowExecutionId}`);
      if (!rawData) {
        return this.createEmptyRecovery();
      }

      let parsedData = JSON.parse(rawData);

      // Decrypt if encryption was used
      if (this.options.encryptionKey) {
        parsedData = this.decryptData(parsedData, this.options.encryptionKey);
      }

      // Decompress if compression was used
      if (this.options.compressionEnabled) {
        parsedData = this.decompressData(parsedData);
      }

      // Validate and parse the data
      const recovery = await this.validateAndParseRecoveredData(parsedData);
      
      // Calculate recovery score
      recovery.recoveryScore = this.calculateRecoveryScore(recovery);

      return recovery;
    } catch (error) {
      console.error('Failed to recover session state:', error);
      return this.createEmptyRecovery();
    }
  }

  /**
   * Start auto-save functionality
   */
  startAutoSave(
    workflowExecutionId: string,
    getCurrentState: () => {
      agentStatus: any;
      sessionMetrics: any;
      displayState: any;
    }
  ): void {
    if (!this.options.enableAutoSave) return;

    this.stopAutoSave(); // Clear any existing timer

    this.autoSaveTimer = setInterval(async () => {
      try {
        const state = getCurrentState();
        await this.saveSessionState(
          workflowExecutionId,
          state.agentStatus,
          state.sessionMetrics,
          state.displayState
        );
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, this.options.saveInterval);
  }

  /**
   * Stop auto-save functionality
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Get all persisted sessions
   */
  getPersistedSessions(): Array<{
    workflowExecutionId: string;
    metadata: PersistenceMetadata;
    lastModified: Date;
  }> {
    const sessions: Array<{
      workflowExecutionId: string;
      metadata: PersistenceMetadata;
      lastModified: Date;
    }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.STORAGE_PREFIX)) {
        const workflowExecutionId = key.replace(this.STORAGE_PREFIX, '');
        const metadata = this.getMetadata(workflowExecutionId);
        
        if (metadata) {
          sessions.push({
            workflowExecutionId,
            metadata,
            lastModified: metadata.timestamp
          });
        }
      }
    }

    return sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  /**
   * Clean up old or corrupted sessions
   */
  cleanupOldSessions(maxAgeHours: number = 168): number { // Default: 1 week
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let cleanedCount = 0;

    const sessions = this.getPersistedSessions();
    
    for (const session of sessions) {
      if (session.lastModified < cutoffTime || 
          session.metadata.dataIntegrity === 'CORRUPTED') {
        this.deleteSession(session.workflowExecutionId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Delete a specific session
   */
  deleteSession(workflowExecutionId: string): boolean {
    try {
      localStorage.removeItem(`${this.STORAGE_PREFIX}${workflowExecutionId}`);
      localStorage.removeItem(`${this.STORAGE_PREFIX}metadata_${workflowExecutionId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
    }
  }

  /**
   * Check if session can be recovered
   */
  canRecoverSession(workflowExecutionId: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const metadata = this.getMetadata(workflowExecutionId);
        if (!metadata) {
          resolve(false);
          return;
        }

        const isRecent = (Date.now() - metadata.timestamp.getTime()) < 24 * 60 * 60 * 1000; // 24 hours
        const isNotCorrupted = metadata.dataIntegrity !== 'CORRUPTED';
        const hasLowRecoveryAttempts = metadata.recoveryAttempts < 5;

        resolve(isRecent && isNotCorrupted && hasLowRecoveryAttempts);
      } catch (error) {
        resolve(false);
      }
    });
  }

  /**
   * Private helper methods
   */
  private preparePersistenceData(
    workflowExecutionId: string,
    agentStatus: any,
    sessionMetrics: any,
    displayState: any
  ): any {
    return {
      version: this.VERSION,
      timestamp: new Date().toISOString(),
      workflowExecutionId,
      agentStatus: agentStatus ? {
        ...agentStatus,
        lastUpdate: agentStatus.lastUpdate?.toISOString(),
        estimatedCompletion: agentStatus.estimatedCompletion?.toISOString()
      } : null,
      sessionMetrics: sessionMetrics ? {
        ...sessionMetrics,
        startTime: sessionMetrics.startTime?.toISOString(),
        currentTime: new Date().toISOString(),
        phaseStartTimes: this.mapToObject(sessionMetrics.phaseStartTimes, (date: Date) => date.toISOString()),
        phaseCompletionTimes: this.mapToObject(sessionMetrics.phaseCompletionTimes, (date: Date) => date.toISOString())
      } : null,
      displayState: displayState ? {
        ...displayState,
        messageHistory: displayState.messageHistory?.map((msg: any) => ({
          ...msg,
          timestamp: msg.timestamp?.toISOString() || new Date().toISOString()
        })),
        lastRotation: displayState.lastRotation?.toISOString()
      } : null
    };
  }

  private async validateAndParseRecoveredData(data: any): Promise<RecoveredSessionData> {
    const recovery: RecoveredSessionData = {
      agentStatus: null,
      sessionMetrics: null,
      displayState: null,
      timestamp: new Date(data.timestamp || Date.now()),
      isValid: false,
      recoveryScore: 0
    };

    try {
      // Validate agent status
      if (data.agentStatus) {
        recovery.agentStatus = PersistentAgentStatusSchema.parse(data.agentStatus);
      }

      // Validate session metrics
      if (data.sessionMetrics) {
        const parsedMetrics = {
          ...data.sessionMetrics,
          phaseStartTimes: this.objectToMap(data.sessionMetrics.phaseStartTimes),
          phaseCompletionTimes: this.objectToMap(data.sessionMetrics.phaseCompletionTimes)
        };
        recovery.sessionMetrics = PersistentSessionMetricsSchema.parse(parsedMetrics);
      }

      // Validate display state
      if (data.displayState) {
        recovery.displayState = PersistentDisplayStateSchema.parse(data.displayState);
      }

      recovery.isValid = true;
    } catch (error) {
      console.warn('Data validation failed during recovery:', error);
      recovery.isValid = false;
    }

    return recovery;
  }

  private calculateRecoveryScore(recovery: RecoveredSessionData): number {
    let score = 0;

    // Base score for having any data
    if (recovery.agentStatus || recovery.sessionMetrics || recovery.displayState) {
      score += 0.3;
    }

    // Score for completeness
    if (recovery.agentStatus) score += 0.25;
    if (recovery.sessionMetrics) score += 0.25;
    if (recovery.displayState) score += 0.2;

    // Score for freshness (within 1 hour = full score, older = reduced)
    const ageHours = (Date.now() - recovery.timestamp.getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, 1 - ageHours / 24); // Full score within 1 hour, 0 after 24 hours
    score *= freshnessScore;

    return Math.min(1, score);
  }

  private saveMetadata(workflowExecutionId: string, data: any): void {
    const metadata: PersistenceMetadata = {
      version: this.VERSION,
      timestamp: new Date(),
      workflowExecutionId,
      sessionDuration: data.sessionMetrics?.startTime 
        ? (Date.now() - new Date(data.sessionMetrics.startTime).getTime()) / (1000 * 60)
        : 0,
      dataIntegrity: 'COMPLETE',
      recoveryAttempts: 0
    };

    localStorage.setItem(
      `${this.STORAGE_PREFIX}metadata_${workflowExecutionId}`,
      JSON.stringify({
        ...metadata,
        timestamp: metadata.timestamp.toISOString()
      })
    );
  }

  private getMetadata(workflowExecutionId: string): PersistenceMetadata | null {
    try {
      const rawMetadata = localStorage.getItem(`${this.STORAGE_PREFIX}metadata_${workflowExecutionId}`);
      if (!rawMetadata) return null;

      const parsed = JSON.parse(rawMetadata);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp)
      };
    } catch (error) {
      return null;
    }
  }

  private createEmptyRecovery(): RecoveredSessionData {
    return {
      agentStatus: null,
      sessionMetrics: null,
      displayState: null,
      timestamp: new Date(),
      isValid: false,
      recoveryScore: 0
    };
  }

  private compressData(data: any): any {
    // Simple compression - in production, use proper compression library
    return data;
  }

  private decompressData(data: any): any {
    // Simple decompression - in production, use proper compression library
    return data;
  }

  private encryptData(data: any, key: string): any {
    // Simple encryption - in production, use proper encryption library
    return data;
  }

  private decryptData(data: any, key: string): any {
    // Simple decryption - in production, use proper encryption library
    return data;
  }

  private mapToObject<T>(map: Map<string, T> | undefined, transform: (value: T) => any): Record<string, any> {
    if (!map) return {};
    const obj: Record<string, any> = {};
    for (const [key, value] of map.entries()) {
      obj[key] = transform(value);
    }
    return obj;
  }

  private objectToMap<T>(obj: Record<string, any> | undefined): Map<string, T> {
    const map = new Map<string, T>();
    if (obj) {
      for (const [key, value] of Object.entries(obj)) {
        map.set(key, new Date(value) as T);
      }
    }
    return map;
  }
}

// Export singleton instance
export const statusPersistenceEngine = StatusPersistenceEngine.getInstance();

// Utility functions
export const saveCurrentSession = (
  workflowExecutionId: string,
  agentStatus: any,
  sessionMetrics: any,
  displayState: any
) => {
  return statusPersistenceEngine.saveSessionState(
    workflowExecutionId,
    agentStatus,
    sessionMetrics,
    displayState
  );
};

export const recoverSession = (workflowExecutionId: string) => {
  return statusPersistenceEngine.recoverSessionState(workflowExecutionId);
};

export const startSessionAutoSave = (
  workflowExecutionId: string,
  getCurrentState: () => any
) => {
  return statusPersistenceEngine.startAutoSave(workflowExecutionId, getCurrentState);
};

export const stopSessionAutoSave = () => {
  return statusPersistenceEngine.stopAutoSave();
};