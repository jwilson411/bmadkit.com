import { Socket } from 'socket.io';
import { BroadcastService } from '../services/broadcast';
import { logger } from '../utils/logger';
import { updateSocketActivity } from '../middleware/auth';
import { SocketData, EventAck } from '../types/events';

export class DocumentHandler {
  private broadcast: BroadcastService;

  constructor(broadcast: BroadcastService) {
    this.broadcast = broadcast;
  }

  setupHandlers(socket: Socket): void {
    // Document creation/update events
    socket.on('document_updated', async (data: {
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

        // Broadcast document update to all session participants
        await this.broadcast.broadcastDocumentUpdate(socketData.sessionId, data);

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('Document update broadcasted', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: socketData.sessionId,
          documentId: data.documentId,
          documentType: data.documentType,
          status: data.status
        });

      } catch (error) {
        logger.error('Error handling document_updated', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'BROADCAST_FAILED', message: 'Failed to broadcast document update' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Request document status/content
    socket.on('get_document', async (data: { documentId: string }, callback?: (response: any) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData) {
          callback?.({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // In a full implementation, this would fetch from database
        // For now, we'll return a placeholder response
        callback?.({
          success: true,
          data: {
            documentId: data.documentId,
            message: 'Document retrieval not yet implemented - would fetch from database',
            timestamp: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        });

        logger.debug('Document request handled', {
          socketId: socket.id,
          userId: socketData.userId,
          documentId: data.documentId
        });

      } catch (error) {
        logger.error('Error handling get_document', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Document subscription for real-time updates
    socket.on('subscribe_document', async (data: { documentId: string }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData) {
          callback?.({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Join document-specific room for updates
        const documentRoom = `doc:${data.documentId}`;
        await socket.join(documentRoom);

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('User subscribed to document updates', {
          socketId: socket.id,
          userId: socketData.userId,
          documentId: data.documentId
        });

      } catch (error) {
        logger.error('Error handling subscribe_document', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'SUBSCRIPTION_FAILED', message: 'Failed to subscribe to document' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Unsubscribe from document updates
    socket.on('unsubscribe_document', async (data: { documentId: string }, callback?: (ack: EventAck) => void) => {
      updateSocketActivity(socket);
      
      try {
        const documentRoom = `doc:${data.documentId}`;
        await socket.leave(documentRoom);

        callback?.({
          success: true,
          timestamp: new Date().toISOString()
        });

        logger.info('User unsubscribed from document updates', {
          socketId: socket.id,
          documentId: data.documentId
        });

      } catch (error) {
        logger.error('Error handling unsubscribe_document', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'UNSUBSCRIPTION_FAILED', message: 'Failed to unsubscribe from document' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Document export request
    socket.on('export_document', async (data: { 
      documentId: string; 
      format: 'PDF' | 'DOCX' | 'MD' | 'HTML';
      includeMetadata?: boolean;
    }, callback?: (response: any) => void) => {
      updateSocketActivity(socket);
      
      try {
        const socketData = (socket as any).userData as SocketData;
        
        if (!socketData) {
          callback?.({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // In a full implementation, this would trigger document export
        logger.info('Document export requested', {
          socketId: socket.id,
          userId: socketData.userId,
          documentId: data.documentId,
          format: data.format
        });

        callback?.({
          success: true,
          data: {
            documentId: data.documentId,
            format: data.format,
            message: 'Export initiated - would generate and return download link',
            estimatedTime: '30 seconds'
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Error handling export_document', { error, socketId: socket.id });
        callback?.({
          success: false,
          error: { code: 'EXPORT_FAILED', message: 'Failed to initiate document export' },
          timestamp: new Date().toISOString()
        });
      }
    });
  }
}