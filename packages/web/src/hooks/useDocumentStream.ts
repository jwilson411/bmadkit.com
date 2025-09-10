import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { io, Socket } from 'socket.io-client';
import { z } from 'zod';
import type { RootState } from '../store';

// Document update event schema
const DocumentUpdateEventSchema = z.object({
  documentId: z.string(),
  type: z.enum(['SECTION_UPDATED', 'STATUS_CHANGED', 'ERROR_OCCURRED', 'GENERATION_COMPLETE']),
  sectionId: z.string().optional(),
  content: z.string().optional(),
  progress: z.number().optional(),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional(),
  timestamp: z.date().or(z.string().transform(str => new Date(str)))
});

const DocumentSchema = z.object({
  id: z.string(),
  workflowExecutionId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.enum(['DRAFT', 'GENERATING', 'COMPLETED', 'ERROR', 'ARCHIVED']),
  currentVersion: z.number(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    order: z.number(),
    sourceAgentPhase: z.string().optional(),
    lastUpdated: z.date().or(z.string().transform(str => new Date(str))),
    completionPercentage: z.number().min(0).max(100),
    metadata: z.record(z.any()).optional()
  })),
  generationProgress: z.number().min(0).max(100),
  metadata: z.record(z.any()).optional(),
  createdAt: z.date().or(z.string().transform(str => new Date(str))),
  updatedAt: z.date().or(z.string().transform(str => new Date(str)))
});

type DocumentUpdateEvent = z.infer<typeof DocumentUpdateEventSchema>;
type Document = z.infer<typeof DocumentSchema>;

export interface DocumentStreamState {
  isConnected: boolean;
  connectionError: string | null;
  documents: Record<string, Document>;
  recentUpdates: DocumentUpdateEvent[];
  isReconnecting: boolean;
  lastActivity: Date | null;
}

export interface UseDocumentStreamOptions {
  workflowExecutionId?: string;
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  maxRecentUpdates?: number;
  onDocumentUpdate?: (event: DocumentUpdateEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: Error) => void;
}

export interface UseDocumentStreamReturn {
  // Connection state
  isConnected: boolean;
  connectionError: string | null;
  isReconnecting: boolean;
  lastActivity: Date | null;
  
  // Document data
  documents: Document[];
  getDocument: (documentId: string) => Document | null;
  recentUpdates: DocumentUpdateEvent[];
  
  // Actions
  connect: () => void;
  disconnect: () => void;
  subscribeToWorkflow: (workflowExecutionId: string) => void;
  unsubscribeFromWorkflow: (workflowExecutionId: string) => void;
  
  // Manual operations
  refreshDocuments: () => Promise<void>;
  markUpdatesSeen: () => void;
}

