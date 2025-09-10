import { Server, Socket } from 'socket.io';
import { SessionRoom, SocketData } from '../types/events';
import { logger } from '../utils/logger';
import { requireSessionAccess, updateSocketActivity } from '../middleware/auth';

export class SessionRoomManager {
  private rooms: Map<string, SessionRoom> = new Map();
  private socketToSession: Map<string, string> = new Map();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  async joinSession(socket: Socket, sessionId: string): Promise<{ success: boolean; error?: string }> {
    const socketData = (socket as any).userData as SocketData;
    
    if (!socketData) {
      return { success: false, error: 'Socket not authenticated' };
    }

    // Check if user has access to this session
    if (!requireSessionAccess(socket, sessionId)) {
      logger.warn('Unauthorized session access attempt', {
        socketId: socket.id,
        userId: socketData.userId,
        sessionId
      });
      return { success: false, error: 'Unauthorized access to session' };
    }

    try {
      // Leave any existing session room
      await this.leaveCurrentSession(socket);

      // Create or get session room
      let room = this.rooms.get(sessionId);
      if (!room) {
        room = {
          sessionId,
          participants: new Set(),
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          metadata: {
            userId: socketData.userId,
            status: 'ACTIVE'
          }
        };
        this.rooms.set(sessionId, room);
        
        logger.info('Created new session room', { sessionId, createdBy: socketData.userId });
      }

      // Join the Socket.IO room
      await socket.join(sessionId);
      
      // Add socket to room tracking
      room.participants.add(socket.id);
      room.lastActivity = new Date().toISOString();
      this.socketToSession.set(socket.id, sessionId);

      // Update socket data
      socketData.sessionId = sessionId;
      updateSocketActivity(socket);

      // Notify other participants
      socket.to(sessionId).emit('participant_joined', {
        id: `participant-${Date.now()}`,
        type: 'participant_joined',
        sessionId,
        userId: socketData.userId,
        timestamp: new Date().toISOString(),
        data: {
          participantCount: room.participants.size,
          joinedUserId: socketData.userId
        }
      });

      logger.info('User joined session room', {
        socketId: socket.id,
        userId: socketData.userId,
        sessionId,
        participantCount: room.participants.size
      });

      return { success: true };

    } catch (error) {
      logger.error('Failed to join session room', {
        error,
        socketId: socket.id,
        sessionId
      });
      return { success: false, error: 'Failed to join session' };
    }
  }

  async leaveCurrentSession(socket: Socket): Promise<void> {
    const currentSessionId = this.socketToSession.get(socket.id);
    
    if (!currentSessionId) {
      return;
    }

    try {
      const room = this.rooms.get(currentSessionId);
      if (room) {
        // Remove from room tracking
        room.participants.delete(socket.id);
        room.lastActivity = new Date().toISOString();

        // Leave Socket.IO room
        await socket.leave(currentSessionId);

        // Get socket data for notification
        const socketData = (socket as any).userData as SocketData;

        // Notify other participants
        socket.to(currentSessionId).emit('participant_left', {
          id: `participant-${Date.now()}`,
          type: 'participant_left',
          sessionId: currentSessionId,
          userId: socketData?.userId,
          timestamp: new Date().toISOString(),
          data: {
            participantCount: room.participants.size,
            leftUserId: socketData?.userId
          }
        });

        // Clean up empty rooms
        if (room.participants.size === 0) {
          this.rooms.delete(currentSessionId);
          logger.info('Cleaned up empty session room', { sessionId: currentSessionId });
        }
      }

      // Remove from socket tracking
      this.socketToSession.delete(socket.id);

      logger.info('User left session room', {
        socketId: socket.id,
        sessionId: currentSessionId,
        remainingParticipants: room?.participants.size || 0
      });

    } catch (error) {
      logger.error('Failed to leave session room', {
        error,
        socketId: socket.id,
        sessionId: currentSessionId
      });
    }
  }

  async disconnectSocket(socket: Socket): Promise<void> {
    await this.leaveCurrentSession(socket);
    
    const socketData = (socket as any).userData as SocketData;
    logger.info('Socket disconnected from session manager', {
      socketId: socket.id,
      userId: socketData?.userId
    });
  }

  getSessionRoom(sessionId: string): SessionRoom | undefined {
    return this.rooms.get(sessionId);
  }

  getSocketSession(socketId: string): string | undefined {
    return this.socketToSession.get(socketId);
  }

  getRoomParticipantCount(sessionId: string): number {
    const room = this.rooms.get(sessionId);
    return room ? room.participants.size : 0;
  }

  getAllRooms(): Map<string, SessionRoom> {
    return new Map(this.rooms);
  }

  async updateSessionStatus(sessionId: string, status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED', currentAgent?: string): Promise<void> {
    const room = this.rooms.get(sessionId);
    if (room) {
      room.metadata.status = status;
      if (currentAgent) {
        room.metadata.currentAgent = currentAgent;
      }
      room.lastActivity = new Date().toISOString();

      // Broadcast status update to all participants
      this.io.to(sessionId).emit('session_status_updated', {
        id: `status-${Date.now()}`,
        type: 'session_status_updated',
        sessionId,
        timestamp: new Date().toISOString(),
        data: {
          status,
          currentAgent,
          participantCount: room.participants.size
        }
      });

      logger.info('Session status updated', {
        sessionId,
        status,
        currentAgent,
        participantCount: room.participants.size
      });
    }
  }

  // Cleanup inactive rooms periodically
  cleanupInactiveRooms(inactivityThresholdMs: number = 2 * 60 * 60 * 1000): void { // 2 hours default
    const now = new Date().getTime();
    const roomsToDelete: string[] = [];

    for (const [sessionId, room] of this.rooms) {
      const lastActivity = new Date(room.lastActivity).getTime();
      if (now - lastActivity > inactivityThresholdMs && room.participants.size === 0) {
        roomsToDelete.push(sessionId);
      }
    }

    roomsToDelete.forEach(sessionId => {
      this.rooms.delete(sessionId);
      logger.info('Cleaned up inactive room', { sessionId });
    });

    if (roomsToDelete.length > 0) {
      logger.info('Room cleanup completed', {
        cleanedRooms: roomsToDelete.length,
        remainingRooms: this.rooms.size
      });
    }
  }
}