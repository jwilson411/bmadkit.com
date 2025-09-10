import { z } from 'zod';

// Workflow state enums
export const WorkflowStateEnum = z.enum([
  'INITIALIZING',
  'ANALYST_ACTIVE', 
  'ANALYST_COMPLETE',
  'PM_ACTIVE',
  'PM_COMPLETE', 
  'UX_EXPERT_ACTIVE',
  'UX_EXPERT_COMPLETE',
  'ARCHITECT_ACTIVE',
  'ARCHITECT_COMPLETE',
  'WORKFLOW_COMPLETE',
  'PAUSED',
  'ERROR',
  'CANCELLED'
]);

// Agent phases enum
export const AgentPhaseEnum = z.enum([
  'ANALYST',
  'PM', 
  'UX_EXPERT',
  'ARCHITECT'
]);

// Workflow transition triggers
export const WorkflowTriggerEnum = z.enum([
  'START',
  'AGENT_COMPLETE',
  'USER_INPUT',
  'PAUSE',
  'RESUME', 
  'ERROR',
  'CANCEL',
  'FORCE_TRANSITION'
]);

// Agent interaction types
export const InteractionTypeEnum = z.enum([
  'QUESTION',
  'CLARIFICATION', 
  'CONFIRMATION',
  'HANDOFF',
  'SUMMARY'
]);

// Context enrichment schema
export const ContextEnrichmentSchema = z.object({
  timestamp: z.date(),
  agentPhase: AgentPhaseEnum,
  enrichmentType: z.enum(['SUMMARY', 'VALIDATION', 'ENHANCEMENT', 'TRANSFORMATION']),
  inputContext: z.record(z.any()),
  outputContext: z.record(z.any()),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.any()).optional()
});

// Workflow transition schema
export const WorkflowTransitionSchema = z.object({
  id: z.string().uuid(),
  fromState: WorkflowStateEnum,
  toState: WorkflowStateEnum,
  trigger: WorkflowTriggerEnum,
  conditions: z.array(z.record(z.any())).optional(),
  timestamp: z.date(),
  metadata: z.record(z.any()).optional()
});

// Agent execution result schema
export const AgentExecutionResultSchema = z.object({
  agentPhase: AgentPhaseEnum,
  executionId: z.string().uuid(),
  startTime: z.date(),
  endTime: z.date().optional(),
  status: z.enum(['RUNNING', 'COMPLETE', 'ERROR', 'PAUSED']),
  interactions: z.array(z.object({
    id: z.string().uuid(),
    type: InteractionTypeEnum,
    prompt: z.string(),
    response: z.string().optional(),
    timestamp: z.date(),
    metadata: z.record(z.any()).optional()
  })),
  contextInput: z.record(z.any()),
  contextOutput: z.record(z.any()).optional(),
  artifacts: z.array(z.object({
    id: z.string().uuid(),
    type: z.string(),
    name: z.string(),
    content: z.any(),
    metadata: z.record(z.any()).optional()
  })).optional(),
  metrics: z.object({
    tokensUsed: z.number().optional(),
    cost: z.number().optional(),
    interactionCount: z.number(),
    duration: z.number() // milliseconds
  }),
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    timestamp: z.date(),
    recoverable: z.boolean()
  })).optional()
});

// Workflow context schema
export const WorkflowContextSchema = z.object({
  projectInput: z.string(),
  projectName: z.string().optional(),
  userPreferences: z.record(z.any()).optional(),
  industryContext: z.string().optional(),
  technicalConstraints: z.array(z.string()).optional(),
  budgetConstraints: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    currency: z.string().optional()
  }).optional(),
  timelineConstraints: z.object({
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    milestones: z.array(z.object({
      name: z.string(),
      date: z.date(),
      description: z.string().optional()
    })).optional()
  }).optional(),
  stakeholders: z.array(z.object({
    name: z.string(),
    role: z.string(),
    influence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    requirements: z.array(z.string()).optional()
  })).optional(),
  enrichments: z.array(ContextEnrichmentSchema).optional()
});

// Workflow execution state schema
export const WorkflowExecutionStateSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  workflowDefinitionId: z.string(),
  currentState: WorkflowStateEnum,
  currentAgent: AgentPhaseEnum.optional(),
  context: WorkflowContextSchema,
  agentResults: z.array(AgentExecutionResultSchema),
  transitions: z.array(WorkflowTransitionSchema),
  startTime: z.date(),
  endTime: z.date().optional(),
  pausedAt: z.date().optional(),
  resumedAt: z.date().optional(),
  metrics: z.object({
    totalDuration: z.number().optional(), // milliseconds
    agentSwitches: z.number().default(0),
    userInteractions: z.number().default(0),
    totalTokensUsed: z.number().default(0),
    totalCost: z.number().default(0),
    qualityScore: z.number().min(0).max(1).optional()
  }),
  metadata: z.record(z.any()).optional()
});

// Workflow definition schema
export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  states: z.array(z.object({
    name: WorkflowStateEnum,
    agent: AgentPhaseEnum.optional(),
    description: z.string().optional(),
    entryActions: z.array(z.string()).optional(),
    exitActions: z.array(z.string()).optional(),
    timeoutMs: z.number().optional()
  })),
  transitions: z.array(z.object({
    from: WorkflowStateEnum,
    to: WorkflowStateEnum,
    trigger: WorkflowTriggerEnum,
    conditions: z.array(z.object({
      field: z.string(),
      operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists']),
      value: z.any().optional()
    })).optional(),
    actions: z.array(z.string()).optional()
  })),
  initialState: WorkflowStateEnum,
  finalStates: z.array(WorkflowStateEnum),
  configuration: z.object({
    maxExecutionTime: z.number().optional(), // milliseconds
    maxAgentSwitches: z.number().optional(),
    allowPause: z.boolean().default(true),
    allowResume: z.boolean().default(true),
    requiredContext: z.array(z.string()).optional()
  })
});

