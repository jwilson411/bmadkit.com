import { 
  WorkflowDefinition, 
  WorkflowDefinitionSchema,
  WorkflowState,
  AgentPhase,
  WorkflowTrigger
} from '../models/workflow-models';

/**
 * Greenfield Fullstack Workflow Definition
 * 
 * This workflow orchestrates the complete BMAD methodology for greenfield fullstack projects:
 * 1. Analyst: Business analysis, market validation, requirements gathering
 * 2. PM: Feature prioritization, user stories, project scope refinement  
 * 3. UX Expert: User experience design, interface planning, usability requirements
 * 4. Architect: Technical architecture, implementation planning, technology selection
 */

export const GREENFIELD_FULLSTACK_WORKFLOW: WorkflowDefinition = {
  id: 'greenfield-fullstack',
  name: 'Greenfield Fullstack Development Workflow',
  version: '1.0.0',
  description: 'Complete BMAD methodology workflow for greenfield fullstack projects with business analysis, project management, UX design, and technical architecture phases',

  // Define all workflow states
  states: [
    {
      name: 'INITIALIZING',
      description: 'Workflow initialization and context setup',
      entryActions: ['initializeWorkflowContext', 'validateProjectInput'],
      timeoutMs: 30000 // 30 seconds
    },
    {
      name: 'ANALYST_ACTIVE', 
      agent: 'ANALYST',
      description: 'Business analyst gathering requirements and validating market fit',
      entryActions: ['loadAnalystPrompt', 'initializeAnalystContext'],
      exitActions: ['validateAnalystOutput', 'enrichAnalystContext'],
      timeoutMs: 1800000 // 30 minutes
    },
    {
      name: 'ANALYST_COMPLETE',
      description: 'Business analysis phase completed, preparing for PM handoff',
      entryActions: ['generateAnalystSummary', 'prepareHandoffContext'],
      exitActions: ['validateHandoffReadiness']
    },
    {
      name: 'PM_ACTIVE',
      agent: 'PM', 
      description: 'Project manager refining scope and creating user stories',
      entryActions: ['loadPMPrompt', 'initializePMContext', 'injectAnalystContext'],
      exitActions: ['validatePMOutput', 'enrichPMContext'],
      timeoutMs: 1800000 // 30 minutes
    },
    {
      name: 'PM_COMPLETE',
      description: 'Project management phase completed, preparing for UX handoff',
      entryActions: ['generatePMSummary', 'prepareUXHandoffContext'],
      exitActions: ['validateUXHandoffReadiness']
    },
    {
      name: 'UX_EXPERT_ACTIVE',
      agent: 'UX_EXPERT',
      description: 'UX expert designing user experience and interface requirements',
      entryActions: ['loadUXPrompt', 'initializeUXContext', 'injectPMContext'],
      exitActions: ['validateUXOutput', 'enrichUXContext'],
      timeoutMs: 1800000 // 30 minutes
    },
    {
      name: 'UX_EXPERT_COMPLETE',
      description: 'UX design phase completed, preparing for architect handoff',
      entryActions: ['generateUXSummary', 'prepareArchitectHandoffContext'],
      exitActions: ['validateArchitectHandoffReadiness']
    },
    {
      name: 'ARCHITECT_ACTIVE',
      agent: 'ARCHITECT',
      description: 'Technical architect designing system architecture and implementation plan',
      entryActions: ['loadArchitectPrompt', 'initializeArchitectContext', 'injectUXContext'],
      exitActions: ['validateArchitectOutput', 'enrichArchitectContext'],
      timeoutMs: 1800000 // 30 minutes
    },
    {
      name: 'ARCHITECT_COMPLETE',
      description: 'Technical architecture phase completed, preparing final deliverables',
      entryActions: ['generateArchitectSummary', 'prepareFinalDeliverables'],
      exitActions: ['validateWorkflowCompletion']
    },
    {
      name: 'WORKFLOW_COMPLETE',
      description: 'All phases completed successfully, deliverables generated',
      entryActions: ['generateFinalReport', 'calculateWorkflowMetrics', 'triggerDeliverableGeneration']
    },
    {
      name: 'PAUSED',
      description: 'Workflow execution paused by user or system',
      entryActions: ['preserveWorkflowState', 'notifyPauseHandlers']
    },
    {
      name: 'ERROR',
      description: 'Workflow encountered an unrecoverable error',
      entryActions: ['captureErrorContext', 'initiateErrorRecovery', 'notifyErrorHandlers']
    },
    {
      name: 'CANCELLED',
      description: 'Workflow cancelled by user or system',
      entryActions: ['cleanupWorkflowResources', 'notifyCancellationHandlers']
    }
  ],

  // Define state transitions
  transitions: [
    // Initialization
    {
      from: 'INITIALIZING',
      to: 'ANALYST_ACTIVE',
      trigger: 'START',
      conditions: [
        { field: 'context.projectInput', operator: 'exists' },
        { field: 'context.projectInput', operator: 'not_equals', value: '' }
      ],
      actions: ['logWorkflowStart', 'startAnalystPhase']
    },

    // Analyst phase transitions
    {
      from: 'ANALYST_ACTIVE',
      to: 'ANALYST_COMPLETE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'analystResult.status', operator: 'equals', value: 'COMPLETE' },
        { field: 'analystResult.contextOutput', operator: 'exists' }
      ],
      actions: ['logAnalystCompletion', 'validateAnalystOutput']
    },
    {
      from: 'ANALYST_ACTIVE', 
      to: 'PAUSED',
      trigger: 'PAUSE',
      actions: ['pauseAnalystExecution', 'preserveAnalystState']
    },
    {
      from: 'ANALYST_ACTIVE',
      to: 'ERROR',
      trigger: 'ERROR',
      actions: ['captureAnalystError', 'initiateRecovery']
    },
    {
      from: 'ANALYST_ACTIVE',
      to: 'CANCELLED',
      trigger: 'CANCEL',
      actions: ['cancelAnalystExecution', 'cleanupAnalystResources']
    },

    // Analyst to PM transition
    {
      from: 'ANALYST_COMPLETE',
      to: 'PM_ACTIVE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'handoffContext.analystSummary', operator: 'exists' },
        { field: 'handoffContext.validationPassed', operator: 'equals', value: true }
      ],
      actions: ['logPMTransition', 'startPMPhase', 'transferAnalystContext']
    },

    // PM phase transitions  
    {
      from: 'PM_ACTIVE',
      to: 'PM_COMPLETE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'pmResult.status', operator: 'equals', value: 'COMPLETE' },
        { field: 'pmResult.contextOutput', operator: 'exists' }
      ],
      actions: ['logPMCompletion', 'validatePMOutput']
    },
    {
      from: 'PM_ACTIVE',
      to: 'PAUSED', 
      trigger: 'PAUSE',
      actions: ['pausePMExecution', 'preservePMState']
    },
    {
      from: 'PM_ACTIVE',
      to: 'ERROR',
      trigger: 'ERROR',
      actions: ['capturePMError', 'initiateRecovery']
    },
    {
      from: 'PM_ACTIVE',
      to: 'CANCELLED',
      trigger: 'CANCEL',
      actions: ['cancelPMExecution', 'cleanupPMResources']
    },

    // PM to UX transition
    {
      from: 'PM_COMPLETE',
      to: 'UX_EXPERT_ACTIVE', 
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'handoffContext.pmSummary', operator: 'exists' },
        { field: 'handoffContext.validationPassed', operator: 'equals', value: true }
      ],
      actions: ['logUXTransition', 'startUXPhase', 'transferPMContext']
    },

    // UX Expert phase transitions
    {
      from: 'UX_EXPERT_ACTIVE',
      to: 'UX_EXPERT_COMPLETE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'uxResult.status', operator: 'equals', value: 'COMPLETE' },
        { field: 'uxResult.contextOutput', operator: 'exists' }
      ],
      actions: ['logUXCompletion', 'validateUXOutput']
    },
    {
      from: 'UX_EXPERT_ACTIVE',
      to: 'PAUSED',
      trigger: 'PAUSE',
      actions: ['pauseUXExecution', 'preserveUXState']
    },
    {
      from: 'UX_EXPERT_ACTIVE',
      to: 'ERROR',
      trigger: 'ERROR', 
      actions: ['captureUXError', 'initiateRecovery']
    },
    {
      from: 'UX_EXPERT_ACTIVE',
      to: 'CANCELLED',
      trigger: 'CANCEL',
      actions: ['cancelUXExecution', 'cleanupUXResources']
    },

    // UX to Architect transition
    {
      from: 'UX_EXPERT_COMPLETE',
      to: 'ARCHITECT_ACTIVE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'handoffContext.uxSummary', operator: 'exists' },
        { field: 'handoffContext.validationPassed', operator: 'equals', value: true }
      ],
      actions: ['logArchitectTransition', 'startArchitectPhase', 'transferUXContext']
    },

    // Architect phase transitions
    {
      from: 'ARCHITECT_ACTIVE',
      to: 'ARCHITECT_COMPLETE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'architectResult.status', operator: 'equals', value: 'COMPLETE' },
        { field: 'architectResult.contextOutput', operator: 'exists' }
      ],
      actions: ['logArchitectCompletion', 'validateArchitectOutput']
    },
    {
      from: 'ARCHITECT_ACTIVE',
      to: 'PAUSED',
      trigger: 'PAUSE',
      actions: ['pauseArchitectExecution', 'preserveArchitectState']
    },
    {
      from: 'ARCHITECT_ACTIVE',
      to: 'ERROR',
      trigger: 'ERROR',
      actions: ['captureArchitectError', 'initiateRecovery']
    },
    {
      from: 'ARCHITECT_ACTIVE',
      to: 'CANCELLED',
      trigger: 'CANCEL',
      actions: ['cancelArchitectExecution', 'cleanupArchitectResources']
    },

    // Architect to workflow completion
    {
      from: 'ARCHITECT_COMPLETE',
      to: 'WORKFLOW_COMPLETE',
      trigger: 'AGENT_COMPLETE',
      conditions: [
        { field: 'workflowContext.allPhasesComplete', operator: 'equals', value: true },
        { field: 'deliverables', operator: 'exists' }
      ],
      actions: ['logWorkflowCompletion', 'finalizeDeliverables', 'calculateFinalMetrics']
    },

    // Resume from pause
    {
      from: 'PAUSED',
      to: 'ANALYST_ACTIVE',
      trigger: 'RESUME',
      conditions: [
        { field: 'pauseContext.currentAgent', operator: 'equals', value: 'ANALYST' }
      ],
      actions: ['resumeAnalystExecution', 'restoreAnalystState']
    },
    {
      from: 'PAUSED',
      to: 'PM_ACTIVE',
      trigger: 'RESUME',
      conditions: [
        { field: 'pauseContext.currentAgent', operator: 'equals', value: 'PM' }
      ],
      actions: ['resumePMExecution', 'restorePMState']
    },
    {
      from: 'PAUSED',
      to: 'UX_EXPERT_ACTIVE',
      trigger: 'RESUME',
      conditions: [
        { field: 'pauseContext.currentAgent', operator: 'equals', value: 'UX_EXPERT' }
      ],
      actions: ['resumeUXExecution', 'restoreUXState']
    },
    {
      from: 'PAUSED',
      to: 'ARCHITECT_ACTIVE',
      trigger: 'RESUME', 
      conditions: [
        { field: 'pauseContext.currentAgent', operator: 'equals', value: 'ARCHITECT' }
      ],
      actions: ['resumeArchitectExecution', 'restoreArchitectState']
    },
    {
      from: 'PAUSED',
      to: 'CANCELLED',
      trigger: 'CANCEL',
      actions: ['cancelFromPause', 'cleanupPausedResources']
    },

    // Force transitions for testing/admin
    {
      from: 'ANALYST_COMPLETE',
      to: 'PM_ACTIVE',
      trigger: 'FORCE_TRANSITION',
      actions: ['forceStartPMPhase', 'logForcedTransition']
    },
    {
      from: 'PM_COMPLETE',
      to: 'UX_EXPERT_ACTIVE',
      trigger: 'FORCE_TRANSITION',
      actions: ['forceStartUXPhase', 'logForcedTransition']
    },
    {
      from: 'UX_EXPERT_COMPLETE',
      to: 'ARCHITECT_ACTIVE',
      trigger: 'FORCE_TRANSITION',
      actions: ['forceStartArchitectPhase', 'logForcedTransition']
    },
    {
      from: 'ARCHITECT_COMPLETE',
      to: 'WORKFLOW_COMPLETE',
      trigger: 'FORCE_TRANSITION',
      actions: ['forceWorkflowCompletion', 'logForcedTransition']
    }
  ],

  // Initial and final states
  initialState: 'INITIALIZING',
  finalStates: ['WORKFLOW_COMPLETE', 'ERROR', 'CANCELLED'],

  // Workflow configuration
  configuration: {
    maxExecutionTime: 7200000, // 2 hours total
    maxAgentSwitches: 6, // Allow some retries
    allowPause: true,
    allowResume: true,
    requiredContext: [
      'projectInput',
      'sessionId'
    ]
  }
};

