import { Socket } from 'socket.io';
import { BroadcastService } from '../services/broadcast';
import { SessionRoomManager } from '../services/sessionRooms';
import { logger } from '../utils/logger';
import { updateSocketActivity } from '../middleware/auth';
import { SocketData, EventAck } from '../types/events';

export class AgentHandler {
  private broadcast: BroadcastService;
  private sessionRooms: SessionRoomManager;

  constructor(broadcast: BroadcastService, sessionRooms: SessionRoomManager) {
    this.broadcast = broadcast;
    this.sessionRooms = sessionRooms;
  }

  setupHandlers(socket: Socket): void {
    // Agent status change notifications
    socket.on('agent_status_changed', async (data: {
      previousAgent?: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
      currentAgent: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
      status: 'STARTING' | 'WORKING' | 'COMPLETED' | 'HANDOFF';
      task: string;
      estimatedDuration?: number;
      message?: string;
    }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !socketData.sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Valid session required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Update session with current agent
        await this.sessionRooms.updateSessionStatus(
          socketData.sessionId, 
          'ACTIVE', 
          data.currentAgent
        );

        // Broadcast agent status change
        await this.broadcast.broadcastAgentStatusChange(socketData.sessionId, data);

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Agent status change broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          previousAgent: data.previousAgent,
          currentAgent: data.currentAgent,
          status: data.status,
          task: data.task
        });

      } catch (error) {
        logger.error('Error handling agent_status_changed', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast agent status change' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Progress updates from agents
    socket.on('progress_updated', async (data: {
      percentage: number;
      currentPhase: string;
      estimatedTimeRemaining?: number;
      completedTasks: number;
      totalTasks: number;
      message?: string;
      details?: {
        currentStep: string;
        nextSteps: string[];
        blockers?: string[];
      };
    }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !socketData.sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Valid session required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Broadcast progress update
        await this.broadcast.broadcastProgressUpdate(socketData.sessionId, {
          percentage: data.percentage,
          currentPhase: data.currentPhase,
          estimatedTimeRemaining: data.estimatedTimeRemaining,
          completedTasks: data.completedTasks,
          totalTasks: data.totalTasks
        });

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Progress update broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          percentage: data.percentage,
          currentPhase: data.currentPhase,
          completedTasks: data.completedTasks,
          totalTasks: data.totalTasks
        });

      } catch (error) {
        logger.error('Error handling progress_updated', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast progress update' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Session lifecycle events
    socket.on('session_started', async (data: {
      projectInput: string;
      expectedDuration: number;
      agentSequence: string[];
      totalTasks: number;
      initialAgent?: string;
    }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !socketData.sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Valid session required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Update session status to active
        await this.sessionRooms.updateSessionStatus(
          socketData.sessionId, 
          'ACTIVE',
          data.initialAgent
        );

        // Broadcast session started
        await this.broadcast.broadcastSessionStarted(socketData.sessionId, {
          projectInput: data.projectInput,
          expectedDuration: data.expectedDuration,
          agentSequence: data.agentSequence,
          totalTasks: data.totalTasks
        });

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Session started event broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          expectedDuration: data.expectedDuration,
          totalTasks: data.totalTasks
        });

      } catch (error) {
        logger.error('Error handling session_started', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast session start' },
          timestamp: new Date().toISOString()
        });
      }
    });

    socket.on('session_completed', async (data: {
      completionTime: string;
      totalDuration: number;
      documentsGenerated: string[];
      summary: string;
      nextSteps?: string[];
      successMetrics?: {
        tasksCompleted: number;
        documentsCreated: number;
        userSatisfactionScore?: number;
      };
    }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !socketData.sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Valid session required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Update session status to completed
        await this.sessionRooms.updateSessionStatus(socketData.sessionId, 'COMPLETED');

        // Broadcast session completed
        await this.broadcast.broadcastSessionCompleted(socketData.sessionId, {
          completionTime: data.completionTime,
          totalDuration: data.totalDuration,
          documentsGenerated: data.documentsGenerated,
          summary: data.summary,
          nextSteps: data.nextSteps
        });

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Session completed event broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          totalDuration: data.totalDuration,
          documentsGenerated: data.documentsGenerated.length,
          summary: data.summary
        });

      } catch (error) {
        logger.error('Error handling session_completed', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast session completion' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Error reporting from agents
    socket.on('error_occurred', async (data: {
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
      severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !socketData.sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Valid session required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Update session status if critical error
        if (data.severity === 'CRITICAL') {
          await this.sessionRooms.updateSessionStatus(socketData.sessionId, 'FAILED');
        }

        // Broadcast error
        await this.broadcast.broadcastError(socketData.sessionId, {
          errorType: data.errorType,
          errorCode: data.errorCode,
          message: data.message,
          recoveryOptions: data.recoveryOptions,
          context: data.context
        });

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.error('Error event broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          errorType: data.errorType,
          errorCode: data.errorCode,
          severity: data.severity,
          context: data.context
        });

      } catch (error) {
        logger.error('Error handling error_occurred', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast error event' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Agent handoff notifications
    socket.on('agent_handoff', async (data: {
      fromAgent: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
      toAgent: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
      handoffReason: string;
      completedWork: string[];
      nextSteps: string[];
      context?: any;
    }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !socketData.sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Valid session required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Broadcast handoff as agent status change
        await this.broadcast.broadcastAgentStatusChange(socketData.sessionId, {
          previousAgent: data.fromAgent,
          currentAgent: data.toAgent,
          status: 'HANDOFF',
          task: data.handoffReason,
          message: `Handoff from ${data.fromAgent} to ${data.toAgent}: ${data.handoffReason}`
        });

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Agent handoff broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          fromAgent: data.fromAgent,
          toAgent: data.toAgent,
          handoffReason: data.handoffReason
        });

      } catch (error) {
        logger.error('Error handling agent_handoff', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast agent handoff' },
          timestamp: new Date().toISOString()
        });
      }
    });
  }
}