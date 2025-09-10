import { z } from 'zod';

// Session status enum
export const SessionStatusEnum = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'EXPIRED']);

// Agent types enum  
export const AgentTypeEnum = z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']);

// Message sender enum
export const MessageSenderEnum = z.enum(['USER', 'SYSTEM', 'ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']);

// Session creation schema
export const CreateSessionSchema = z.object({
  userId: z.string().uuid().optional(),
  projectInput: z.string().min(10).max(5000),
  projectName: z.string().min(1).max(200).optional(),
  metadata: z.record(z.any()).optional(),
});

// Session update schema
export const UpdateSessionSchema = z.object({
  projectInput: z.string().min(10).max(5000).optional(),
  projectName: z.string().min(1).max(200).optional(),
  status: SessionStatusEnum.optional(),
  currentAgent: AgentTypeEnum.optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  totalTokensUsed: z.number().min(0).optional(),
  pausedAt: z.date().optional(),
  completedAt: z.date().optional(),
  metadata: z.record(z.any()).optional(),
});

// Session query schema
export const SessionQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: SessionStatusEnum.optional(),
  currentAgent: AgentTypeEnum.optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'progressPercentage']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Planning session data schema
export const PlanningSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  projectInput: z.string(),
  projectName: z.string().optional(),
  sessionData: z.record(z.any()).default({}),
  status: SessionStatusEnum,
  currentAgent: AgentTypeEnum.optional(),
  progressPercentage: z.number().min(0).max(100).default(0),
  conversationSummary: z.string().optional(),
  totalMessages: z.number().min(0).default(0),
  totalTokensUsed: z.number().min(0).default(0),
  estimatedCost: z.number().min(0).default(0),
  startedAt: z.date(),
  lastActiveAt: z.date(),
  pausedAt: z.date().optional(),
  completedAt: z.date().optional(),
  expiresAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).default({}),
});

// Conversation message schema
export const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  sender: MessageSenderEnum,
  content: z.string().max(10000),
  sequenceNumber: z.number().min(0),
  tokenCount: z.number().min(0).default(0),
  cost: z.number().min(0).default(0),
  agentContext: z.record(z.any()).optional(),
  userResponseMetadata: z.record(z.any()).optional(),
  isRevised: z.boolean().default(false),
  originalMessageId: z.string().uuid().optional(),
  revisionNumber: z.number().min(1).default(1),
  createdAt: z.date(),
  updatedAt: z.date(),
  metadata: z.record(z.any()).default({}),
});

