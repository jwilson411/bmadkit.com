import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { sessionManager } from './session-manager';
import { conversationHistory } from './conversation-history';
import { WorkflowStateMachine, TransitionResult, TransitionContext } from '../workflows/workflow-state-machine';
import { GREENFIELD_FULLSTACK_WORKFLOW } from '../workflows/greenfield-fullstack';
import { 
  WorkflowDefinition,
  WorkflowExecutionState,
  WorkflowExecutionStateSchema,
  WorkflowState,
  WorkflowTrigger,
  AgentPhase,
  AgentExecutionResult,
  WorkflowContext,
  generateWorkflowId,
  generateExecutionId,
  getAgentStateFromPhase,
  getCompletedStateFromPhase,
  getNextAgentPhase
} from '../models/workflow-models';

export interface WorkflowOrchestratorConfig {
  enablePersistence: boolean;
  enableMetrics: boolean;
  enableRecovery: boolean;
  maxConcurrentWorkflows: number;
  maxWorkflowDuration: number; // milliseconds
  workflowTimeoutGracePeriod: number; // milliseconds
  enableAgentValidation: boolean;
  enableContextValidation: boolean;
}

export interface WorkflowExecutionRequest {
  sessionId: string;
  workflowId?: string; // optional, defaults to greenfield-fullstack
  context: WorkflowContext;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface WorkflowExecutionResponse {
  workflowExecutionId: string;
  sessionId: string;
  currentState: WorkflowState;
  currentAgent?: AgentPhase;
  availableActions: Array<{
    trigger: WorkflowTrigger;
    description: string;
    requiresInput?: boolean;
  }>;
  progress: {
    percentage: number;
    completedPhases: AgentPhase[];
    currentPhase?: AgentPhase;
    nextPhase?: AgentPhase;
  };
  metrics: {
    startTime: Date;
    duration: number; // milliseconds
    agentSwitches: number;
    userInteractions: number;
  };
}

export interface AgentInteractionRequest {
  workflowExecutionId: string;
  userInput?: string;
  action: 'continue' | 'pause' | 'restart' | 'cancel';
  metadata?: Record<string, any>;
}

export interface AgentInteractionResponse {
  success: boolean;
  workflowExecutionId: string;
  currentState: WorkflowState;
  agentResponse?: {
    message: string;
    type: 'question' | 'clarification' | 'confirmation' | 'handoff' | 'summary';
    requiresResponse: boolean;
    metadata?: Record<string, any>;
  };
  stateChange?: {
    fromState: WorkflowState;
    toState: WorkflowState;
    trigger: WorkflowTrigger;
  };
  errors?: string[];
}

/**
 * Workflow Orchestrator
 * 
 * Central orchestration service managing complex BMAD agent workflows.
 * Coordinates agent transitions, manages conversation flow, and ensures
 * workflow state consistency across the entire planning process.
 */
export class WorkflowOrchestrator extends EventEmitter {
  private config: WorkflowOrchestratorConfig;
  private activeWorkflows = new Map<string, {
    stateMachine: WorkflowStateMachine;
    executionState: WorkflowExecutionState;
    definition: WorkflowDefinition;
    sessionId: string;
    lastActivity: Date;
  }>();
  
  private workflowDefinitions = new Map<string, WorkflowDefinition>();
  private isInitialized = false;

  constructor(config: Partial<WorkflowOrchestratorConfig> = {}) {
    super();
    
    this.config = {
      enablePersistence: true,
      enableMetrics: true, 
      enableRecovery: true,
      maxConcurrentWorkflows: 100,
      maxWorkflowDuration: 7200000, // 2 hours
      workflowTimeoutGracePeriod: 300000, // 5 minutes
      enableAgentValidation: true,
      enableContextValidation: true,
      ...config
    };

    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load workflow definitions
      await this.loadWorkflowDefinitions();

      // Set up cleanup intervals
      this.setupCleanupIntervals();

      // Initialize metrics
      if (this.config.enableMetrics) {
        this.setupMetricsCollection();
      }

      this.isInitialized = true;
      
      logger.info('Workflow orchestrator initialized', {
        workflowDefinitions: this.workflowDefinitions.size,
        maxConcurrentWorkflows: this.config.maxConcurrentWorkflows
      });

      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize workflow orchestrator', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async loadWorkflowDefinitions(): Promise<void> {
    // Load greenfield-fullstack workflow
    this.workflowDefinitions.set(
      GREENFIELD_FULLSTACK_WORKFLOW.id,
      GREENFIELD_FULLSTACK_WORKFLOW
    );

    logger.info('Loaded workflow definitions', {
      definitions: Array.from(this.workflowDefinitions.keys())
    });
  }

