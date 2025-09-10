export interface PlanningSession {
  id: string;
  userId?: string; // null for anonymous sessions
  projectInput: string;
  sessionData: {
    conversationHistory: ConversationMessage[];
    currentPhase: string;
    agentSequence: string[];
    documentsGenerated: string[];
    metadata: Record<string, any>;
  };
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  websocketUrl?: string;
}

export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export interface ConversationMessage {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  agentType?: AgentType;
  timestamp: string;
  metadata?: {
    isFollowUp?: boolean;
    questionCategory?: string;
    suggestedActions?: string[];
  };
}

export type AgentType = 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';

export interface SessionCreationRequest {
  projectInput: string;
  userPreferences?: {
    industry?: string;
    projectType?: string;
    timeline?: string;
    budget?: string;
  };
  anonymous?: boolean;
}

export interface SessionCreationResponse {
  session: PlanningSession;
  websocketUrl: string;
  followUpQuestions: FollowUpQuestion[];
  estimatedDuration?: number;
}

export interface FollowUpQuestion {
  id: string;
  question: string;
  category: 'clarification' | 'scope' | 'constraints' | 'goals';
  priority: 'high' | 'medium' | 'low';
  suggestedAnswers?: string[];
}

export interface ProjectInputValidation {
  isValid: boolean;
  errors: {
    field: string;
    message: string;
  }[];
  warnings?: {
    field: string;
    message: string;
  }[];
}

export interface SessionState {
  currentSession?: PlanningSession;
  isLoading: boolean;
  error?: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  followUpQuestions: FollowUpQuestion[];
  inputValidation?: ProjectInputValidation;
}

// WebSocket event types
export interface WebSocketMessage {
  id: string;
  type: string;
  timestamp: string;
  sessionId: string;
  userId?: string;
  data: any;
}

export interface ProgressUpdate extends WebSocketMessage {
  type: 'progress_updated';
  data: {
    percentage: number;
    currentPhase: string;
    estimatedTimeRemaining?: number;
    completedTasks: number;
    totalTasks: number;
  };
}

export interface AgentStatusChange extends WebSocketMessage {
  type: 'agent_status_changed';
  data: {
    previousAgent?: AgentType;
    currentAgent: AgentType;
    status: 'STARTING' | 'WORKING' | 'COMPLETED' | 'HANDOFF';
    task: string;
    estimatedDuration?: number;
    message?: string;
  };
}

export interface DocumentUpdate extends WebSocketMessage {
  type: 'document_updated';
  data: {
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
  };
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export interface SessionResumeResponse {
  session: PlanningSession;
  websocketUrl: string;
  conversationHistory: ConversationMessage[];
}

// Form state types
export interface ProjectInputFormState {
  projectInput: string;
  isSubmitting: boolean;
  characterCount: number;
  isValid: boolean;
  errors: string[];
}

export interface UserPreferences {
  industry: string;
  projectType: string;
  timeline: string;
  budget: string;
}