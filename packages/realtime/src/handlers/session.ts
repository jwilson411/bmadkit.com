import { Socket } from 'socket.io';
import { SessionRoomManager } from '../services/sessionRooms';
import { BroadcastService } from '../services/broadcast';
import { logger } from '../utils/logger';
import { updateSocketActivity } from '../middleware/auth';
import { SocketData, EventAck } from '../types/events';

export class SessionHandler {
  private sessionRooms: SessionRoomManager;
  private broadcast: BroadcastService;

  constructor(sessionRooms: SessionRoomManager, broadcast: BroadcastService) {
    this.sessionRooms = sessionRooms;
    this.broadcast = broadcast;
  }

  setupHandlers(socket: Socket): void {
    // Join session room
    socket.on('join_session', async (data: { sessionId: string }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const { sessionId } = data;
        
        if (!sessionId) {
          const error = { success: false, error: { code: 'INVALID_DATA', message: 'Session ID is required' }, timestamp: new Date().toISOString() };
          callback?.(error);
          return;
        }

        const result = await this.sessionRooms.joinSession(socket, sessionId);
        
        if (result.success) {
          const room = this.sessionRooms.getSessionRoom(sessionId);
          const ack: EventAck = {
            success: true,
            timestamp: new Date().toISOString()
          };
          
          // Send session status to newly joined user
          socket.emit('session_joined', {
            id: `join-${Date.now()}`,
            type: 'session_joined',
            sessionId,
            timestamp: new Date().toISOString(),
            data: {
              participantCount: room?.participants.size || 1,
              status: room?.metadata.status || 'ACTIVE',
              currentAgent: room?.metadata.currentAgent
            }
          });

          callback?.(ack);
          
          logger.info('User successfully joined session', {
            socketId: socket.id,
            sessionId,
            participantCount: room?.participants.size
          });
          
        } else {
          const error: EventAck = {
            success: false,
            error: { code: 'JOIN_FAILED', message: result.error || 'Failed to join session' },
            timestamp: new Date().toISOString()
          };
          callback?.(error);
        }

      } catch (error) {
        logger.error('Error handling join_session', { error, socketId: socket.id });
        const errorAck: EventAck = {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
          timestamp: new Date().toISOString()
        };
        callback?.(errorAck);
      }
    });

    // Leave session room
    socket.on('leave_session', async (callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        await this.sessionRooms.leaveCurrentSession(socket);
        
        const ack: EventAck = {
          success: true,
          timestamp: new Date().toISOString()
        };
        callback?.(ack);

      } catch (error) {
        logger.error('Error handling leave_session', { error, socketId: socket.id });
        const errorAck: EventAck = {
          success: false,
          error: { code: 'LEAVE_FAILED', message: 'Failed to leave session' },
          timestamp: new Date().toISOString()
        };
        callback?.(errorAck);
      }
    });

    // Request session status
    socket.on('get_session_status', async (data: { sessionId: string }, callback?: (response: any) => void) => {
      updateSocketActivity(socket);
      
      try {
        const { sessionId } = data;
        const room = this.sessionRooms.getSessionRoom(sessionId);
        
        if (!room) {
          callback?.({
            success: false,
            error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        callback?.({
          success: true,
          data: {
            sessionId: room.sessionId,
            participantCount: room.participants.size,
            status: room.metadata.status,
            currentAgent: room.metadata.currentAgent,
            createdAt: room.createdAt,
            lastActivity: room.lastActivity
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Error handling get_session_status', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Ping/Pong for connection health
    socket.on('ping', (callback?: (response: { pong: string; serverTime: string }) => void) => {
      updateSocketActivity(socket);
      callback?.({
        pong: 'pong',
        serverTime: new Date().toISOString()
      });
    });

    // User typing indicator
    socket.on('user_typing', async (data: { sessionId: string; typing: boolean }) => {
      updateSocketActivity(socket);
      
      try {
        const { sessionId, typing } = data;
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !sessionId) {
          return;
        }

        // Broadcast typing status to other participants in the session
        socket.to(sessionId).emit('user_typing_status', {
          id: `typing-${Date.now()}`,
          type: 'user_typing_status',
          sessionId,
          userId: socketData.userId,
          timestamp: new Date().toISOString(),
          data: {
            typing,
            userId: socketData.userId
          }
        });

      } catch (error) {
        logger.error('Error handling user_typing', { error, socketId: socket.id });
      }
    });

    // Request to pause/resume session
    socket.on('session_control', async (data: { sessionId: string; action: 'pause' | 'resume' }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const { sessionId, action } = data;
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData || !sessionId) {
          callback?.({
            success: false,
            error: { code: 'INVALID_DATA', message: 'Invalid session or user data' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        const newStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
        await this.sessionRooms.updateSessionStatus(sessionId, newStatus);

        // Broadcast session control change
        await this.broadcast.broadcastToSession(sessionId, {
          type: 'session_status_changed',
          sessionId,
          userId: socketData.userId,
          data: {
            status: newStatus,
            action,
            triggeredBy: socketData.userId,
            reason: `Session ${action}d by user`
          }
        });

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Session control action performed', {
          sessionId,
          action,
          userId: socketData.userId
        });

      } catch (error) {
        logger.error('Error handling session_control', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'CONTROL_FAILED', message: 'Failed to control session' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle connection quality reporting from client
    socket.on('report_connection_quality', async (data: { quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR'; latency?: number }) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        if (!socketData?.sessionId) return;

        logger.debug('Connection quality reported', {
          socketId: socket.id,
          userId: socketData.userId,
          quality: data.quality,
          latency: data.latency
        });

        // Could store this information for monitoring and alerting

      } catch (error) {
        logger.error('Error handling connection quality report', { error, socketId: socket.id });
      }
    });
  }
}