  private setupEventHandlers(): void {
    // Handle state machine transitions
    this.on('workflow-transition', this.handleWorkflowTransition.bind(this));
    
    // Handle agent execution events
    this.on('agent-execution-complete', this.handleAgentExecutionComplete.bind(this));
    
    // Handle workflow completion
    this.on('workflow-complete', this.handleWorkflowComplete.bind(this));
  }

  private setupCleanupIntervals(): void {
    // Clean up inactive workflows every 10 minutes
    setInterval(() => {
      this.cleanupInactiveWorkflows();
    }, 10 * 60 * 1000);
  }

  private setupMetricsCollection(): void {
    // Collect workflow metrics every 5 minutes
    setInterval(() => {
      this.collectWorkflowMetrics();
    }, 5 * 60 * 1000);
  }

  /**
   * Start a new workflow execution
   */
  async startWorkflow(request: WorkflowExecutionRequest): Promise<WorkflowExecutionResponse> {
    this.ensureInitialized();

    if (this.activeWorkflows.size >= this.config.maxConcurrentWorkflows) {
      throw new Error('Maximum concurrent workflows limit reached');
    }

    const workflowId = request.workflowId || 'greenfield-fullstack';
    const workflowDefinition = this.workflowDefinitions.get(workflowId);
    
    if (!workflowDefinition) {
      throw new Error(`Unknown workflow definition: ${workflowId}`);
    }

    // Validate context if enabled
    if (this.config.enableContextValidation) {
      await this.validateWorkflowContext(request.context, workflowDefinition);
    }

    // Create execution state
    const executionId = generateWorkflowId();
    const executionState: WorkflowExecutionState = {
      id: executionId,
      sessionId: request.sessionId,
      workflowDefinitionId: workflowId,
      currentState: workflowDefinition.initialState,
      context: request.context,
      agentResults: [],
      transitions: [],
      startTime: new Date(),
      metrics: {
        agentSwitches: 0,
        userInteractions: 0,
        totalTokensUsed: 0,
        totalCost: 0
      },
      metadata: request.metadata || {}
    };

    // Create state machine
    const stateMachine = new WorkflowStateMachine(
      workflowDefinition,
      executionState,
      {
        enableLogging: true,
        enableMetrics: this.config.enableMetrics,
        strictValidation: true
      }
    );

    // Set up state machine event handlers
    this.setupStateMachineHandlers(stateMachine, executionId);

    // Store workflow
    this.activeWorkflows.set(executionId, {
      stateMachine,
      executionState,
      definition: workflowDefinition,
      sessionId: request.sessionId,
      lastActivity: new Date()
    });

    // Persist initial state if enabled
    if (this.config.enablePersistence) {
      await this.persistWorkflowState(executionId);
    }

    logger.info('Workflow execution started', {
      workflowExecutionId: executionId,
      sessionId: request.sessionId,
      workflowDefinition: workflowId,
      initialState: executionState.currentState
    });

    // Start the workflow
    await this.triggerWorkflowTransition(executionId, 'START');

    return this.buildExecutionResponse(executionId);
  }

