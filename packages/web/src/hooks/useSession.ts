import { useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '@/store';
import {
  createSession,
  resumeSession,
  clearSession,
  selectCurrentSession,
  selectIsLoading,
  selectError,
  selectConnectionStatus
} from '@/store/sessionSlice';
import type { SessionCreationRequest } from '@/types/session';

interface UseSessionOptions {
  autoRestore?: boolean;
  persistToStorage?: boolean;
}

interface UseSessionReturn {
  currentSession: ReturnType<typeof selectCurrentSession>;
  isLoading: boolean;
  error: string | undefined;
  connectionStatus: ReturnType<typeof selectConnectionStatus>;
  createNewSession: (request: SessionCreationRequest) => Promise<void>;
  resumeExistingSession: (sessionId: string) => Promise<void>;
  endCurrentSession: () => void;
  restoreSession: () => Promise<void>;
  isSessionActive: boolean;
  sessionId: string | undefined;
}

export function useSession(options: UseSessionOptions = {}): UseSessionReturn {
  const { autoRestore = true, persistToStorage = true } = options;
  
  const dispatch = useDispatch<AppDispatch>();
  const currentSession = useSelector(selectCurrentSession);
  const isLoading = useSelector(selectIsLoading);
  const error = useSelector(selectError);
  const connectionStatus = useSelector(selectConnectionStatus);

  // Get session info from localStorage
  const getStoredSessionInfo = useCallback(() => {
    try {
      const stored = localStorage.getItem('anonymousSession');
      if (stored) {
        return JSON.parse(stored);
      }
      return null;
    } catch (error) {
      console.error('Failed to parse stored session info:', error);
      return null;
    }
  }, []);

  // Store session info to localStorage
  const storeSessionInfo = useCallback((sessionId: string, projectInput: string) => {
    if (persistToStorage) {
      try {
        const sessionInfo = {
          sessionId,
          createdAt: new Date().toISOString(),
          projectInput,
          lastAccessed: new Date().toISOString()
        };
        localStorage.setItem('anonymousSession', JSON.stringify(sessionInfo));
      } catch (error) {
        console.error('Failed to store session info:', error);
      }
    }
  }, [persistToStorage]);

  // Clear stored session info
  const clearStoredSessionInfo = useCallback(() => {
    try {
      localStorage.removeItem('anonymousSession');
    } catch (error) {
      console.error('Failed to clear stored session info:', error);
    }
  }, []);

  // Create a new session
  const createNewSession = useCallback(async (request: SessionCreationRequest) => {
    try {
      const result = await dispatch(createSession(request)).unwrap();
      
      // Store session info for anonymous users
      if (request.anonymous && result.session.id) {
        storeSessionInfo(result.session.id, request.projectInput);
      }
      
      return result;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  }, [dispatch, storeSessionInfo]);

  // Resume an existing session
  const resumeExistingSession = useCallback(async (sessionId: string) => {
    try {
      await dispatch(resumeSession(sessionId)).unwrap();
      
      // Update last accessed time
      const storedInfo = getStoredSessionInfo();
      if (storedInfo && storedInfo.sessionId === sessionId) {
        storeSessionInfo(sessionId, storedInfo.projectInput);
      }
    } catch (error) {
      console.error('Failed to resume session:', error);
      // If session doesn't exist or failed to resume, clear stored info
      clearStoredSessionInfo();
      throw error;
    }
  }, [dispatch, getStoredSessionInfo, storeSessionInfo, clearStoredSessionInfo]);

  // End current session
  const endCurrentSession = useCallback(() => {
    dispatch(clearSession());
    clearStoredSessionInfo();
  }, [dispatch, clearStoredSessionInfo]);

  // Restore session from localStorage
  const restoreSession = useCallback(async () => {
    const storedInfo = getStoredSessionInfo();
    
    if (storedInfo && storedInfo.sessionId) {
      try {
        await resumeExistingSession(storedInfo.sessionId);
      } catch (error) {
        console.log('Failed to restore session, starting fresh');
        // Don't throw error, just start fresh
      }
    }
  }, [getStoredSessionInfo, resumeExistingSession]);

  // Check if session is active
  const isSessionActive = Boolean(
    currentSession && 
    currentSession.status === 'ACTIVE' &&
    connectionStatus !== 'disconnected'
  );

  // Get current session ID
  const sessionId = currentSession?.id;

  // Auto-restore session on mount
  useEffect(() => {
    if (autoRestore && !currentSession && !isLoading) {
      restoreSession();
    }
  }, [autoRestore, currentSession, isLoading, restoreSession]);

  // Update stored session access time when session becomes active
  useEffect(() => {
    if (currentSession && persistToStorage) {
      const storedInfo = getStoredSessionInfo();
      if (storedInfo && storedInfo.sessionId === currentSession.id) {
        storeSessionInfo(currentSession.id, storedInfo.projectInput);
      }
    }
  }, [currentSession, persistToStorage, getStoredSessionInfo, storeSessionInfo]);

  // Cleanup on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Update last accessed time before leaving
      if (currentSession) {
        const storedInfo = getStoredSessionInfo();
        if (storedInfo && storedInfo.sessionId === currentSession.id) {
          storeSessionInfo(currentSession.id, storedInfo.projectInput);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentSession, getStoredSessionInfo, storeSessionInfo]);

  return {
    currentSession,
    isLoading,
    error,
    connectionStatus,
    createNewSession,
    resumeExistingSession,
    endCurrentSession,
    restoreSession,
    isSessionActive,
    sessionId,
  };
}