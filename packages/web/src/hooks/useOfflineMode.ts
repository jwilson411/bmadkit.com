import React, { useState, useEffect, useCallback } from 'react';
import { errorReporter } from '../utils/error-reporter';

export interface OfflineData {
  sessionId: string;
  lastSync: string;
  pendingChanges: Array<{
    id: string;
    type: 'message' | 'form' | 'document' | 'planning';
    data: any;
    timestamp: string;
  }>;
  conversationState: {
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
      synced: boolean;
    }>;
  };
  formData: Record<string, any>;
  documentState: Record<string, any>;
}

export interface SyncResult {
  success: boolean;
  syncedItems: number;
  failedItems: number;
  errors: Array<{
    id: string;
    error: string;
  }>;
  conflicts: Array<{
    id: string;
    localData: any;
    serverData: any;
    resolved?: boolean;
  }>;
}

export function useOfflineMode(sessionId?: string) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineData, setOfflineData] = useState<OfflineData | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingChangesCount, setPendingChangesCount] = useState(0);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);

  // Initialize offline storage and sync on mount
  useEffect(() => {
    if (sessionId) {
      initializeOfflineStorage(sessionId);
      attemptSync(sessionId);
    }
  }, [sessionId]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log('Connection restored, attempting sync...');
      if (sessionId) {
        attemptSync(sessionId);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log('Connection lost, entering offline mode');
      showOfflineNotification();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also monitor connection with periodic checks
    const connectionCheckInterval = setInterval(checkConnection, 30000); // Every 30 seconds

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(connectionCheckInterval);
    };
  }, [sessionId]);

  const initializeOfflineStorage = useCallback(async (sessionId: string) => {
    try {
      const storedData = localStorage.getItem(`offline_data_${sessionId}`);
      if (storedData) {
        const data = JSON.parse(storedData);
        setOfflineData(data);
        setPendingChangesCount(data.pendingChanges.length);
      } else {
        // Initialize empty offline storage
        const initialData: OfflineData = {
          sessionId,
          lastSync: new Date().toISOString(),
          pendingChanges: [],
          conversationState: {
            messages: []
          },
          formData: {},
          documentState: {}
        };
        setOfflineData(initialData);
        localStorage.setItem(`offline_data_${sessionId}`, JSON.stringify(initialData));
      }
    } catch (error) {
      console.error('Failed to initialize offline storage:', error);
    }
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-cache'
      });
      
      const connectionStatus = response.ok;
      
      if (connectionStatus !== isOnline) {
        setIsOnline(connectionStatus);
        
        if (connectionStatus && sessionId) {
          console.log('Connection detected via health check, attempting sync...');
          attemptSync(sessionId);
        }
      }
    } catch (error) {
      // Network error means we're offline
      if (isOnline) {
        setIsOnline(false);
        console.log('Connection lost detected via health check');
      }
    }
  }, [isOnline, sessionId]);

  const saveOfflineData = useCallback((sessionId: string, data: OfflineData) => {
    try {
      localStorage.setItem(`offline_data_${sessionId}`, JSON.stringify(data));
      setOfflineData(data);
      setPendingChangesCount(data.pendingChanges.length);
    } catch (error) {
      console.error('Failed to save offline data:', error);
      errorReporter.captureException(error as Error, {
        level: 'component',
        errorId: `offline-save-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: { sessionId }
      });
    }
  }, []);

  const addPendingChange = useCallback((
    sessionId: string,
    type: 'message' | 'form' | 'document' | 'planning',
    data: any
  ) => {
    if (!offlineData) return;

    const change = {
      id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      timestamp: new Date().toISOString()
    };

    const updatedData = {
      ...offlineData,
      pendingChanges: [...offlineData.pendingChanges, change]
    };

    // Also update local state based on change type
    if (type === 'message') {
      updatedData.conversationState.messages.push({
        ...data,
        synced: false
      });
    } else if (type === 'form') {
      updatedData.formData = { ...updatedData.formData, ...data };
    } else if (type === 'document') {
      updatedData.documentState = { ...updatedData.documentState, ...data };
    }

    saveOfflineData(sessionId, updatedData);

    // Auto-sync if online
    if (isOnline) {
      setTimeout(() => attemptSync(sessionId), 1000); // Debounce sync attempts
    }
  }, [offlineData, saveOfflineData, isOnline]);

  const attemptSync = useCallback(async (sessionId: string) => {
    if (!offlineData || isSyncing || !isOnline) return;

    if (offlineData.pendingChanges.length === 0) {
      console.log('No pending changes to sync');
      return;
    }

    setIsSyncing(true);
    setSyncErrors([]);

    try {
      console.log(`Attempting to sync ${offlineData.pendingChanges.length} pending changes`);

      const response = await fetch(`/api/sessions/${sessionId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lastSync: offlineData.lastSync,
          pendingChanges: offlineData.pendingChanges,
          currentState: {
            conversationState: offlineData.conversationState,
            formData: offlineData.formData,
            documentState: offlineData.documentState
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status} ${response.statusText}`);
      }

      const result: SyncResult = await response.json();

      if (result.success) {
        // Update offline data to remove synced items
        const syncedChangeIds = new Set(
          offlineData.pendingChanges.slice(0, result.syncedItems).map(change => change.id)
        );

        const updatedData: OfflineData = {
          ...offlineData,
          lastSync: new Date().toISOString(),
          pendingChanges: offlineData.pendingChanges.filter(
            change => !syncedChangeIds.has(change.id)
          ),
          conversationState: {
            messages: offlineData.conversationState.messages.map(msg => ({
              ...msg,
              synced: syncedChangeIds.has(msg.id) ? true : msg.synced
            }))
          }
        };

        saveOfflineData(sessionId, updatedData);
        setLastSyncTime(new Date());

        console.log(`Sync completed: ${result.syncedItems} items synced, ${result.failedItems} failed`);

        // Handle conflicts if any
        if (result.conflicts.length > 0) {
          handleSyncConflicts(sessionId, result.conflicts);
        }
      } else {
        throw new Error('Sync operation failed');
      }

      if (result.errors.length > 0) {
        const errorMessages = result.errors.map(err => err.error);
        setSyncErrors(errorMessages);
        console.warn('Sync completed with errors:', errorMessages);
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncErrors([`Sync failed: ${(error as Error).message}`]);
      
      errorReporter.captureException(error as Error, {
        level: 'component',
        errorId: `sync-failed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        context: { 
          sessionId, 
          pendingChanges: offlineData.pendingChanges.length,
          isOnline 
        }
      });
    } finally {
      setIsSyncing(false);
    }
  }, [offlineData, isSyncing, isOnline, saveOfflineData]);

  const handleSyncConflicts = useCallback(async (
    sessionId: string,
    conflicts: Array<{ id: string; localData: any; serverData: any }>
  ) => {
    console.log(`Handling ${conflicts.length} sync conflicts`);

    // Simple conflict resolution: server wins for now
    // In a real app, you'd want more sophisticated conflict resolution
    for (const conflict of conflicts) {
      console.log(`Resolving conflict for ${conflict.id}: using server data`);
      
      // Update local data with server data
      if (conflict.serverData) {
        // Emit event for components to handle conflict resolution
        const event = new CustomEvent('sync-conflict-resolved', {
          detail: {
            conflictId: conflict.id,
            resolution: 'server-wins',
            serverData: conflict.serverData,
            localData: conflict.localData
          }
        });
        window.dispatchEvent(event);
      }
    }
  }, []);

  const showOfflineNotification = useCallback(() => {
    // Show user-friendly offline notification
    const event = new CustomEvent('offline-mode-activated', {
      detail: {
        message: 'You\'re now working offline. Your changes will sync when connection is restored.',
        actions: [
          { label: 'Continue Working', action: () => {} },
          { label: 'Retry Connection', action: () => checkConnection() }
        ]
      }
    });
    window.dispatchEvent(event);
  }, [checkConnection]);

  const forceSyncNow = useCallback(() => {
    if (sessionId && isOnline) {
      attemptSync(sessionId);
    } else if (!isOnline) {
      setSyncErrors(['Cannot sync while offline. Please check your connection.']);
    }
  }, [sessionId, isOnline, attemptSync]);

  const clearOfflineData = useCallback((sessionId: string) => {
    try {
      localStorage.removeItem(`offline_data_${sessionId}`);
      setOfflineData(null);
      setPendingChangesCount(0);
      console.log('Offline data cleared');
    } catch (error) {
      console.error('Failed to clear offline data:', error);
    }
  }, []);

  // Public API for components to use
  const saveMessage = useCallback((message: { role: 'user' | 'assistant'; content: string }) => {
    if (sessionId) {
      addPendingChange(sessionId, 'message', {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...message,
        timestamp: new Date().toISOString()
      });
    }
  }, [sessionId, addPendingChange]);

  const saveFormData = useCallback((formData: Record<string, any>) => {
    if (sessionId) {
      addPendingChange(sessionId, 'form', formData);
    }
  }, [sessionId, addPendingChange]);

  const saveDocumentState = useCallback((documentState: Record<string, any>) => {
    if (sessionId) {
      addPendingChange(sessionId, 'document', documentState);
    }
  }, [sessionId, addPendingChange]);

  const savePlanningData = useCallback((planningData: Record<string, any>) => {
    if (sessionId) {
      addPendingChange(sessionId, 'planning', planningData);
    }
  }, [sessionId, addPendingChange]);

  return {
    // Connection state
    isOnline,
    
    // Offline data
    offlineData,
    pendingChangesCount,
    lastSyncTime,
    
    // Sync state
    isSyncing,
    syncErrors,
    
    // Actions
    saveMessage,
    saveFormData,
    saveDocumentState,
    savePlanningData,
    forceSyncNow,
    clearOfflineData,
    
    // Utilities
    checkConnection
  };
}