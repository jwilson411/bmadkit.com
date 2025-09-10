import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { 
  WorkflowDefinition,
  WorkflowExecutionState,
  WorkflowState,
  WorkflowTrigger,
  WorkflowTransition,
  canTransition,
  generateWorkflowId
} from '../models/workflow-models';

export interface StateMachineConfig {
  enableLogging?: boolean;
  enableMetrics?: boolean;
  strictValidation?: boolean;
  maxTransitionHistory?: number;
}

export interface StateMachineMetrics {
  totalTransitions: number;
  transitionsByState: Record<WorkflowState, number>;
  transitionsByTrigger: Record<WorkflowTrigger, number>;
  averageTransitionTime: number;
  errorCount: number;
  lastTransitionTime?: Date;
}

export interface TransitionContext {
  trigger: WorkflowTrigger;
  timestamp: Date;
  metadata?: Record<string, any>;
  conditions?: Record<string, any>;
  skipValidation?: boolean;
}

export interface TransitionResult {
  success: boolean;
  fromState: WorkflowState;
  toState: WorkflowState;
  trigger: WorkflowTrigger;
  timestamp: Date;
  transitionId: string;
  executedActions: string[];
  errors?: string[];
  metadata?: Record<string, any>;
}

/**
 * Workflow State Machine
 * 
 * Manages state transitions for workflow execution based on workflow definitions.
 * Provides event-driven architecture with validation, metrics, and error handling.
 */
export class WorkflowStateMachine extends EventEmitter {
  private workflowDefinition: WorkflowDefinition;
  private executionState: WorkflowExecutionState;
  private config: StateMachineConfig;
  private metrics: StateMachineMetrics;
  private transitionInProgress = false;

  constructor(
    workflowDefinition: WorkflowDefinition,
    executionState: WorkflowExecutionState,
    config: StateMachineConfig = {}
  ) {
    super();
    
    this.workflowDefinition = workflowDefinition;
    this.executionState = executionState;
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      strictValidation: true,
      maxTransitionHistory: 1000,
      ...config
    };

    this.metrics = {
      totalTransitions: 0,
      transitionsByState: {} as Record<WorkflowState, number>,
      transitionsByTrigger: {} as Record<WorkflowTrigger, number>,
      averageTransitionTime: 0,
      errorCount: 0
    };

