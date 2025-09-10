import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { io, Socket } from 'socket.io-client';
import type { AppDispatch } from '@/store';
import {
  setConnectionStatus,
  handleProgressUpdate,
  handleAgentStatusChange,
  handleDocumentUpdate,
  addConversationMessage,
  selectCurrentSession,
  selectConnectionStatus
} from '@/store/sessionSlice';
import type { WebSocketMessage, ConversationMessage } from '@/types/session';

interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

interface UseWebSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  isConnecting: boolean;
  connect: (sessionId: string, token?: string) => void;
  disconnect: () => void;
  emit: <T = any>(event: string, data?: T, callback?: (response: any) => void) => void;
  joinSession: (sessionId: string) => Promise<boolean>;
  leaveSession: () => Promise<boolean>;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    autoConnect = true,
    reconnectAttempts = 5,
    reconnectDelay = 1000
  } = options;

  const dispatch = useDispatch<AppDispatch>();
  const currentSession = useSelector(selectCurrentSession);
  const connectionStatus = useSelector(selectConnectionStatus);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  // WebSocket URL from environment or default
  const getWebSocketUrl = useCallback(() => {
    return import.meta.env.VITE_WEBSOCKET_URL || 'http://localhost:3002';
  }, []);

  // Get auth token from localStorage or session
  const getAuthToken = useCallback(() => {
    return localStorage.getItem('authToken') || 
           sessionStorage.getItem('authToken') || 
           undefined;
  }, []);

  // Connect to WebSocket server
  const connect = useCallback((sessionId: string, token?: string) => {
    if (socketRef.current?.connected) {
      console.log('WebSocket already connected');
      return;
    }

    dispatch(setConnectionStatus('connecting'));

    const wsUrl = getWebSocketUrl();
    const authToken = token || getAuthToken();
    
    // Create anonymous session token if no auth token
    const connectionToken = authToken || `anonymous:${sessionId}:${Date.now()}`;

    const socket = io(wsUrl, {
      auth: { token: connectionToken },
      query: { sessionId },
      transports: ['websocket', 'polling'],
      timeout: 20000,
      reconnectionAttempts: reconnectAttempts,
      reconnectionDelay: reconnectDelay,
      reconnectionDelayMax: 5000,
    });

    // Connection event handlers
    socket.on('connect', () => {
      console.log('WebSocket connected:', socket.id);
      dispatch(setConnectionStatus('connected'));
      
      // Clear any reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      dispatch(setConnectionStatus('disconnected'));
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      dispatch(setConnectionStatus('disconnected'));
    });

    socket.on('reconnect_attempt', (attempt) => {
      console.log(`WebSocket reconnection attempt ${attempt}`);
      dispatch(setConnectionStatus('reconnecting'));
    });

    socket.on('reconnect', (attempt) => {
      console.log(`WebSocket reconnected after ${attempt} attempts`);
      dispatch(setConnectionStatus('connected'));
    });

    socket.on('reconnect_failed', () => {
      console.error('WebSocket reconnection failed');
      dispatch(setConnectionStatus('disconnected'));
    });

    // Session event handlers
    socket.on('session_joined', (data) => {
      console.log('Session joined:', data);
    });

    socket.on('session_status_updated', (data) => {
      console.log('Session status updated:', data);
    });

    socket.on('participant_joined', (data) => {
      console.log('Participant joined:', data);
    });

    socket.on('participant_left', (data) => {
      console.log('Participant left:', data);
    });

    // Real-time update handlers
    socket.on('progress_updated', (data: WebSocketMessage) => {
      if (data.type === 'progress_updated') {
        dispatch(handleProgressUpdate(data.data));
      }
    });

    socket.on('agent_status_changed', (data: WebSocketMessage) => {
      if (data.type === 'agent_status_changed') {
        dispatch(handleAgentStatusChange(data.data));
        
        // Add system message about agent change
        const message: ConversationMessage = {
          id: data.id,
          type: 'system',
          content: `${data.data.currentAgent} is now ${data.data.status.toLowerCase()}: ${data.data.task}`,
          agentType: data.data.currentAgent,
          timestamp: data.timestamp
        };
        dispatch(addConversationMessage(message));
      }
    });

    socket.on('document_updated', (data: WebSocketMessage) => {
      if (data.type === 'document_updated') {
        dispatch(handleDocumentUpdate(data.data));
        
        // Add system message about document update
        const message: ConversationMessage = {
          id: data.id,
          type: 'system',
          content: `Document updated: ${data.data.title} (${data.data.documentType})`,
          timestamp: data.timestamp
        };
        dispatch(addConversationMessage(message));
      }
    });

    socket.on('session_started', (data: WebSocketMessage) => {
      console.log('Session started:', data);
      
      const message: ConversationMessage = {
        id: data.id,
        type: 'system',
        content: 'Planning session started. Our AI experts are analyzing your project...',
        timestamp: data.timestamp
      };
      dispatch(addConversationMessage(message));
    });

    socket.on('session_completed', (data: WebSocketMessage) => {
      console.log('Session completed:', data);
      
      const message: ConversationMessage = {
        id: data.id,
        type: 'system',
        content: `Session completed! Generated ${data.data.documentsGenerated.length} documents in ${Math.round(data.data.totalDuration / 60)} minutes.`,
        timestamp: data.timestamp
      };
      dispatch(addConversationMessage(message));
    });

    socket.on('error_occurred', (data: WebSocketMessage) => {
      console.error('Session error:', data);
      
      const message: ConversationMessage = {
        id: data.id,
        type: 'system',
        content: `Error: ${data.data.message}. ${data.data.recoveryOptions?.[0]?.description || 'Please try again.'}`,
        timestamp: data.timestamp
      };
      dispatch(addConversationMessage(message));
    });

    // Connection quality and network events
    socket.on('rate_limit_warning', (data) => {
      console.warn('Rate limit warning:', data);
    });

    socket.on('connection_status', (data: WebSocketMessage) => {
      console.log('Connection status update:', data);
    });

    socketRef.current = socket;
  }, [dispatch, getWebSocketUrl, getAuthToken, reconnectAttempts, reconnectDelay]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      dispatch(setConnectionStatus('disconnected'));
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  }, [dispatch]);

  // Emit event to server
  const emit = useCallback(<T = any>(event: string, data?: T, callback?: (response: any) => void) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data, callback);
    } else {
      console.warn('Cannot emit event: WebSocket not connected');
    }
  }, []);

  // Join a session room
  const joinSession = useCallback(async (sessionId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve(false);
        return;
      }

      socketRef.current.emit('join_session', { sessionId }, (response: any) => {
        if (response.success) {
          console.log('Successfully joined session:', sessionId);
          resolve(true);
        } else {
          console.error('Failed to join session:', response.error);
          resolve(false);
        }
      });
    });
  }, []);

  // Leave current session
  const leaveSession = useCallback(async (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve(false);
        return;
      }

      socketRef.current.emit('leave_session', (response: any) => {
        if (response.success) {
          console.log('Successfully left session');
          resolve(true);
        } else {
          console.error('Failed to leave session:', response.error);
          resolve(false);
        }
      });
    });
  }, []);

  // Auto-connect when session is available
  useEffect(() => {
    if (autoConnect && currentSession && connectionStatus === 'disconnected') {
      connect(currentSession.id);
    }
  }, [autoConnect, currentSession, connectionStatus, connect]);

  // Auto-join session when connected
  useEffect(() => {
    if (currentSession && connectionStatus === 'connected' && socketRef.current) {
      joinSession(currentSession.id);
    }
  }, [currentSession, connectionStatus, joinSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    socket: socketRef.current,
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting',
    connect,
    disconnect,
    emit,
    joinSession,
    leaveSession,
  };
}