import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { 
  AgentPhase,
  WorkflowContext,
  InteractionType,
  generateInteractionId
} from '../models/workflow-models';

export interface BaseAgentConfig {
  agentPhase: AgentPhase;
  enableMetrics: boolean;
  maxInteractions: number;
  interactionTimeout: number; // milliseconds
  enableContextValidation: boolean;
  enableResponseValidation: boolean;
}

export interface AgentInteraction {
  id: string;
  type: InteractionType;
  prompt: string;
  response?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface AgentArtifact {
  id: string;
  type: string;
  name: string;
  content: any;
  description?: string;
  metadata?: Record<string, any>;
}

export interface AgentExecutionMetrics {
  startTime: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  interactionCount: number;
  tokensUsed: number;
  cost: number;
  errorCount: number;
  successRate: number;
}

export interface AgentExecutionResult {
  success: boolean;
  agentPhase: AgentPhase;
  executionId: string;
  interactions: AgentInteraction[];
  artifacts: AgentArtifact[];
  contextOutput: Record<string, any>;
  metrics: AgentExecutionMetrics;
  errors?: Array<{
    code: string;
    message: string;
    timestamp: Date;
    recoverable: boolean;
  }>;
  warnings?: string[];
}

/**
 * Base Agent Class
 * 
 * Abstract base class for all BMAD agents. Provides common functionality
 * for agent execution, interaction management, and context handling.
 */
export abstract class BaseAgent extends EventEmitter {
  protected config: BaseAgentConfig;
  protected interactions: AgentInteraction[] = [];
  protected artifacts: AgentArtifact[] = [];
  protected metrics: AgentExecutionMetrics;
  protected isExecuting = false;