// Type exports
export type WorkflowState = z.infer<typeof WorkflowStateEnum>;
export type AgentPhase = z.infer<typeof AgentPhaseEnum>;
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerEnum>;
export type InteractionType = z.infer<typeof InteractionTypeEnum>;
export type ContextEnrichment = z.infer<typeof ContextEnrichmentSchema>;
export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>;
export type AgentExecutionResult = z.infer<typeof AgentExecutionResultSchema>;
export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;
export type WorkflowExecutionState = z.infer<typeof WorkflowExecutionStateSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// Helper functions
export function getNextAgentPhase(currentPhase: AgentPhase): AgentPhase | null {
  const sequence: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
  const currentIndex = sequence.indexOf(currentPhase);
  return currentIndex < sequence.length - 1 ? sequence[currentIndex + 1] : null;
}

export function getPreviousAgentPhase(currentPhase: AgentPhase): AgentPhase | null {
  const sequence: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
  const currentIndex = sequence.indexOf(currentPhase);
  return currentIndex > 0 ? sequence[currentIndex - 1] : null;
}

export function getAgentStateFromPhase(phase: AgentPhase): WorkflowState {
  const mapping: Record<AgentPhase, WorkflowState> = {
    'ANALYST': 'ANALYST_ACTIVE',
    'PM': 'PM_ACTIVE',
    'UX_EXPERT': 'UX_EXPERT_ACTIVE',
    'ARCHITECT': 'ARCHITECT_ACTIVE'
  };
  return mapping[phase];
}

export function getCompletedStateFromPhase(phase: AgentPhase): WorkflowState {
  const mapping: Record<AgentPhase, WorkflowState> = {
    'ANALYST': 'ANALYST_COMPLETE',
    'PM': 'PM_COMPLETE',
    'UX_EXPERT': 'UX_EXPERT_COMPLETE', 
    'ARCHITECT': 'ARCHITECT_COMPLETE'
  };
  return mapping[phase];
}

export function isActiveAgentState(state: WorkflowState): boolean {
  return ['ANALYST_ACTIVE', 'PM_ACTIVE', 'UX_EXPERT_ACTIVE', 'ARCHITECT_ACTIVE'].includes(state);
}

export function isCompletedAgentState(state: WorkflowState): boolean {
  return ['ANALYST_COMPLETE', 'PM_COMPLETE', 'UX_EXPERT_COMPLETE', 'ARCHITECT_COMPLETE'].includes(state);
}

export function isTerminalState(state: WorkflowState): boolean {
  return ['WORKFLOW_COMPLETE', 'ERROR', 'CANCELLED'].includes(state);
}

export function canTransition(from: WorkflowState, to: WorkflowState, trigger: WorkflowTrigger): boolean {
  // Basic state machine validation
  const validTransitions: Record<WorkflowState, Partial<Record<WorkflowTrigger, WorkflowState[]>>> = {
    'INITIALIZING': {
      'START': ['ANALYST_ACTIVE']
    },
    'ANALYST_ACTIVE': {
      'AGENT_COMPLETE': ['ANALYST_COMPLETE'],
      'PAUSE': ['PAUSED'],
      'ERROR': ['ERROR'],
      'CANCEL': ['CANCELLED']
    },
    'ANALYST_COMPLETE': {
      'AGENT_COMPLETE': ['PM_ACTIVE'],
      'FORCE_TRANSITION': ['PM_ACTIVE']
    },
    'PM_ACTIVE': {
      'AGENT_COMPLETE': ['PM_COMPLETE'],
      'PAUSE': ['PAUSED'],
      'ERROR': ['ERROR'],
      'CANCEL': ['CANCELLED']
    },
    'PM_COMPLETE': {
      'AGENT_COMPLETE': ['UX_EXPERT_ACTIVE'],
      'FORCE_TRANSITION': ['UX_EXPERT_ACTIVE']
    },
    'UX_EXPERT_ACTIVE': {
      'AGENT_COMPLETE': ['UX_EXPERT_COMPLETE'],
      'PAUSE': ['PAUSED'],
      'ERROR': ['ERROR'], 
      'CANCEL': ['CANCELLED']
    },
    'UX_EXPERT_COMPLETE': {
      'AGENT_COMPLETE': ['ARCHITECT_ACTIVE'],
      'FORCE_TRANSITION': ['ARCHITECT_ACTIVE']
    },
    'ARCHITECT_ACTIVE': {
      'AGENT_COMPLETE': ['ARCHITECT_COMPLETE'],
      'PAUSE': ['PAUSED'],
      'ERROR': ['ERROR'],
      'CANCEL': ['CANCELLED']
    },
    'ARCHITECT_COMPLETE': {
      'AGENT_COMPLETE': ['WORKFLOW_COMPLETE'],
      'FORCE_TRANSITION': ['WORKFLOW_COMPLETE']
    },
    'PAUSED': {
      'RESUME': ['ANALYST_ACTIVE', 'PM_ACTIVE', 'UX_EXPERT_ACTIVE', 'ARCHITECT_ACTIVE'],
      'CANCEL': ['CANCELLED']
    }
  };

  const allowedTransitions = validTransitions[from]?.[trigger];
  return allowedTransitions ? allowedTransitions.includes(to) : false;
}

export function generateWorkflowId(): string {
  return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateInteractionId(): string {
  return `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}