  /**
   * Process user interaction with active workflow
   */
  async processInteraction(request: AgentInteractionRequest): Promise<AgentInteractionResponse> {
    this.ensureInitialized();

    const workflow = this.activeWorkflows.get(request.workflowExecutionId);
    if (!workflow) {
      return {
        success: false,
        workflowExecutionId: request.workflowExecutionId,
        currentState: 'ERROR' as WorkflowState,
        errors: ['Workflow not found or expired']
      };
    }

    workflow.lastActivity = new Date();

    try {
      let response: AgentInteractionResponse = {
        success: true,
        workflowExecutionId: request.workflowExecutionId,
        currentState: workflow.stateMachine.getCurrentState()
      };

      // Handle different action types
      switch (request.action) {
        case 'continue':
          response = await this.handleContinueAction(workflow, request);
          break;
        
        case 'pause':
          response = await this.handlePauseAction(workflow, request);
          break;
        
        case 'restart':
          response = await this.handleRestartAction(workflow, request);
          break;
        
        case 'cancel':
          response = await this.handleCancelAction(workflow, request);
          break;
        
        default:
          throw new Error(`Unknown action: ${request.action}`);
      }

      // Update metrics
      workflow.executionState.metrics.userInteractions++;

      // Persist updated state
      if (this.config.enablePersistence) {
        await this.persistWorkflowState(request.workflowExecutionId);
      }

      return response;

    } catch (error) {
      logger.error('Failed to process workflow interaction', {
        workflowExecutionId: request.workflowExecutionId,
        action: request.action,
        error: (error as Error).message
      });

      return {
        success: false,
        workflowExecutionId: request.workflowExecutionId,
        currentState: workflow.stateMachine.getCurrentState(),
        errors: [(error as Error).message]
      };
    }
  }

  private async handleContinueAction(
    workflow: any, 
    request: AgentInteractionRequest
  ): Promise<AgentInteractionResponse> {
    
    const currentState = workflow.stateMachine.getCurrentState();
    
    // Store user input if provided
    if (request.userInput) {
      await this.recordUserInput(workflow, request.userInput, request.metadata);
    }

    // Determine next action based on current state
    if (currentState === 'PAUSED') {
      // Resume workflow
      const result = await workflow.stateMachine.transition('RESUME');
      return this.buildInteractionResponse(workflow, result, request.workflowExecutionId);
    } 
    else if (this.isAgentActiveState(currentState)) {
      // Continue agent execution
      return await this.continueAgentExecution(workflow, request);
    }
    else if (this.isAgentCompleteState(currentState)) {
      // Transition to next agent
      const result = await workflow.stateMachine.transition('AGENT_COMPLETE');
      return this.buildInteractionResponse(workflow, result, request.workflowExecutionId);
    }
    else {
      throw new Error(`Cannot continue from state: ${currentState}`);
    }
  }

  private async handlePauseAction(
    workflow: any,
    request: AgentInteractionRequest
  ): Promise<AgentInteractionResponse> {
    
    const result = await workflow.stateMachine.transition('PAUSE');
    workflow.executionState.pausedAt = new Date();
    
    return this.buildInteractionResponse(workflow, result, request.workflowExecutionId);
  }

  private async handleRestartAction(
    workflow: any,
    request: AgentInteractionRequest
  ): Promise<AgentInteractionResponse> {
    
    // Reset workflow to initial state
    workflow.stateMachine.reset();
    workflow.executionState.agentResults = [];
    workflow.executionState.startTime = new Date();
    workflow.executionState.endTime = undefined;
    workflow.executionState.pausedAt = undefined;
    workflow.executionState.resumedAt = undefined;
    
    // Restart workflow
    const result = await workflow.stateMachine.transition('START');
    
    return this.buildInteractionResponse(workflow, result, request.workflowExecutionId);
  }

  private async handleCancelAction(
    workflow: any,
    request: AgentInteractionRequest
  ): Promise<AgentInteractionResponse> {
    
    const result = await workflow.stateMachine.transition('CANCEL');
    workflow.executionState.endTime = new Date();
    
    // Remove from active workflows
    this.activeWorkflows.delete(request.workflowExecutionId);
    
    return this.buildInteractionResponse(workflow, result, request.workflowExecutionId);
  }

