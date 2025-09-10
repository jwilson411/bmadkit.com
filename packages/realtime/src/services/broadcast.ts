import { Server } from 'socket.io';
import { getRedisClient, getPubClient, getSubClient } from '../utils/redis';
import { logger } from '../utils/logger';
import { RealtimeEvent, BroadcastMessage } from '../types/events';
import { v4 as uuidv4 } from 'uuid';

export class BroadcastService {
  private io: Server;
  private redis;
  private pubClient;
  private subClient;

  constructor(io: Server) {
    this.io = io;
    this.redis = getRedisClient();
    
    // Create separate Redis clients for pub/sub to avoid blocking
    this.pubClient = getPubClient();
    this.subClient = getSubClient();
    
    this.setupSubscriptions();
  }

  private async setupSubscriptions(): Promise<void> {
    try {
      if (!this.subClient.isOpen) {
        await this.subClient.connect();
      }

      // Subscribe to broadcast messages
      await this.subClient.subscribe('bmad:broadcast', (message) => {
        this.handleBroadcastMessage(message);
      });

      // Subscribe to session-specific channels
      await this.subClient.pSubscribe('bmad:session:*', (message, channel) => {
        this.handleSessionMessage(message, channel);
      });

      logger.info('Redis pub/sub subscriptions established for broadcasting');

    } catch (error) {
      logger.error('Failed to setup Redis subscriptions', { error });
    }
  }

  private handleBroadcastMessage(message: string): void {
    try {
      const broadcastMsg: BroadcastMessage = JSON.parse(message);
      this.emitToRoom(broadcastMsg);
    } catch (error) {
      logger.error('Failed to process broadcast message', { error, message });
    }
  }

  private handleSessionMessage(message: string, channel: string): void {
    try {
      const sessionId = channel.split(':')[2]; // Extract sessionId from 'bmad:session:sessionId'
      const event: RealtimeEvent = JSON.parse(message);
      
      this.io.to(sessionId).emit(event.type, event);
      
      logger.debug('Session message broadcasted', {
        sessionId,
        eventType: event.type,
        eventId: event.id
      });

    } catch (error) {
      logger.error('Failed to process session message', { error, message, channel });
    }
  }

  private emitToRoom(broadcastMsg: BroadcastMessage): void {
    const { room, event, excludeSocket, includeSocketsOnly } = broadcastMsg;

    let roomEmitter = this.io.to(room);

    // Handle socket exclusions/inclusions
    if (excludeSocket) {
      roomEmitter = roomEmitter.except(excludeSocket);
    }

    // For socket inclusions, we need to emit individually
    if (includeSocketsOnly && includeSocketsOnly.length > 0) {
      includeSocketsOnly.forEach(socketId => {
        this.io.to(socketId).emit(event.type, event);
      });
      return;
    }

    roomEmitter.emit(event.type, event);

    logger.debug('Event broadcasted to room', {
      room,
      eventType: event.type,
      eventId: event.id,
      excludeSocket,
      includeCount: includeSocketsOnly?.length
    });
  }

  // Public methods for broadcasting events
  async broadcastToSession(sessionId: string, event: Omit<RealtimeEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: RealtimeEvent = {
      ...event,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    try {
      if (!this.pubClient.isOpen) {
        await this.pubClient.connect();
      }

      // Publish to Redis for cross-server broadcasting
      await this.pubClient.publish(`bmad:session:${sessionId}`, JSON.stringify(fullEvent));

      logger.info('Event published to session', {
        sessionId,
        eventType: event.type,
        eventId: fullEvent.id
      });

    } catch (error) {
      logger.error('Failed to broadcast to session', { error, sessionId, eventType: event.type });
      
      // Fallback to direct emission if Redis fails
      this.io.to(sessionId).emit(event.type, fullEvent);
    }
  }

  async broadcastProgressUpdate(sessionId: string, data: {
    percentage: number;
    currentPhase: string;
    estimatedTimeRemaining?: number;
    completedTasks: number;
    totalTasks: number;
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'progress_updated',
      sessionId,
      data
    });
  }

  async broadcastDocumentUpdate(sessionId: string, data: {
    documentId: string;
    documentType: 'PROJECT_BRIEF' | 'PRD' | 'ARCHITECTURE' | 'USER_STORIES';
    title: string;
    status: 'DRAFT' | 'GENERATING' | 'COMPLETED';
    version: number;
    changes?: {
      type: 'created' | 'updated' | 'deleted';
      summary: string;
      affectedSections?: string[];
    };
    content?: {
      preview: string;
      wordCount?: number;
      lastModified: string;
    };
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'document_updated',
      sessionId,
      data
    });
  }

  async broadcastAgentStatusChange(sessionId: string, data: {
    previousAgent?: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
    currentAgent: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
    status: 'STARTING' | 'WORKING' | 'COMPLETED' | 'HANDOFF';
    task: string;
    estimatedDuration?: number;
    message?: string;
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'agent_status_changed',
      sessionId,
      data
    });
  }

  async broadcastSessionStarted(sessionId: string, data: {
    projectInput: string;
    expectedDuration: number;
    agentSequence: string[];
    totalTasks: number;
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'session_started',
      sessionId,
      data
    });
  }

  async broadcastSessionCompleted(sessionId: string, data: {
    completionTime: string;
    totalDuration: number;
    documentsGenerated: string[];
    summary: string;
    nextSteps?: string[];
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'session_completed',
      sessionId,
      data
    });
  }

  async broadcastError(sessionId: string, data: {
    errorType: 'CONNECTION' | 'PROCESSING' | 'TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'AUTHENTICATION' | 'PERMISSION';
    errorCode: string;
    message: string;
    recoveryOptions: {
      action: 'RETRY' | 'REFRESH' | 'CONTACT_SUPPORT' | 'RESTART_SESSION';
      description: string;
      automated: boolean;
    }[];
    context?: {
      agent?: string;
      document?: string;
      step?: string;
    };
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'error_occurred',
      sessionId,
      data
    });
  }

  async broadcastConnectionStatus(sessionId: string, data: {
    status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'ERROR';
    clientCount: number;
    latency?: number;
    quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  }): Promise<void> {
    await this.broadcastToSession(sessionId, {
      type: 'connection_status',
      sessionId,
      data
    });
  }

  // General purpose broadcasting with more control
  async broadcast(message: BroadcastMessage): Promise<void> {
    try {
      if (!this.pubClient.isOpen) {
        await this.pubClient.connect();
      }

      await this.pubClient.publish('bmad:broadcast', JSON.stringify(message));

      logger.debug('Broadcast message published', {
        room: message.room,
        eventType: message.event.type
      });

    } catch (error) {
      logger.error('Failed to publish broadcast message', { error });
      
      // Fallback to direct emission
      this.emitToRoom(message);
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.subClient.isOpen) {
        await this.subClient.unsubscribe();
        await this.subClient.disconnect();
      }
      
      if (this.pubClient.isOpen) {
        await this.pubClient.disconnect();
      }

      logger.info('Broadcast service disconnected from Redis');

    } catch (error) {
      logger.error('Error disconnecting broadcast service', { error });
    }
  }
}