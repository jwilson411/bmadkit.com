import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { 
  SessionState, 
  PlanningSession, 
  SessionCreationRequest,
  SessionCreationResponse,
  FollowUpQuestion,
  ProjectInputValidation,
  ConversationMessage
} from '@/types/session';
import { sessionApi } from '@/services/api';

// Initial state
const initialState: SessionState = {
  currentSession: undefined,
  isLoading: false,
  error: undefined,
  connectionStatus: 'disconnected',
  followUpQuestions: [],
  inputValidation: undefined,
};

// Async thunks
export const createSession = createAsyncThunk(
  'session/create',
  async (request: SessionCreationRequest) => {
    const response = await sessionApi.createSession(request);
    return response.data;
  }
);

export const resumeSession = createAsyncThunk(
  'session/resume',
  async (sessionId: string) => {
    const response = await sessionApi.getSession(sessionId);
    return response.data;
  }
);

export const updateSessionStatus = createAsyncThunk(
  'session/updateStatus',
  async ({ sessionId, status }: { sessionId: string; status: string }) => {
    const response = await sessionApi.updateSession(sessionId, { status });
    return response.data;
  }
);

// Session slice
const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    // Local state management
    setConnectionStatus: (state, action: PayloadAction<SessionState['connectionStatus']>) => {
      state.connectionStatus = action.payload;
    },
    
    setInputValidation: (state, action: PayloadAction<ProjectInputValidation>) => {
      state.inputValidation = action.payload;
    },
    
    clearInputValidation: (state) => {
      state.inputValidation = undefined;
    },
    
    addFollowUpQuestion: (state, action: PayloadAction<FollowUpQuestion>) => {
      state.followUpQuestions.push(action.payload);
    },
    
    removeFollowUpQuestion: (state, action: PayloadAction<string>) => {
      state.followUpQuestions = state.followUpQuestions.filter(q => q.id !== action.payload);
    },
    
    clearFollowUpQuestions: (state) => {
      state.followUpQuestions = [];
    },
    
    addConversationMessage: (state, action: PayloadAction<ConversationMessage>) => {
      if (state.currentSession) {
        state.currentSession.sessionData.conversationHistory.push(action.payload);
        state.currentSession.updatedAt = new Date().toISOString();
      }
    },
    
    updateSessionData: (state, action: PayloadAction<Partial<PlanningSession['sessionData']>>) => {
      if (state.currentSession) {
        state.currentSession.sessionData = {
          ...state.currentSession.sessionData,
          ...action.payload
        };
        state.currentSession.updatedAt = new Date().toISOString();
      }
    },
    
    clearSession: (state) => {
      state.currentSession = undefined;
      state.followUpQuestions = [];
      state.inputValidation = undefined;
      state.connectionStatus = 'disconnected';
    },
    
    clearError: (state) => {
      state.error = undefined;
    },
    
    // WebSocket event handlers
    handleProgressUpdate: (state, action: PayloadAction<{ percentage: number; currentPhase: string; completedTasks: number; totalTasks: number }>) => {
      if (state.currentSession) {
        state.currentSession.sessionData.currentPhase = action.payload.currentPhase;
        state.currentSession.sessionData.metadata = {
          ...state.currentSession.sessionData.metadata,
          progress: action.payload
        };
      }
    },
    
    handleAgentStatusChange: (state, action: PayloadAction<{ currentAgent: string; status: string; task: string }>) => {
      if (state.currentSession) {
        state.currentSession.sessionData.metadata = {
          ...state.currentSession.sessionData.metadata,
          currentAgent: action.payload.currentAgent,
          agentStatus: action.payload.status,
          currentTask: action.payload.task
        };
      }
    },
    
    handleDocumentUpdate: (state, action: PayloadAction<{ documentId: string; documentType: string; status: string }>) => {
      if (state.currentSession) {
        const existingDocuments = state.currentSession.sessionData.documentsGenerated || [];
        if (!existingDocuments.includes(action.payload.documentId)) {
          state.currentSession.sessionData.documentsGenerated.push(action.payload.documentId);
        }
        
        state.currentSession.sessionData.metadata = {
          ...state.currentSession.sessionData.metadata,
          documents: {
            ...state.currentSession.sessionData.metadata.documents,
            [action.payload.documentId]: {
              type: action.payload.documentType,
              status: action.payload.status,
              lastUpdated: new Date().toISOString()
            }
          }
        };
      }
    }
  },
  
  extraReducers: (builder) => {
    // Create session
    builder
      .addCase(createSession.pending, (state) => {
        state.isLoading = true;
        state.error = undefined;
      })
      .addCase(createSession.fulfilled, (state, action: PayloadAction<SessionCreationResponse>) => {
        state.isLoading = false;
        state.currentSession = action.payload.session;
        state.followUpQuestions = action.payload.followUpQuestions || [];
        state.error = undefined;
      })
      .addCase(createSession.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to create session';
      });
    
    // Resume session
    builder
      .addCase(resumeSession.pending, (state) => {
        state.isLoading = true;
        state.error = undefined;
      })
      .addCase(resumeSession.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentSession = action.payload.session;
        state.error = undefined;
      })
      .addCase(resumeSession.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to resume session';
      });
    
    // Update session status
    builder
      .addCase(updateSessionStatus.fulfilled, (state, action) => {
        if (state.currentSession) {
          state.currentSession.status = action.payload.status;
        }
      });
  },
});

export const {
  setConnectionStatus,
  setInputValidation,
  clearInputValidation,
  addFollowUpQuestion,
  removeFollowUpQuestion,
  clearFollowUpQuestions,
  addConversationMessage,
  updateSessionData,
  clearSession,
  clearError,
  handleProgressUpdate,
  handleAgentStatusChange,
  handleDocumentUpdate,
} = sessionSlice.actions;

export default sessionSlice.reducer;

// Selectors
export const selectCurrentSession = (state: { session: SessionState }) => state.session.currentSession;
export const selectIsLoading = (state: { session: SessionState }) => state.session.isLoading;
export const selectError = (state: { session: SessionState }) => state.session.error;
export const selectConnectionStatus = (state: { session: SessionState }) => state.session.connectionStatus;
export const selectFollowUpQuestions = (state: { session: SessionState }) => state.session.followUpQuestions;
export const selectInputValidation = (state: { session: SessionState }) => state.session.inputValidation;
export const selectConversationHistory = (state: { session: SessionState }) => 
  state.session.currentSession?.sessionData.conversationHistory || [];
export const selectCurrentPhase = (state: { session: SessionState }) => 
  state.session.currentSession?.sessionData.currentPhase;
export const selectProgress = (state: { session: SessionState }) => 
  state.session.currentSession?.sessionData.metadata?.progress;