  private async continueAgentExecution(
    workflow: any,
    request: AgentInteractionRequest
  ): Promise<AgentInteractionResponse> {
    
    const currentAgent = this.getCurrentAgentFromState(workflow.stateMachine.getCurrentState());
    if (!currentAgent) {
      throw new Error('No active agent found');
    }

    // This will be implemented with individual agent execution
    // For now, simulate agent completion
    const result = await workflow.stateMachine.transition('AGENT_COMPLETE');
    
    return this.buildInteractionResponse(workflow, result, request.workflowExecutionId);
  }

  private buildInteractionResponse(
    workflow: any,
    transitionResult: TransitionResult,
    workflowExecutionId: string
  ): AgentInteractionResponse {
    
    const response: AgentInteractionResponse = {
      success: transitionResult.success,
      workflowExecutionId,
      currentState: workflow.stateMachine.getCurrentState(),
      errors: transitionResult.errors
    };

    if (transitionResult.success && transitionResult.fromState !== transitionResult.toState) {
      response.stateChange = {
        fromState: transitionResult.fromState,
        toState: transitionResult.toState,
        trigger: transitionResult.trigger
      };
    }

    return response;
  }

  private async recordUserInput(
    workflow: any,
    userInput: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    
    // Record user input in conversation history
    await conversationHistory.addMessage({
      sessionId: workflow.sessionId,
      sender: 'USER',
      content: userInput,
      metadata: {
        workflowExecutionId: workflow.executionState.id,
        workflowState: workflow.stateMachine.getCurrentState(),
        ...metadata
      }
    });
  }

