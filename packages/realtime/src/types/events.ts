export interface BaseEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  userId?: string;
  correlationId?: string;
}

export interface ProgressUpdatedEvent extends BaseEvent {
  type: 'progress_updated';
  data: {
    percentage: number;
    currentPhase: string;
    estimatedTimeRemaining?: number;
    completedTasks: number;
    totalTasks: number;
  };
}

export interface DocumentUpdatedEvent extends BaseEvent {
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

export interface AgentStatusChangedEvent extends BaseEvent {
  type: 'agent_status_changed';
  data: {
    previousAgent?: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
    currentAgent: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
    status: 'STARTING' | 'WORKING' | 'COMPLETED' | 'HANDOFF';
    task: string;
    estimatedDuration?: number;
    message?: string;
  };
}

export interface SessionStartedEvent extends BaseEvent {
  type: 'session_started';
  data: {
    projectInput: string;
    expectedDuration: number;
    agentSequence: string[];
    totalTasks: number;
  };
}

export interface SessionCompletedEvent extends BaseEvent {
  type: 'session_completed';
  data: {
    completionTime: string;
    totalDuration: number;
    documentsGenerated: string[];
    summary: string;
    nextSteps?: string[];
  };
}

export interface ErrorOccurredEvent extends BaseEvent {
  type: 'error_occurred';
  data: {
    errorType: 'CONNECTION' | 'PROCESSING' | 'TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'AUTHENTICATION' | 'PERMISSION';
    errorCode: string;
    message: string;
    recoveryOptions: {
      action: 'RETRY' | 'REFRESH' | 'CONTACT_SUPPORT' | 'RESTART_SESSION';
      description: string;
      automated: boolean;
    }[];
    context?: {
      agent?: string;
      document?: string;
      step?: string;
    };
  };
}

export interface ConnectionStatusEvent extends BaseEvent {
  type: 'connection_status';
  data: {
    status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'ERROR';
    clientCount: number;
    latency?: number;
    quality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  };
}

export type RealtimeEvent = 
  | ProgressUpdatedEvent
  | DocumentUpdatedEvent
  | AgentStatusChangedEvent
  | SessionStartedEvent
  | SessionCompletedEvent
  | ErrorOccurredEvent
  | ConnectionStatusEvent;

export interface SocketData {
  userId: string;
  sessionId?: string;
  connectedAt: string;
  lastActivity: string;
  clientInfo: {
    userAgent: string;
    ip: string;
    version?: string;
  };
}

export interface SessionRoom {
  sessionId: string;
  participants: Set<string>; // socket IDs
  createdAt: string;
  lastActivity: string;
  metadata: {
    userId: string;
    status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED';
    currentAgent?: string;
  };
}

export interface BroadcastMessage {
  room: string;
  event: RealtimeEvent;
  excludeSocket?: string;
  includeSocketsOnly?: string[];
}

// Client-side event acknowledgments
export interface EventAck {
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}