  constructor(config: BaseAgentConfig) {
    super();
    
    this.config = config;
    
    this.metrics = {
      startTime: new Date(),
      interactionCount: 0,
      tokensUsed: 0,
      cost: 0,
      errorCount: 0,
      successRate: 1.0
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('interaction-started', this.handleInteractionStarted.bind(this));
    this.on('interaction-completed', this.handleInteractionCompleted.bind(this));
    this.on('artifact-generated', this.handleArtifactGenerated.bind(this));
  }

  /**
   * Execute the agent with given context
   */
  async execute(
    executionId: string,
    context: WorkflowContext,
    userInput?: string
  ): Promise<AgentExecutionResult> {
    
    if (this.isExecuting) {
      throw new Error('Agent is already executing');
    }

    this.isExecuting = true;
    this.resetExecution();

    try {
      logger.info(`Starting ${this.config.agentPhase} agent execution`, {
        executionId,
        agentPhase: this.config.agentPhase
      });

      // Validate context
      if (this.config.enableContextValidation) {
        await this.validateContext(context);
      }

      // Initialize agent-specific context
      const enrichedContext = await this.initializeAgentContext(context, userInput);

      // Execute agent-specific logic
      const contextOutput = await this.executeAgentLogic(executionId, enrichedContext, userInput);

      // Validate output
      if (this.config.enableResponseValidation) {
        await this.validateOutput(contextOutput);
      }

      // Finalize metrics
      this.finalizeMetrics();

      const result: AgentExecutionResult = {
        success: true,
        agentPhase: this.config.agentPhase,
        executionId,
        interactions: [...this.interactions],
        artifacts: [...this.artifacts],
        contextOutput,
        metrics: { ...this.metrics }
      };

      logger.info(`${this.config.agentPhase} agent execution completed successfully`, {
        executionId,
        duration: this.metrics.duration,
        interactionCount: this.metrics.interactionCount
      });

      return result;

    } catch (error) {
      logger.error(`${this.config.agentPhase} agent execution failed`, {
        executionId,
        error: (error as Error).message
      });

      this.metrics.errorCount++;
      this.finalizeMetrics();

      return {
        success: false,
        agentPhase: this.config.agentPhase,
        executionId,
        interactions: [...this.interactions],
        artifacts: [...this.artifacts],
        contextOutput: {},
        metrics: { ...this.metrics },
        errors: [{
          code: 'EXECUTION_ERROR',
          message: (error as Error).message,
          timestamp: new Date(),
          recoverable: false
        }]
      };

    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Abstract method for agent-specific logic - must be implemented by subclasses
   */
  protected abstract executeAgentLogic(
    executionId: string,
    context: WorkflowContext,
    userInput?: string
  ): Promise<Record<string, any>>;

  /**
   * Abstract method for context validation - can be overridden by subclasses
   */
  protected abstract validateContext(context: WorkflowContext): Promise<void>;

  /**
   * Abstract method for output validation - can be overridden by subclasses
   */
  protected abstract validateOutput(output: Record<string, any>): Promise<void>;

  /**
   * Initialize agent-specific context
   */
  protected async initializeAgentContext(
    context: WorkflowContext,
    userInput?: string
  ): Promise<WorkflowContext> {
    
    const enrichedContext: WorkflowContext = {
      ...context,
      agentExecution: {
        agentPhase: this.config.agentPhase,
        startTime: new Date(),
        userInput,
        sessionId: context.projectInput // This would be passed properly in real implementation
      }
    };

    return enrichedContext;
  }

  /**
   * Create an interaction with the user or system
   */
  protected async createInteraction(
    type: InteractionType,
    prompt: string,
    userResponse?: string,
    metadata?: Record<string, any>
  ): Promise<AgentInteraction> {
    
    const interaction: AgentInteraction = {
      id: generateInteractionId(),
      type,
      prompt,
      response: userResponse,
      timestamp: new Date(),
      metadata
    };

    this.interactions.push(interaction);
    this.metrics.interactionCount++;

    // Emit event for external handling
    this.emit('interaction-started', { interaction, agentPhase: this.config.agentPhase });

    // Update token metrics
    this.updateTokenMetrics(prompt, userResponse);

    logger.debug(`${this.config.agentPhase} agent created interaction`, {
      interactionId: interaction.id,
      type: interaction.type,
      promptLength: prompt.length
    });

    this.emit('interaction-completed', { interaction, agentPhase: this.config.agentPhase });

    return interaction;
  }

  /**
   * Generate an artifact
   */
  protected generateArtifact(
    type: string,
    name: string,
    content: any,
    description?: string,
    metadata?: Record<string, any>
  ): AgentArtifact {
    
    const artifact: AgentArtifact = {
      id: generateInteractionId(),
      type,
      name,
      content,
      description,
      metadata
    };

    this.artifacts.push(artifact);

    logger.debug(`${this.config.agentPhase} agent generated artifact`, {
      artifactId: artifact.id,
      type: artifact.type,
      name: artifact.name
    });

    this.emit('artifact-generated', { artifact, agentPhase: this.config.agentPhase });

    return artifact;
  }

  /**
   * Ask a question to the user
   */
  protected async askQuestion(
    question: string,
    context?: Record<string, any>
  ): Promise<string> {
    
    const interaction = await this.createInteraction(
      'QUESTION',
      question,
      undefined,
      { expectedResponseType: 'text', ...context }
    );

    // In a real implementation, this would wait for user input
    // For now, we'll simulate a response
    const simulatedResponse = this.generateSimulatedResponse(question);
    interaction.response = simulatedResponse;

    return simulatedResponse;
  }

  /**
   * Request clarification from the user
   */
  protected async requestClarification(
    clarification: string,
    context?: Record<string, any>
  ): Promise<string> {
    
    const interaction = await this.createInteraction(
      'CLARIFICATION',
      clarification,
      undefined,
      { expectedResponseType: 'clarification', ...context }
    );

    const simulatedResponse = this.generateSimulatedResponse(clarification);
    interaction.response = simulatedResponse;

    return simulatedResponse;
  }

  /**
   * Get confirmation from the user
   */
  protected async getConfirmation(
    confirmationPrompt: string,
    context?: Record<string, any>
  ): Promise<boolean> {
    
    const interaction = await this.createInteraction(
      'CONFIRMATION',
      confirmationPrompt,
      undefined,
      { expectedResponseType: 'boolean', ...context }
    );

    const response = Math.random() > 0.5 ? 'yes' : 'no'; // Simulate confirmation
    interaction.response = response;

    return response.toLowerCase().includes('yes') || response.toLowerCase().includes('y');
  }

  /**
   * Provide a summary of the agent's work
   */
  protected async provideSummary(
    summaryContent: string,
    context?: Record<string, any>
  ): Promise<void> {
    
    await this.createInteraction(
      'SUMMARY',
      summaryContent,
      undefined,
      { interactionType: 'summary', ...context }
    );
  }

  /**
   * Update token usage metrics
   */
  private updateTokenMetrics(prompt: string, response?: string): void {
    // Simple token estimation (approximately 4 characters per token)
    const promptTokens = Math.ceil(prompt.length / 4);
    const responseTokens = response ? Math.ceil(response.length / 4) : 0;
    const totalTokens = promptTokens + responseTokens;

    this.metrics.tokensUsed += totalTokens;
    this.metrics.cost += this.estimateCost(totalTokens);
  }

  /**
   * Estimate cost based on token usage
   */
  private estimateCost(tokens: number): number {
    // Simple cost estimation ($0.002 per 1K tokens for GPT-4)
    return (tokens / 1000) * 0.002;
  }

  /**
   * Generate simulated response for testing
   */
  private generateSimulatedResponse(prompt: string): string {
    // In a real implementation, this would be handled by the LLM or user interaction
    const responses = [
      'Yes, I understand.',
      'Could you please clarify that?',
      'That sounds good to me.',
      'I need more information about that.',
      'Yes, please proceed.'
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Reset execution state
   */
  private resetExecution(): void {
    this.interactions = [];
    this.artifacts = [];
    this.metrics = {
      startTime: new Date(),
      interactionCount: 0,
      tokensUsed: 0,
      cost: 0,
      errorCount: 0,
      successRate: 1.0
    };
  }

  /**
   * Finalize metrics calculation
   */
  private finalizeMetrics(): void {
    this.metrics.endTime = new Date();
    this.metrics.duration = this.metrics.endTime.getTime() - this.metrics.startTime.getTime();
    this.metrics.successRate = this.metrics.errorCount === 0 ? 1.0 : 
      Math.max(0, 1.0 - (this.metrics.errorCount / Math.max(1, this.metrics.interactionCount)));
  }

  // Event handlers
  private handleInteractionStarted(event: any): void {
    logger.debug('Agent interaction started', {
      agentPhase: event.agentPhase,
      interactionId: event.interaction.id,
      type: event.interaction.type
    });
  }

  private handleInteractionCompleted(event: any): void {
    logger.debug('Agent interaction completed', {
      agentPhase: event.agentPhase,
      interactionId: event.interaction.id,
      hasResponse: !!event.interaction.response
    });
  }

  private handleArtifactGenerated(event: any): void {
    logger.debug('Agent artifact generated', {
      agentPhase: event.agentPhase,
      artifactId: event.artifact.id,
      type: event.artifact.type
    });
  }

  // Public getters
  getMetrics(): AgentExecutionMetrics {
    return { ...this.metrics };
  }

  getInteractions(): AgentInteraction[] {
    return [...this.interactions];
  }

  getArtifacts(): AgentArtifact[] {
    return [...this.artifacts];
  }

  getAgentPhase(): AgentPhase {
    return this.config.agentPhase;
  }

  isCurrentlyExecuting(): boolean {
    return this.isExecuting;
  }
}