// Validate the workflow definition at module load
try {
  WorkflowDefinitionSchema.parse(GREENFIELD_FULLSTACK_WORKFLOW);
} catch (error) {
  throw new Error(`Invalid greenfield-fullstack workflow definition: ${error}`);
}

// Export utility functions for this workflow
export function isGreenfieldWorkflowState(state: string): state is WorkflowState {
  return GREENFIELD_FULLSTACK_WORKFLOW.states.some(s => s.name === state);
}

export function getGreenfieldTransitions(fromState: WorkflowState): Array<{to: WorkflowState, trigger: WorkflowTrigger}> {
  return GREENFIELD_FULLSTACK_WORKFLOW.transitions
    .filter(t => t.from === fromState)
    .map(t => ({ to: t.to, trigger: t.trigger }));
}

export function getGreenfieldStateConfig(state: WorkflowState) {
  return GREENFIELD_FULLSTACK_WORKFLOW.states.find(s => s.name === state);
}

export function validateGreenfieldTransition(from: WorkflowState, to: WorkflowState, trigger: WorkflowTrigger): boolean {
  return GREENFIELD_FULLSTACK_WORKFLOW.transitions.some(t => 
    t.from === from && t.to === to && t.trigger === trigger
  );
}

export default GREENFIELD_FULLSTACK_WORKFLOW;