// Message creation schema
export const CreateMessageSchema = z.object({
  sessionId: z.string().uuid(),
  sender: MessageSenderEnum,
  content: z.string().min(1).max(10000),
  agentContext: z.record(z.any()).optional(),
  userResponseMetadata: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

// Message update schema (for revisions)
export const UpdateMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  userResponseMetadata: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

// Agent state schema
export const AgentStateSchema = z.object({
  sessionId: z.string().uuid(),
  agentType: AgentTypeEnum,
  state: z.record(z.any()).default({}),
  isActive: z.boolean().default(false),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  progressPercentage: z.number().min(0).max(100).default(0),
  context: z.record(z.any()).default({}),
  outputs: z.array(z.record(z.any())).default([]),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Session analytics schema
export const SessionAnalyticsSchema = z.object({
  sessionId: z.string().uuid(),
  totalDuration: z.number().min(0), // milliseconds
  activeTime: z.number().min(0), // milliseconds
  pausedTime: z.number().min(0), // milliseconds
  messageCount: z.number().min(0),
  userMessageCount: z.number().min(0),
  agentMessageCount: z.number().min(0),
  totalTokens: z.number().min(0),
  totalCost: z.number().min(0),
  averageResponseTime: z.number().min(0), // milliseconds
  agentTransitions: z.number().min(0),
  userRevisions: z.number().min(0),
  completionRate: z.number().min(0).max(1),
  userSatisfactionScore: z.number().min(1).max(5).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// User response revision schema
export const UserResponseRevisionSchema = z.object({
  id: z.string().uuid(),
  originalMessageId: z.string().uuid(),
  sessionId: z.string().uuid(),
  content: z.string().min(1).max(10000),
  revisionNumber: z.number().min(1),
  revisionReason: z.string().optional(),
  impactAnalysis: z.record(z.any()).optional(),
  affectedAgents: z.array(AgentTypeEnum).default([]),
  reprocessingRequired: z.boolean().default(false),
  createdAt: z.date(),
  metadata: z.record(z.any()).default({}),
});

// Session configuration schema
export const SessionConfigSchema = z.object({
  maxDuration: z.number().min(60000).max(10800000).default(2700000), // 45 minutes default
  maxMessages: z.number().min(50).max(2000).default(500),
  maxTokensPerSession: z.number().min(10000).max(1000000).default(100000),
  autoSaveInterval: z.number().min(5000).max(300000).default(30000), // 30 seconds
  cleanupGracePeriod: z.number().min(3600000).max(604800000).default(86400000), // 24 hours
  contextWindowSize: z.number().min(1000).max(100000).default(8000), // tokens
  enableAutoSummarization: z.boolean().default(true),
  enableUserRevisions: z.boolean().default(true),
  enableAnalytics: z.boolean().default(true),
});

// Session search filters
export const SessionFiltersSchema = z.object({
  dateRange: z.object({
    start: z.date(),
    end: z.date(),
  }).optional(),
  status: z.array(SessionStatusEnum).optional(),
  agents: z.array(AgentTypeEnum).optional(),
  minProgress: z.number().min(0).max(100).optional(),
  maxProgress: z.number().min(0).max(100).optional(),
  hasUserRevisions: z.boolean().optional(),
  minDuration: z.number().min(0).optional(),
  maxDuration: z.number().min(0).optional(),
  textSearch: z.string().min(3).max(100).optional(),
});

// TypeScript types
export type SessionStatus = z.infer<typeof SessionStatusEnum>;
export type AgentType = z.infer<typeof AgentTypeEnum>;
export type MessageSender = z.infer<typeof MessageSenderEnum>;
export type PlanningSession = z.infer<typeof PlanningSessionSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type SessionAnalytics = z.infer<typeof SessionAnalyticsSchema>;
export type UserResponseRevision = z.infer<typeof UserResponseRevisionSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type SessionFilters = z.infer<typeof SessionFiltersSchema>;

export type CreateSessionRequest = z.infer<typeof CreateSessionSchema>;
export type UpdateSessionRequest = z.infer<typeof UpdateSessionSchema>;
export type SessionQueryRequest = z.infer<typeof SessionQuerySchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageSchema>;
export type UpdateMessageRequest = z.infer<typeof UpdateMessageSchema>;

// Helper functions

/**
 * Generate a unique session identifier
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique message identifier
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate session expiration time
 */
export function calculateSessionExpiration(config: SessionConfig): Date {
  return new Date(Date.now() + config.maxDuration);
}

/**
 * Check if session is expired
 */
export function isSessionExpired(session: PlanningSession): boolean {
  return new Date() > session.expiresAt;
}

/**
 * Check if session is active
 */
export function isSessionActive(session: PlanningSession): boolean {
  return session.status === 'ACTIVE' && !isSessionExpired(session);
}

/**
 * Calculate session progress based on agent workflow
 */
export function calculateSessionProgress(
  currentAgent: AgentType | null,
  agentStates: AgentState[]
): number {
  const agentOrder: AgentType[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
  const totalAgents = agentOrder.length;
  
  if (!currentAgent) return 0;
  
  const currentIndex = agentOrder.indexOf(currentAgent);
  const completedAgents = agentStates.filter(state => state.completedAt).length;
  
  // Base progress on completed agents + current agent progress
  const baseProgress = (completedAgents / totalAgents) * 100;
  const currentAgentState = agentStates.find(state => state.agentType === currentAgent);
  const currentAgentProgress = currentAgentState?.progressPercentage || 0;
  
  return Math.min(100, baseProgress + (currentAgentProgress / totalAgents));
}

/**
 * Estimate token count for text
 */
export function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Validate session data integrity
 */
export function validateSessionData(session: any): { valid: boolean; errors: string[] } {
  try {
    PlanningSessionSchema.parse(session);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
      };
    }
    return { valid: false, errors: ['Unknown validation error'] };
  }
}

/**
 * Create default session configuration
 */
export function createDefaultSessionConfig(): SessionConfig {
  return SessionConfigSchema.parse({});
}

/**
 * Get agent workflow order
 */
export function getAgentWorkflowOrder(): AgentType[] {
  return ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
}

/**
 * Get next agent in workflow
 */
export function getNextAgent(currentAgent: AgentType): AgentType | null {
  const order = getAgentWorkflowOrder();
  const currentIndex = order.indexOf(currentAgent);
  
  if (currentIndex === -1 || currentIndex === order.length - 1) {
    return null; // No next agent or invalid current agent
  }
  
  return order[currentIndex + 1];
}

/**
 * Get previous agent in workflow
 */
export function getPreviousAgent(currentAgent: AgentType): AgentType | null {
  const order = getAgentWorkflowOrder();
  const currentIndex = order.indexOf(currentAgent);
  
  if (currentIndex <= 0) {
    return null; // No previous agent or invalid current agent
  }
  
  return order[currentIndex - 1];
}

// Constants
export const SESSION_CONSTANTS = {
  DEFAULT_MAX_DURATION: 2700000, // 45 minutes
  DEFAULT_MAX_MESSAGES: 500,
  DEFAULT_MAX_TOKENS: 100000,
  DEFAULT_AUTO_SAVE_INTERVAL: 30000, // 30 seconds
  DEFAULT_CLEANUP_GRACE_PERIOD: 86400000, // 24 hours
  DEFAULT_CONTEXT_WINDOW: 8000, // tokens
  MIN_PROJECT_INPUT_LENGTH: 10,
  MAX_PROJECT_INPUT_LENGTH: 5000,
  MAX_MESSAGE_LENGTH: 10000,
  MAX_SESSION_NAME_LENGTH: 200,
} as const;