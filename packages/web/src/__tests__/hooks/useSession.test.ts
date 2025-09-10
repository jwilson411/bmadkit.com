import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import sessionReducer from '@/store/sessionSlice';
import { useSession } from '@/hooks/useSession';
import { localStorageMock } from '@/test/setup';

// Mock API
const mockCreateSession = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/services/api', () => ({
  sessionApi: {
    createSession: mockCreateSession,
    getSession: mockGetSession,
  }
}));

const createTestStore = () =>
  configureStore({
    reducer: {
      session: sessionReducer,
    },
  });

const renderUseSession = (options = {}) => {
  const store = createTestStore();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  return {
    ...renderHook(() => useSession(options), { wrapper }),
    store,
  };
};

describe('useSession Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockCreateSession.mockClear();
    mockGetSession.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('initializes with default state', () => {
    const { result } = renderUseSession();

    expect(result.current.currentSession).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.isSessionActive).toBe(false);
    expect(result.current.sessionId).toBeUndefined();
  });

  it('creates a new session', async () => {
    const mockSession = {
      id: 'test-session-123',
      projectInput: 'Test project',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Analysis',
        agentSequence: ['ANALYST'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockCreateSession.mockResolvedValue({
      data: {
        session: mockSession,
        followUpQuestions: []
      }
    });

    const { result } = renderUseSession();

    await result.current.createNewSession({
      projectInput: 'Test project',
      anonymous: true
    });

    await waitFor(() => {
      expect(result.current.currentSession).toEqual(mockSession);
      expect(result.current.sessionId).toBe('test-session-123');
    });

    expect(mockCreateSession).toHaveBeenCalledWith({
      projectInput: 'Test project',
      anonymous: true
    });

    // Should store session info for anonymous users
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'anonymousSession',
      expect.stringContaining('"sessionId":"test-session-123"')
    );
  });

  it('resumes existing session', async () => {
    const mockSession = {
      id: 'existing-session-456',
      projectInput: 'Existing project',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Planning',
        agentSequence: ['ANALYST', 'PM'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockGetSession.mockResolvedValue({
      data: {
        session: mockSession,
        conversationHistory: []
      }
    });

    const { result } = renderUseSession();

    await result.current.resumeExistingSession('existing-session-456');

    await waitFor(() => {
      expect(result.current.currentSession).toEqual(mockSession);
      expect(result.current.sessionId).toBe('existing-session-456');
    });

    expect(mockGetSession).toHaveBeenCalledWith('existing-session-456');
  });

  it('handles session creation errors', async () => {
    mockCreateSession.mockRejectedValue(new Error('Network error'));

    const { result } = renderUseSession();

    await expect(result.current.createNewSession({
      projectInput: 'Test project',
      anonymous: true
    })).rejects.toThrow('Network error');

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });

  it('handles session resume errors', async () => {
    mockGetSession.mockRejectedValue(new Error('Session not found'));

    const { result } = renderUseSession();

    await expect(result.current.resumeExistingSession('invalid-id')).rejects.toThrow('Session not found');

    // Should clear stored session info on error
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('anonymousSession');
  });

  it('ends current session', async () => {
    // First create a session
    const mockSession = {
      id: 'test-session-123',
      projectInput: 'Test project',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Analysis',
        agentSequence: ['ANALYST'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockCreateSession.mockResolvedValue({
      data: {
        session: mockSession,
        followUpQuestions: []
      }
    });

    const { result } = renderUseSession();

    await result.current.createNewSession({
      projectInput: 'Test project',
      anonymous: true
    });

    await waitFor(() => {
      expect(result.current.currentSession).toEqual(mockSession);
    });

    // End the session
    result.current.endCurrentSession();

    await waitFor(() => {
      expect(result.current.currentSession).toBeUndefined();
      expect(result.current.sessionId).toBeUndefined();
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('anonymousSession');
  });

  it('restores session from localStorage', async () => {
    const storedSessionInfo = {
      sessionId: 'stored-session-789',
      createdAt: new Date().toISOString(),
      projectInput: 'Stored project',
      lastAccessed: new Date().toISOString()
    };

    localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSessionInfo));

    const mockSession = {
      id: 'stored-session-789',
      projectInput: 'Stored project',
      status: 'ACTIVE',
      createdAt: storedSessionInfo.createdAt,
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Analysis',
        agentSequence: ['ANALYST'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockGetSession.mockResolvedValue({
      data: {
        session: mockSession,
        conversationHistory: []
      }
    });

    const { result } = renderUseSession({ autoRestore: true });

    await waitFor(() => {
      expect(result.current.currentSession).toEqual(mockSession);
    });

    expect(localStorageMock.getItem).toHaveBeenCalledWith('anonymousSession');
    expect(mockGetSession).toHaveBeenCalledWith('stored-session-789');
  });

  it('handles restore failure gracefully', async () => {
    const storedSessionInfo = {
      sessionId: 'invalid-session-id',
      createdAt: new Date().toISOString(),
      projectInput: 'Invalid project',
      lastAccessed: new Date().toISOString()
    };

    localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSessionInfo));
    mockGetSession.mockRejectedValue(new Error('Session not found'));

    const { result } = renderUseSession({ autoRestore: true });

    // Should not throw error, just start fresh
    await waitFor(() => {
      expect(result.current.currentSession).toBeUndefined();
    });

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('anonymousSession');
  });

  it('identifies active sessions correctly', async () => {
    const mockSession = {
      id: 'active-session-123',
      projectInput: 'Test project',
      status: 'ACTIVE' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Analysis',
        agentSequence: ['ANALYST'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockCreateSession.mockResolvedValue({
      data: {
        session: mockSession,
        followUpQuestions: []
      }
    });

    const { result } = renderUseSession();

    await result.current.createNewSession({
      projectInput: 'Test project',
      anonymous: true
    });

    await waitFor(() => {
      expect(result.current.isSessionActive).toBe(false); // WebSocket not connected
    });
  });

  it('disables storage persistence when requested', async () => {
    const mockSession = {
      id: 'test-session-123',
      projectInput: 'Test project',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Analysis',
        agentSequence: ['ANALYST'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockCreateSession.mockResolvedValue({
      data: {
        session: mockSession,
        followUpQuestions: []
      }
    });

    const { result } = renderUseSession({ persistToStorage: false });

    await result.current.createNewSession({
      projectInput: 'Test project',
      anonymous: true
    });

    await waitFor(() => {
      expect(result.current.currentSession).toEqual(mockSession);
    });

    // Should not store to localStorage
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it('updates last accessed time', async () => {
    const storedSessionInfo = {
      sessionId: 'stored-session-789',
      createdAt: new Date().toISOString(),
      projectInput: 'Stored project',
      lastAccessed: new Date(Date.now() - 60000).toISOString() // 1 minute ago
    };

    localStorageMock.getItem.mockReturnValue(JSON.stringify(storedSessionInfo));

    const mockSession = {
      id: 'stored-session-789',
      projectInput: 'Stored project',
      status: 'ACTIVE',
      createdAt: storedSessionInfo.createdAt,
      updatedAt: new Date().toISOString(),
      sessionData: {
        conversationHistory: [],
        currentPhase: 'Analysis',
        agentSequence: ['ANALYST'],
        documentsGenerated: [],
        metadata: {}
      }
    };

    mockGetSession.mockResolvedValue({
      data: {
        session: mockSession,
        conversationHistory: []
      }
    });

    renderUseSession({ autoRestore: true });

    await waitFor(() => {
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'anonymousSession',
        expect.stringContaining('"lastAccessed"')
      );
    });
  });
});