  private buildExecutionResponse(workflowExecutionId: string): WorkflowExecutionResponse {
    const workflow = this.activeWorkflows.get(workflowExecutionId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const currentState = workflow.stateMachine.getCurrentState();
    const availableTransitions = workflow.stateMachine.getAvailableTransitions();
    
    return {
      workflowExecutionId,
      sessionId: workflow.sessionId,
      currentState,
      currentAgent: this.getCurrentAgentFromState(currentState),
      availableActions: this.buildAvailableActions(availableTransitions),
      progress: this.calculateProgress(workflow.executionState),
      metrics: {
        startTime: workflow.executionState.startTime,
        duration: Date.now() - workflow.executionState.startTime.getTime(),
        agentSwitches: workflow.executionState.metrics.agentSwitches,
        userInteractions: workflow.executionState.metrics.userInteractions
      }
    };
  }

  private buildAvailableActions(transitions: Array<{to: WorkflowState, trigger: WorkflowTrigger}>) {
    return transitions.map(t => ({
      trigger: t.trigger,
      description: this.getActionDescription(t.trigger),
      requiresInput: this.actionRequiresInput(t.trigger)
    }));
  }

  private getActionDescription(trigger: WorkflowTrigger): string {
    const descriptions: Record<WorkflowTrigger, string> = {
      'START': 'Start the workflow',
      'AGENT_COMPLETE': 'Continue to next phase',
      'USER_INPUT': 'Provide user input',
      'PAUSE': 'Pause the workflow',
      'RESUME': 'Resume the workflow',
      'ERROR': 'Handle error',
      'CANCEL': 'Cancel the workflow',
      'FORCE_TRANSITION': 'Force state transition'
    };
    return descriptions[trigger] || 'Unknown action';
  }

  private actionRequiresInput(trigger: WorkflowTrigger): boolean {
    return ['USER_INPUT'].includes(trigger);
  }

  private calculateProgress(executionState: WorkflowExecutionState) {
    const allPhases: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    const completedPhases: AgentPhase[] = [];
    
    // Determine completed phases based on agent results
    for (const result of executionState.agentResults) {
      if (result.status === 'COMPLETE') {
        completedPhases.push(result.agentPhase);
      }
    }

    const currentAgent = this.getCurrentAgentFromState(executionState.currentState);
    const nextAgent = currentAgent ? getNextAgentPhase(currentAgent) : null;
    
    return {
      percentage: Math.round((completedPhases.length / allPhases.length) * 100),
      completedPhases,
      currentPhase: currentAgent || undefined,
      nextPhase: nextAgent || undefined
    };
  }

  private getCurrentAgentFromState(state: WorkflowState): AgentPhase | undefined {
    const agentMapping: Partial<Record<WorkflowState, AgentPhase>> = {
      'ANALYST_ACTIVE': 'ANALYST',
      'PM_ACTIVE': 'PM',
      'UX_EXPERT_ACTIVE': 'UX_EXPERT', 
      'ARCHITECT_ACTIVE': 'ARCHITECT'
    };
    return agentMapping[state];
  }

  private isAgentActiveState(state: WorkflowState): boolean {
    return ['ANALYST_ACTIVE', 'PM_ACTIVE', 'UX_EXPERT_ACTIVE', 'ARCHITECT_ACTIVE'].includes(state);
  }

  private isAgentCompleteState(state: WorkflowState): boolean {
    return ['ANALYST_COMPLETE', 'PM_COMPLETE', 'UX_EXPERT_COMPLETE', 'ARCHITECT_COMPLETE'].includes(state);
  }

  private async triggerWorkflowTransition(workflowExecutionId: string, trigger: WorkflowTrigger): Promise<void> {
    const workflow = this.activeWorkflows.get(workflowExecutionId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const result = await workflow.stateMachine.transition(trigger);
    
    if (!result.success) {
      logger.error('Workflow transition failed', {
        workflowExecutionId,
        trigger,
        errors: result.errors
      });
      throw new Error(`Workflow transition failed: ${result.errors?.join(', ')}`);
    }

    this.emit('workflow-transition', {
      workflowExecutionId,
      result
    });
  }

  private setupStateMachineHandlers(stateMachine: WorkflowStateMachine, executionId: string): void {
    stateMachine.on('transition', (result: TransitionResult) => {
      this.emit('workflow-transition', { workflowExecutionId: executionId, result });
    });

    stateMachine.on('workflow-complete', (event: any) => {
      this.emit('workflow-complete', { workflowExecutionId: executionId, ...event });
    });

    stateMachine.on('action', (actionEvent: any) => {
      this.emit('workflow-action', { workflowExecutionId: executionId, ...actionEvent });
    });
  }

  // Event handlers
  private async handleWorkflowTransition(event: { workflowExecutionId: string, result: TransitionResult }): Promise<void> {
    const workflow = this.activeWorkflows.get(event.workflowExecutionId);
    if (!workflow) return;

    // Update metrics
    if (event.result.fromState !== event.result.toState) {
      workflow.executionState.metrics.agentSwitches++;
    }

    // Handle specific transitions
    if (this.isAgentActiveState(event.result.toState)) {
      // Agent became active - start agent execution
      await this.startAgentExecution(event.workflowExecutionId, event.result.toState);
    }
  }

  private async startAgentExecution(workflowExecutionId: string, state: WorkflowState): Promise<void> {
    // This will be implemented when we create the individual agents
    logger.info('Starting agent execution', {
      workflowExecutionId,
      state,
      agent: this.getCurrentAgentFromState(state)
    });
  }

  private async handleAgentExecutionComplete(event: any): Promise<void> {
    // Handle agent completion logic
    logger.info('Agent execution completed', event);
  }

  private async handleWorkflowComplete(event: { workflowExecutionId: string }): Promise<void> {
    const workflow = this.activeWorkflows.get(event.workflowExecutionId);
    if (!workflow) return;

    workflow.executionState.endTime = new Date();
    
    // Final persistence
    if (this.config.enablePersistence) {
      await this.persistWorkflowState(event.workflowExecutionId);
    }

    // Remove from active workflows after a grace period
    setTimeout(() => {
      this.activeWorkflows.delete(event.workflowExecutionId);
    }, this.config.workflowTimeoutGracePeriod);

    logger.info('Workflow completed', {
      workflowExecutionId: event.workflowExecutionId,
      duration: workflow.executionState.endTime.getTime() - workflow.executionState.startTime.getTime(),
      agentSwitches: workflow.executionState.metrics.agentSwitches
    });
  }

  // Utility methods
  private async validateWorkflowContext(context: WorkflowContext, definition: WorkflowDefinition): Promise<void> {
    if (!context.projectInput || context.projectInput.trim().length === 0) {
      throw new Error('Project input is required');
    }

    if (definition.configuration.requiredContext) {
      for (const requiredField of definition.configuration.requiredContext) {
        if (!(requiredField in context)) {
          throw new Error(`Required context field missing: ${requiredField}`);
        }
      }
    }
  }

  private async persistWorkflowState(workflowExecutionId: string): Promise<void> {
    const workflow = this.activeWorkflows.get(workflowExecutionId);
    if (!workflow) return;

    try {
      // In a real implementation, this would persist to database
      // For now, we'll just log the persistence
      logger.debug('Persisting workflow state', {
        workflowExecutionId,
        currentState: workflow.executionState.currentState,
        transitionCount: workflow.executionState.transitions.length
      });
    } catch (error) {
      logger.error('Failed to persist workflow state', {
        workflowExecutionId,
        error: (error as Error).message
      });
    }
  }

  private cleanupInactiveWorkflows(): void {
    const now = Date.now();
    const inactiveThreshold = this.config.maxWorkflowDuration + this.config.workflowTimeoutGracePeriod;

    for (const [id, workflow] of this.activeWorkflows.entries()) {
      const inactiveTime = now - workflow.lastActivity.getTime();
      
      if (inactiveTime > inactiveThreshold) {
        logger.info('Cleaning up inactive workflow', {
          workflowExecutionId: id,
          inactiveTime: Math.round(inactiveTime / 1000),
          currentState: workflow.executionState.currentState
        });

        workflow.stateMachine.shutdown();
        this.activeWorkflows.delete(id);
      }
    }
  }

  private collectWorkflowMetrics(): void {
    if (!this.config.enableMetrics) return;

    const metrics = {
      activeWorkflows: this.activeWorkflows.size,
      workflowsByState: {} as Record<WorkflowState, number>,
      totalTransitions: 0,
      totalUserInteractions: 0
    };

    for (const workflow of this.activeWorkflows.values()) {
      const state = workflow.executionState.currentState;
      metrics.workflowsByState[state] = (metrics.workflowsByState[state] || 0) + 1;
      metrics.totalTransitions += workflow.executionState.transitions.length;
      metrics.totalUserInteractions += workflow.executionState.metrics.userInteractions;
    }

    this.emit('metrics', metrics);
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Workflow orchestrator not initialized');
    }
  }

  // Public API methods
  async getWorkflowStatus(workflowExecutionId: string): Promise<WorkflowExecutionResponse | null> {
    const workflow = this.activeWorkflows.get(workflowExecutionId);
    return workflow ? this.buildExecutionResponse(workflowExecutionId) : null;
  }

  async listActiveWorkflows(): Promise<Array<{ workflowExecutionId: string; sessionId: string; currentState: WorkflowState }>> {
    return Array.from(this.activeWorkflows.entries()).map(([id, workflow]) => ({
      workflowExecutionId: id,
      sessionId: workflow.sessionId,
      currentState: workflow.executionState.currentState
    }));
  }

  getWorkflowDefinitions(): WorkflowDefinition[] {
    return Array.from(this.workflowDefinitions.values());
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down workflow orchestrator');

    // Shutdown all active workflows
    for (const [id, workflow] of this.activeWorkflows.entries()) {
      try {
        workflow.stateMachine.shutdown();
        
        if (this.config.enablePersistence) {
          await this.persistWorkflowState(id);
        }
      } catch (error) {
        logger.error('Error during workflow shutdown', {
          workflowExecutionId: id,
          error: (error as Error).message
        });
      }
    }

    this.activeWorkflows.clear();
    this.removeAllListeners();
    this.isInitialized = false;

    logger.info('Workflow orchestrator shutdown complete');
  }
}

// Export singleton instance
export const workflowOrchestrator = new WorkflowOrchestrator();