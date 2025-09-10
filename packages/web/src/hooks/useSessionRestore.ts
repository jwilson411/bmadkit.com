import React, { useEffect, useCallback, useState } from 'react';
import { errorReporter } from '../utils/error-reporter';

export interface SessionState {
  sessionId: string;
  conversationState: {
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
      messageId: string;
    }>;
    currentStep: string;
    planningContext: Record<string, any>;
    documentState: Record<string, any>;
  };
  userInteractions: {
    lastActivity: string;
    currentPage: string;
    formData: Record<string, any>;
    unsavedChanges: boolean;
  };
}

export interface RecoveryPoint {
  id: string;
  timestamp: string;
  type: 'auto' | 'manual' | 'checkpoint';
  description: string;
}

export interface SessionRestoreResult {
  success: boolean;
  restoredState?: SessionState;
  recoveryPoint?: RecoveryPoint;
  conflictsDetected?: boolean;
  error?: string;
}

export function useSessionRestore(sessionId?: string) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryPoint[]>([]);
  const [currentSessionState, setCurrentSessionState] = useState<SessionState | null>(null);
  const [restorationHistory, setRestorationHistory] = useState<SessionRestoreResult[]>([]);

  // Check for interrupted sessions on mount
  useEffect(() => {
    if (sessionId) {
      checkForInterruptedSession(sessionId);
      loadRecoveryPoints(sessionId);
    }
  }, [sessionId]);

  const checkForInterruptedSession = useCallback(async (sessionId: string) => {
    try {
      // Check if browser was closed unexpectedly
      const wasInterrupted = await detectSessionInterruption(sessionId);
      
      if (wasInterrupted) {
        console.log('Session interruption detected, preparing recovery options');
        await loadRecoveryPoints(sessionId);
        
        // Notify user about available recovery
        const event = new CustomEvent('session-recovery-available', {
          detail: { sessionId, hasRecoveryPoints: recoveryPoints.length > 0 }
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.warn('Failed to check for interrupted session:', error);
    }
  }, [recoveryPoints.length]);

  const detectSessionInterruption = async (sessionId: string): Promise<boolean> => {
    try {
      // Check various indicators of interruption
      const lastActivity = localStorage.getItem(`session_activity_${sessionId}`);
      const sessionEndFlag = sessionStorage.getItem(`session_ended_${sessionId}`);
      const windowCloseTime = localStorage.getItem(`window_close_${sessionId}`);
      
      // If session ended normally, no interruption
      if (sessionEndFlag === 'normal') {
        return false;
      }
      
      // If last activity was recent and no normal end, likely interrupted
      if (lastActivity) {
        const lastTime = parseInt(lastActivity);
        const timeDiff = Date.now() - lastTime;
        
        // If last activity was within 5 minutes and no normal end
        if (timeDiff < 300000 && !sessionEndFlag) {
          return true;
        }
      }
      
      // Check if there are unsaved changes
      const unsavedChanges = localStorage.getItem(`unsaved_changes_${sessionId}`);
      if (unsavedChanges === 'true') {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error detecting session interruption:', error);
      return false;
    }
  };

  const loadRecoveryPoints = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/recovery-points`);
      if (response.ok) {
        const points = await response.json();
        setRecoveryPoints(points);
      }
    } catch (error) {
      console.error('Failed to load recovery points:', error);
      errorReporter.captureException(error as Error, {
        level: 'component',
        errorId: `recovery-points-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: { sessionId }
      });
    }
  }, []);

  const restoreFromPoint = useCallback(async (
    sessionId: string,
    recoveryPointId?: string
  ): Promise<SessionRestoreResult> => {
    setIsRestoring(true);
    
    try {
      const response = await fetch(`/api/sessions/${sessionId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recoveryPointId,
          currentState: currentSessionState
        })
      });

      if (!response.ok) {
        throw new Error(`Restore failed: ${response.status} ${response.statusText}`);
      }

      const result: SessionRestoreResult = await response.json();
      
      if (result.success && result.restoredState) {
        // Apply restored state to current session
        await applyRestoredState(result.restoredState);
        
        // Clear interruption flags
        localStorage.removeItem(`unsaved_changes_${sessionId}`);
        sessionStorage.setItem(`session_ended_${sessionId}`, 'restored');
        
        console.log('Session successfully restored from recovery point:', recoveryPointId);
      }

      // Track restoration attempt
      setRestorationHistory(prev => [result, ...prev.slice(0, 9)]); // Keep last 10
      
      return result;
    } catch (error) {
      const errorResult: SessionRestoreResult = {
        success: false,
        error: (error as Error).message
      };
      
      setRestorationHistory(prev => [errorResult, ...prev.slice(0, 9)]);
      
      errorReporter.captureException(error as Error, {
        level: 'component',
        errorId: `session-restore-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: { sessionId, recoveryPointId }
      });
      
      return errorResult;
    } finally {
      setIsRestoring(false);
    }
  }, [currentSessionState]);

  const applyRestoredState = async (restoredState: SessionState) => {
    try {
      // Restore conversation messages
      if (restoredState.conversationState.messages) {
        const event = new CustomEvent('restore-conversation', {
          detail: { messages: restoredState.conversationState.messages }
        });
        window.dispatchEvent(event);
      }

      // Restore form data
      if (restoredState.userInteractions.formData) {
        const event = new CustomEvent('restore-form-data', {
          detail: { formData: restoredState.userInteractions.formData }
        });
        window.dispatchEvent(event);
      }

      // Restore planning context
      if (restoredState.conversationState.planningContext) {
        const event = new CustomEvent('restore-planning-context', {
          detail: { context: restoredState.conversationState.planningContext }
        });
        window.dispatchEvent(event);
      }

      // Navigate to last page if different
      if (restoredState.userInteractions.currentPage && 
          restoredState.userInteractions.currentPage !== window.location.pathname) {
        window.history.pushState({}, '', restoredState.userInteractions.currentPage);
      }

      setCurrentSessionState(restoredState);
    } catch (error) {
      console.error('Failed to apply restored state:', error);
      throw error;
    }
  };

  const createManualBackup = useCallback(async (
    sessionId: string,
    description: string = 'Manual backup'
  ): Promise<string> => {
    try {
      // Capture current state
      const currentState = await captureCurrentState(sessionId);
      
      const response = await fetch(`/api/sessions/${sessionId}/backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'manual',
          description,
          state: currentState
        })
      });

      if (!response.ok) {
        throw new Error(`Backup failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Refresh recovery points
      await loadRecoveryPoints(sessionId);
      
      return result.backupId;
    } catch (error) {
      errorReporter.captureException(error as Error, {
        level: 'component',
        errorId: `manual-backup-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: { sessionId, description }
      });
      throw error;
    }
  }, [loadRecoveryPoints]);

  const captureCurrentState = async (sessionId: string): Promise<SessionState> => {
    // Gather current state from various sources
    const messages = getConversationMessages();
    const formData = getFormData();
    const planningContext = getPlanningContext();
    const documentState = getDocumentState();

    return {
      sessionId,
      conversationState: {
        messages: messages || [],
        currentStep: getCurrentStep() || 'planning',
        planningContext: planningContext || {},
        documentState: documentState || {}
      },
      userInteractions: {
        lastActivity: new Date().toISOString(),
        currentPage: window.location.pathname,
        formData: formData || {},
        unsavedChanges: hasUnsavedChanges()
      }
    };
  };

  // Helper functions to gather state from the application
  const getConversationMessages = () => {
    // Get messages from conversation context/state
    const messagesElement = document.querySelector('[data-conversation-messages]');
    if (messagesElement) {
      try {
        return JSON.parse(messagesElement.getAttribute('data-conversation-messages') || '[]');
      } catch {
        return [];
      }
    }
    return [];
  };

  const getFormData = () => {
    // Collect form data from all forms on the page
    const forms = document.querySelectorAll('form');
    const formData: Record<string, any> = {};
    
    forms.forEach((form, index) => {
      const data = new FormData(form);
      const formObject: Record<string, any> = {};
      
      for (const [key, value] of data.entries()) {
        formObject[key] = value;
      }
      
      if (Object.keys(formObject).length > 0) {
        formData[`form_${index}`] = formObject;
      }
    });
    
    return formData;
  };

  const getPlanningContext = () => {
    // Get planning context from application state
    const contextElement = document.querySelector('[data-planning-context]');
    if (contextElement) {
      try {
        return JSON.parse(contextElement.getAttribute('data-planning-context') || '{}');
      } catch {
        return {};
      }
    }
    return {};
  };

  const getDocumentState = () => {
    // Get document state from application
    const docElement = document.querySelector('[data-document-state]');
    if (docElement) {
      try {
        return JSON.parse(docElement.getAttribute('data-document-state') || '{}');
      } catch {
        return {};
      }
    }
    return {};
  };

  const getCurrentStep = () => {
    // Get current step from URL or application state
    const stepElement = document.querySelector('[data-current-step]');
    if (stepElement) {
      return stepElement.getAttribute('data-current-step');
    }
    return 'planning';
  };

  const hasUnsavedChanges = () => {
    // Check if there are unsaved changes
    return document.querySelectorAll('[data-unsaved]').length > 0;
  };

  // Track user activity for interruption detection
  useEffect(() => {
    if (!sessionId) return;

    const trackActivity = () => {
      localStorage.setItem(`session_activity_${sessionId}`, Date.now().toString());
    };

    const trackUnsavedChanges = () => {
      if (hasUnsavedChanges()) {
        localStorage.setItem(`unsaved_changes_${sessionId}`, 'true');
      } else {
        localStorage.removeItem(`unsaved_changes_${sessionId}`);
      }
    };

    // Track activity
    const activityEvents = ['click', 'keypress', 'scroll', 'input'];
    activityEvents.forEach(event => {
      document.addEventListener(event, trackActivity);
    });

    // Track unsaved changes
    const changeEvents = ['input', 'change'];
    changeEvents.forEach(event => {
      document.addEventListener(event, trackUnsavedChanges);
    });

    // Track normal session end
    const handleBeforeUnload = () => {
      sessionStorage.setItem(`session_ended_${sessionId}`, 'normal');
      localStorage.setItem(`window_close_${sessionId}`, Date.now().toString());
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, trackActivity);
      });
      changeEvents.forEach(event => {
        document.removeEventListener(event, trackUnsavedChanges);
      });
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [sessionId]);

  return {
    isRestoring,
    recoveryPoints,
    currentSessionState,
    restorationHistory,
    restoreFromPoint,
    createManualBackup,
    loadRecoveryPoints,
    checkForInterruptedSession
  };
}