export const useDocumentStream = (options: UseDocumentStreamOptions = {}): UseDocumentStreamReturn => {
  const {
    workflowExecutionId,
    autoConnect = true,
    reconnectAttempts = 5,
    reconnectDelay = 2000,
    maxRecentUpdates = 50,
    onDocumentUpdate,
    onConnectionChange,
    onError
  } = options;

  const dispatch = useDispatch();
  
  // Get WebSocket URL from environment or config
  const wsUrl = process.env.VITE_WS_URL || 'http://localhost:3001';
  
  const socketRef = useRef<Socket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<DocumentStreamState>({
    isConnected: false,
    connectionError: null,
    documents: {},
    recentUpdates: [],
    isReconnecting: false,
    lastActivity: null
  });

  // Clear reconnect timeout on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Handle document update events
  const handleDocumentUpdate = useCallback((data: unknown) => {
    try {
      const event = DocumentUpdateEventSchema.parse(data);
      
      setState(prev => {
        const updatedDocuments = { ...prev.documents };
        
        // Update document based on event type
        if (event.documentId && updatedDocuments[event.documentId]) {
          const document = updatedDocuments[event.documentId];
          
          switch (event.type) {
            case 'SECTION_UPDATED':
              if (event.sectionId && event.content) {
                const sectionIndex = document.sections.findIndex(s => s.id === event.sectionId);
                if (sectionIndex >= 0) {
                  document.sections[sectionIndex] = {
                    ...document.sections[sectionIndex],
                    content: event.content,
                    lastUpdated: event.timestamp,
                    completionPercentage: 100
                  };
                }
              }
              break;
              
            case 'STATUS_CHANGED':
              document.status = event.content as any || document.status;
              break;
              
            case 'GENERATION_COMPLETE':
              document.status = 'COMPLETED';
              document.generationProgress = 100;
              break;
          }
          
          if (event.progress !== undefined) {
            document.generationProgress = event.progress;
          }
          
          document.updatedAt = event.timestamp;
        }

        // Add to recent updates (with size limit)
        const newRecentUpdates = [event, ...prev.recentUpdates].slice(0, maxRecentUpdates);

        return {
          ...prev,
          documents: updatedDocuments,
          recentUpdates: newRecentUpdates,
          lastActivity: new Date()
        };
      });

      // Call user callback
      onDocumentUpdate?.(event);
      
    } catch (error) {
      console.error('Error parsing document update:', error);
      onError?.(error as Error);
    }
  }, [maxRecentUpdates, onDocumentUpdate, onError]);

  // Handle document data (full document received)
  const handleDocumentData = useCallback((data: unknown) => {
    try {
      const document = DocumentSchema.parse(data);
      
      setState(prev => ({
        ...prev,
        documents: {
          ...prev.documents,
          [document.id]: document
        },
        lastActivity: new Date()
      }));
      
    } catch (error) {
      console.error('Error parsing document data:', error);
      onError?.(error as Error);
    }
  }, [onError]);

  // Handle connection events
  const handleConnect = useCallback(() => {
    console.log('WebSocket connected');
    reconnectCountRef.current = 0;
    
    setState(prev => ({
      ...prev,
      isConnected: true,
      connectionError: null,
      isReconnecting: false
    }));
    
    onConnectionChange?.(true);

    // Subscribe to workflow if provided
    if (workflowExecutionId) {
      socketRef.current?.emit('subscribe-workflow', { workflowExecutionId });
    }
  }, [workflowExecutionId, onConnectionChange]);

  const handleDisconnect = useCallback((reason: string) => {
    console.log('WebSocket disconnected:', reason);
    
    setState(prev => ({
      ...prev,
      isConnected: false,
      connectionError: reason === 'io server disconnect' ? 'Server disconnected' : null
    }));
    
    onConnectionChange?.(false);

    // Attempt reconnection if not manually disconnected
    if (reason !== 'io client disconnect' && reconnectCountRef.current < reconnectAttempts) {
      setState(prev => ({ ...prev, isReconnecting: true }));
      
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectCountRef.current++;
        console.log(`Reconnection attempt ${reconnectCountRef.current}/${reconnectAttempts}`);
        connect();
      }, reconnectDelay * Math.pow(2, reconnectCountRef.current)); // Exponential backoff
    }
  }, [reconnectAttempts, reconnectDelay, onConnectionChange]);

  const handleConnectError = useCallback((error: Error) => {
    console.error('WebSocket connection error:', error);
    
    setState(prev => ({
      ...prev,
      connectionError: error.message,
      isReconnecting: false
    }));
    
    onError?.(error);
  }, [onError]);

  // Connection management
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    try {
      // Disconnect existing socket
      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      // Create new socket connection
      socketRef.current = io(wsUrl, {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        forceNew: true,
        auth: {
          // Add authentication token if available
          token: localStorage.getItem('authToken')
        }
      });

      // Set up event listeners
      socketRef.current.on('connect', handleConnect);
      socketRef.current.on('disconnect', handleDisconnect);
      socketRef.current.on('connect_error', handleConnectError);
      socketRef.current.on('document-update', handleDocumentUpdate);
      socketRef.current.on('document-data', handleDocumentData);

      // Additional error handling
      socketRef.current.on('error', (error: Error) => {
        console.error('Socket error:', error);
        onError?.(error);
      });

    } catch (error) {
      console.error('Failed to create socket connection:', error);
      handleConnectError(error as Error);
    }
  }, [wsUrl, handleConnect, handleDisconnect, handleConnectError, handleDocumentUpdate, handleDocumentData, onError]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    reconnectCountRef.current = reconnectAttempts; // Prevent automatic reconnection
    
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    setState(prev => ({
      ...prev,
      isConnected: false,
      isReconnecting: false
    }));
  }, [reconnectAttempts]);

  // Workflow subscription management
  const subscribeToWorkflow = useCallback((workflowId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe-workflow', { workflowExecutionId: workflowId });
      console.log('Subscribed to workflow:', workflowId);
    }
  }, []);

  const unsubscribeFromWorkflow = useCallback((workflowId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe-workflow', { workflowExecutionId: workflowId });
      console.log('Unsubscribed from workflow:', workflowId);
    }
  }, []);

  // Manual data refresh
  const refreshDocuments = useCallback(async () => {
    if (socketRef.current?.connected && workflowExecutionId) {
      socketRef.current.emit('request-documents', { workflowExecutionId });
    }
  }, [workflowExecutionId]);

  // Utility functions
  const getDocument = useCallback((documentId: string): Document | null => {
    return state.documents[documentId] || null;
  }, [state.documents]);

  const markUpdatesSeen = useCallback(() => {
    setState(prev => ({
      ...prev,
      recentUpdates: []
    }));
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    // Connection state
    isConnected: state.isConnected,
    connectionError: state.connectionError,
    isReconnecting: state.isReconnecting,
    lastActivity: state.lastActivity,
    
    // Document data
    documents: Object.values(state.documents),
    getDocument,
    recentUpdates: state.recentUpdates,
    
    // Actions
    connect,
    disconnect,
    subscribeToWorkflow,
    unsubscribeFromWorkflow,
    
    // Manual operations
    refreshDocuments,
    markUpdatesSeen
  };
};

export default useDocumentStream;