    this.initializeStateMachine();
  }

  private initializeStateMachine(): void {
    // Validate initial state
    if (!this.isValidState(this.executionState.currentState)) {
      throw new Error(`Invalid initial state: ${this.executionState.currentState}`);
    }

    if (this.config.enableLogging) {
      logger.info('Workflow state machine initialized', {
        workflowId: this.executionState.id,
        workflowDefinition: this.workflowDefinition.id,
        initialState: this.executionState.currentState
      });
    }

    // Set up event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('transition', (result: TransitionResult) => {
      if (this.config.enableMetrics) {
        this.updateMetrics(result);
      }
    });

    this.on('error', (error: Error, context: any) => {
      if (this.config.enableLogging) {
        logger.error('State machine error', {
          workflowId: this.executionState.id,
          error: error.message,
          context
        });
      }
    });
  }

  /**
   * Attempt a state transition
   */
  async transition(trigger: WorkflowTrigger, context: Partial<TransitionContext> = {}): Promise<TransitionResult> {
    if (this.transitionInProgress) {
      throw new Error('Transition already in progress');
    }

    this.transitionInProgress = true;
    const startTime = Date.now();
    const transitionId = generateWorkflowId();

    try {
      const transitionContext: TransitionContext = {
        trigger,
        timestamp: new Date(),
        metadata: {},
        conditions: {},
        skipValidation: false,
        ...context
      };

      // Find valid transition
      const transition = this.findValidTransition(
        this.executionState.currentState,
        trigger,
        transitionContext
      );

      if (!transition) {
        const error = `No valid transition from ${this.executionState.currentState} with trigger ${trigger}`;
        this.emit('error', new Error(error), { 
          currentState: this.executionState.currentState,
          trigger,
          context: transitionContext
        });
        
        return {
          success: false,
          fromState: this.executionState.currentState,
          toState: this.executionState.currentState,
          trigger,
          timestamp: transitionContext.timestamp,
          transitionId,
          executedActions: [],
          errors: [error]
        };
      }

      // Validate transition conditions
      if (!transitionContext.skipValidation && this.config.strictValidation) {
        const conditionErrors = await this.validateTransitionConditions(transition, transitionContext);
        if (conditionErrors.length > 0) {
          return {
            success: false,
            fromState: this.executionState.currentState,
            toState: transition.to,
            trigger,
            timestamp: transitionContext.timestamp,
            transitionId,
            executedActions: [],
            errors: conditionErrors
          };
        }
      }

      // Execute exit actions for current state
      const exitActions = await this.executeExitActions(this.executionState.currentState);

      // Perform state transition
      const fromState = this.executionState.currentState;
      this.executionState.currentState = transition.to;

      // Record transition in execution state
      const workflowTransition: WorkflowTransition = {
        id: transitionId,
        fromState,
        toState: transition.to,
        trigger,
        timestamp: transitionContext.timestamp,
        metadata: transitionContext.metadata
      };

      this.executionState.transitions.push(workflowTransition);

      // Execute entry actions for new state  
      const entryActions = await this.executeEntryActions(transition.to);

      // Execute transition actions
      const transitionActions = await this.executeTransitionActions(transition);

      const result: TransitionResult = {
        success: true,
        fromState,
        toState: transition.to,
        trigger,
        timestamp: transitionContext.timestamp,
        transitionId,
        executedActions: [...exitActions, ...entryActions, ...transitionActions],
        metadata: transitionContext.metadata
      };

      if (this.config.enableLogging) {
        logger.info('Workflow state transition completed', {
          workflowId: this.executionState.id,
          transitionId,
          fromState,
          toState: transition.to,
          trigger,
          duration: Date.now() - startTime,
          actionsExecuted: result.executedActions.length
        });
      }

      // Emit transition event
      this.emit('transition', result);

      // Check if reached terminal state
      if (this.isTerminalState(transition.to)) {
        this.emit('workflow-complete', {
          workflowId: this.executionState.id,
          finalState: transition.to,
          totalTransitions: this.executionState.transitions.length
        });
      }

      return result;

    } catch (error) {
      const errorResult: TransitionResult = {
        success: false,
        fromState: this.executionState.currentState,
        toState: this.executionState.currentState,
        trigger,
        timestamp: new Date(),
        transitionId,
        executedActions: [],
        errors: [(error as Error).message]
      };

      this.emit('error', error, { trigger, context });
      return errorResult;

    } finally {
      this.transitionInProgress = false;
    }
  }

  private findValidTransition(
    fromState: WorkflowState, 
    trigger: WorkflowTrigger,
    context: TransitionContext
  ) {
    return this.workflowDefinition.transitions.find(t =>
      t.from === fromState && 
      t.trigger === trigger &&
      this.isTransitionAllowed(t, context)
    );
  }

  private isTransitionAllowed(transition: any, context: TransitionContext): boolean {
    // Check basic state machine rules
    if (!canTransition(transition.from, transition.to, transition.trigger)) {
      return false;
    }

    // Additional custom validation can be added here
    return true;
  }

  private async validateTransitionConditions(transition: any, context: TransitionContext): Promise<string[]> {
    const errors: string[] = [];

    if (!transition.conditions) {
      return errors;
    }

    for (const condition of transition.conditions) {
      try {
        const isValid = await this.evaluateCondition(condition, context);
        if (!isValid) {
          errors.push(`Condition failed: ${condition.field} ${condition.operator} ${condition.value}`);
        }
      } catch (error) {
        errors.push(`Condition evaluation error: ${(error as Error).message}`);
      }
    }

    return errors;
  }

  private async evaluateCondition(condition: any, context: TransitionContext): Promise<boolean> {
    const { field, operator, value } = condition;
    
    // Get field value from execution state or context
    const fieldValue = this.getFieldValue(field);

    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'contains':
        return Array.isArray(fieldValue) ? fieldValue.includes(value) : 
               typeof fieldValue === 'string' ? fieldValue.includes(value) : false;
      case 'not_contains':
        return Array.isArray(fieldValue) ? !fieldValue.includes(value) :
               typeof fieldValue === 'string' ? !fieldValue.includes(value) : true;
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  private getFieldValue(fieldPath: string): any {
    const parts = fieldPath.split('.');
    let current: any = this.executionState;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private async executeExitActions(state: WorkflowState): Promise<string[]> {
    const stateConfig = this.workflowDefinition.states.find(s => s.name === state);
    if (!stateConfig?.exitActions) {
      return [];
    }

    const executedActions: string[] = [];
    for (const action of stateConfig.exitActions) {
      try {
        await this.executeAction(action, 'exit', state);
        executedActions.push(action);
      } catch (error) {
        logger.error('Exit action failed', {
          workflowId: this.executionState.id,
          state,
          action,
          error: (error as Error).message
        });
      }
    }

    return executedActions;
  }

  private async executeEntryActions(state: WorkflowState): Promise<string[]> {
    const stateConfig = this.workflowDefinition.states.find(s => s.name === state);
    if (!stateConfig?.entryActions) {
      return [];
    }

    const executedActions: string[] = [];
    for (const action of stateConfig.entryActions) {
      try {
        await this.executeAction(action, 'entry', state);
        executedActions.push(action);
      } catch (error) {
        logger.error('Entry action failed', {
          workflowId: this.executionState.id,
          state,
          action,
          error: (error as Error).message
        });
      }
    }

    return executedActions;
  }

  private async executeTransitionActions(transition: any): Promise<string[]> {
    if (!transition.actions) {
      return [];
    }

    const executedActions: string[] = [];
    for (const action of transition.actions) {
      try {
        await this.executeAction(action, 'transition', transition.to);
        executedActions.push(action);
      } catch (error) {
        logger.error('Transition action failed', {
          workflowId: this.executionState.id,
          fromState: transition.from,
          toState: transition.to,
          action,
          error: (error as Error).message
        });
      }
    }

    return executedActions;
  }

  private async executeAction(action: string, actionType: 'entry' | 'exit' | 'transition', state: WorkflowState): Promise<void> {
    // Emit action event for external handlers
    this.emit('action', {
      workflowId: this.executionState.id,
      action,
      actionType,
      state,
      timestamp: new Date()
    });

    // Actions are handled by external systems via events
    // This allows for flexible action implementation without tight coupling
  }

  private updateMetrics(result: TransitionResult): void {
    this.metrics.totalTransitions++;
    
    // Update state-specific metrics
    if (!this.metrics.transitionsByState[result.fromState]) {
      this.metrics.transitionsByState[result.fromState] = 0;
    }
    this.metrics.transitionsByState[result.fromState]++;

    // Update trigger-specific metrics
    if (!this.metrics.transitionsByTrigger[result.trigger]) {
      this.metrics.transitionsByTrigger[result.trigger] = 0;
    }
    this.metrics.transitionsByTrigger[result.trigger]++;

    this.metrics.lastTransitionTime = result.timestamp;

    if (!result.success) {
      this.metrics.errorCount++;
    }
  }

  // Public getter methods
  getCurrentState(): WorkflowState {
    return this.executionState.currentState;
  }

  getExecutionState(): WorkflowExecutionState {
    return { ...this.executionState }; // Return copy
  }

  getWorkflowDefinition(): WorkflowDefinition {
    return this.workflowDefinition;
  }

  getMetrics(): StateMachineMetrics {
    return { ...this.metrics };
  }

  getAvailableTransitions(): Array<{to: WorkflowState, trigger: WorkflowTrigger}> {
    return this.workflowDefinition.transitions
      .filter(t => t.from === this.executionState.currentState)
      .map(t => ({ to: t.to, trigger: t.trigger }));
  }

  isTerminalState(state?: WorkflowState): boolean {
    const stateToCheck = state || this.executionState.currentState;
    return this.workflowDefinition.finalStates.includes(stateToCheck);
  }

  isValidState(state: WorkflowState): boolean {
    return this.workflowDefinition.states.some(s => s.name === state);
  }

  canTransitionTo(targetState: WorkflowState, trigger: WorkflowTrigger): boolean {
    return this.workflowDefinition.transitions.some(t =>
      t.from === this.executionState.currentState &&
      t.to === targetState &&
      t.trigger === trigger
    );
  }

  // Validation methods
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate current state exists in definition
    if (!this.isValidState(this.executionState.currentState)) {
      errors.push(`Current state ${this.executionState.currentState} not found in workflow definition`);
    }

    // Validate execution state consistency
    if (this.executionState.currentAgent && !this.getCurrentAgentFromState()) {
      errors.push('Current agent does not match current state');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private getCurrentAgentFromState() {
    const stateConfig = this.workflowDefinition.states.find(s => s.name === this.executionState.currentState);
    return stateConfig?.agent;
  }

  // State machine inspection
  getStateHistory(): WorkflowTransition[] {
    return this.executionState.transitions.slice();
  }

  getLastTransition(): WorkflowTransition | null {
    const transitions = this.executionState.transitions;
    return transitions.length > 0 ? transitions[transitions.length - 1] : null;
  }

  // Reset and cleanup
  reset(): void {
    this.executionState.currentState = this.workflowDefinition.initialState;
    this.executionState.transitions = [];
    this.metrics = {
      totalTransitions: 0,
      transitionsByState: {} as Record<WorkflowState, number>,
      transitionsByTrigger: {} as Record<WorkflowTrigger, number>,
      averageTransitionTime: 0,
      errorCount: 0
    };

    this.emit('reset', { workflowId: this.executionState.id });
  }

  shutdown(): void {
    this.removeAllListeners();
    
    if (this.config.enableLogging) {
      logger.info('Workflow state machine shutdown', {
        workflowId: this.executionState.id,
        totalTransitions: this.metrics.totalTransitions
      });
    }
  }
}