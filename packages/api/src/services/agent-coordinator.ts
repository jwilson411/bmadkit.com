import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { 
  AgentPhase,
  AgentExecutionResult,
  WorkflowContext,
  ContextEnrichment,
  InteractionType,
  generateExecutionId,
  generateInteractionId
} from '../models/workflow-models';

export interface AgentCoordinatorConfig {
  enableContextValidation: boolean;
  enableHandoffValidation: boolean;
  maxHandoffRetries: number;
  handoffTimeout: number; // milliseconds
  contextEnrichmentEnabled: boolean;
  enableAgentValidation: boolean;
}

export interface AgentExecutionRequest {
  agentPhase: AgentPhase;
  sessionId: string;
  workflowExecutionId: string;
  context: WorkflowContext;
  previousAgentResults?: AgentExecutionResult[];
  userInput?: string;
  metadata?: Record<string, any>;
}

export interface AgentExecutionContext {
  sessionId: string;
  workflowExecutionId: string;
  agentPhase: AgentPhase;
  executionId: string;
  context: WorkflowContext;
  enrichedContext?: WorkflowContext;
  previousContext?: WorkflowContext;
  handoffData?: AgentHandoffData;
  startTime: Date;
  interactions: Array<{
    id: string;
    type: InteractionType;
    prompt: string;
    response?: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }>;
  artifacts: Array<{
    id: string;
    type: string;
    name: string;
    content: any;
    metadata?: Record<string, any>;
  }>;
  metrics: {
    tokensUsed: number;
    cost: number;
    interactionCount: number;
    duration?: number;
  };
}

export interface AgentHandoffData {
  fromAgent: AgentPhase;
  toAgent: AgentPhase;
  contextSummary: string;
  keyFindings: string[];
  recommendations: string[];
  artifacts: Array<{
    type: string;
    name: string;
    content: any;
    description: string;
  }>;
  validationChecklist: Array<{
    item: string;
    completed: boolean;
    notes?: string;
  }>;
  confidence: number; // 0-1 scale
  handoffTimestamp: Date;
}

export interface AgentTransitionResult {
  success: boolean;
  fromAgent?: AgentPhase;
  toAgent: AgentPhase;
  executionResult: AgentExecutionResult;
  handoffData?: AgentHandoffData;
  contextEnrichment?: ContextEnrichment;
  errors?: string[];
  warnings?: string[];
}

/**
 * Agent Coordinator
 * 
 * Manages agent transitions, context handoffs, and coordination between
 * different AI agents in the BMAD workflow. Ensures smooth transitions
 * and context preservation throughout the planning process.
 */
export class AgentCoordinator extends EventEmitter {
  private config: AgentCoordinatorConfig;
  private activeExecutions = new Map<string, AgentExecutionContext>();
  
  // Agent-specific handlers
  private agentHandlers = new Map<AgentPhase, any>();
  
  constructor(config: Partial<AgentCoordinatorConfig> = {}) {
    super();
    
    this.config = {
      enableContextValidation: true,
      enableHandoffValidation: true,
      maxHandoffRetries: 3,
      handoffTimeout: 300000, // 5 minutes
      contextEnrichmentEnabled: true,
      enableAgentValidation: true,
      ...config
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('agent-execution-started', this.handleAgentExecutionStarted.bind(this));
    this.on('agent-execution-complete', this.handleAgentExecutionComplete.bind(this));
    this.on('agent-handoff', this.handleAgentHandoff.bind(this));
  }

  /**
   * Execute an agent phase
   */
  async executeAgent(request: AgentExecutionRequest): Promise<AgentTransitionResult> {
    const executionId = generateExecutionId();
    
    try {
      // Create execution context
      const context = await this.createExecutionContext(request, executionId);
      
      // Store active execution
      this.activeExecutions.set(executionId, context);

      // Validate agent and context
      if (this.config.enableAgentValidation) {
        await this.validateAgentExecution(request, context);
      }

      // Enrich context if enabled
      if (this.config.contextEnrichmentEnabled) {
        context.enrichedContext = await this.enrichContext(context);
      }

      logger.info('Starting agent execution', {
        executionId,
        agentPhase: request.agentPhase,
        sessionId: request.sessionId,
        workflowExecutionId: request.workflowExecutionId
      });

      this.emit('agent-execution-started', { executionId, context });

      // Execute the agent
      const executionResult = await this.runAgentExecution(context);

      // Validate execution result
      if (this.config.enableHandoffValidation) {
        await this.validateExecutionResult(executionResult, context);
      }

      // Prepare handoff data for next agent
      const handoffData = await this.prepareHandoffData(executionResult, context);

      // Enrich context for next phase
      const contextEnrichment = this.config.contextEnrichmentEnabled ? 
        await this.createContextEnrichment(executionResult, context) : undefined;

      const result: AgentTransitionResult = {
        success: true,
        fromAgent: this.getPreviousAgent(request.agentPhase),
        toAgent: request.agentPhase,
        executionResult,
        handoffData,
        contextEnrichment
      };

      logger.info('Agent execution completed successfully', {
        executionId,
        agentPhase: request.agentPhase,
        duration: executionResult.metrics.duration,
        interactionCount: executionResult.interactions.length
      });

      this.emit('agent-execution-complete', { executionId, result });

      return result;

    } catch (error) {
      logger.error('Agent execution failed', {
        executionId,
        agentPhase: request.agentPhase,
        error: (error as Error).message
      });

      const failedResult: AgentExecutionResult = {
        agentPhase: request.agentPhase,
        executionId,
        startTime: new Date(),
        endTime: new Date(),
        status: 'ERROR',
        interactions: [],
        contextInput: request.context,
        metrics: {
          tokensUsed: 0,
          cost: 0,
          interactionCount: 0,
          duration: 0
        },
        errors: [{
          code: 'AGENT_EXECUTION_ERROR',
          message: (error as Error).message,
          timestamp: new Date(),
          recoverable: false
        }]
      };

      return {
        success: false,
        toAgent: request.agentPhase,
        executionResult: failedResult,
        errors: [(error as Error).message]
      };

    } finally {
      // Cleanup execution context
      this.activeExecutions.delete(executionId);
    }
  }

  private async createExecutionContext(
    request: AgentExecutionRequest,
    executionId: string
  ): Promise<AgentExecutionContext> {
    
    // Prepare context with handoff data from previous agents
    let enrichedContext = { ...request.context };
    
    if (request.previousAgentResults && request.previousAgentResults.length > 0) {
      enrichedContext = await this.mergeContextFromPreviousAgents(
        enrichedContext,
        request.previousAgentResults
      );
    }

    return {
      sessionId: request.sessionId,
      workflowExecutionId: request.workflowExecutionId,
      agentPhase: request.agentPhase,
      executionId,
      context: enrichedContext,
      startTime: new Date(),
      interactions: [],
      artifacts: [],
      metrics: {
        tokensUsed: 0,
        cost: 0,
        interactionCount: 0
      }
    };
  }

  private async mergeContextFromPreviousAgents(
    baseContext: WorkflowContext,
    previousResults: AgentExecutionResult[]
  ): Promise<WorkflowContext> {
    
    const mergedContext = { ...baseContext };
    
    // Collect enrichments from previous agents
    const enrichments = mergedContext.enrichments || [];
    
    for (const result of previousResults) {
      if (result.contextOutput && result.status === 'COMPLETE') {
        // Merge outputs from previous agents
        Object.assign(mergedContext, result.contextOutput);
        
        // Add context enrichment
        enrichments.push({
          timestamp: result.endTime || result.startTime,
          agentPhase: result.agentPhase,
          enrichmentType: 'ENHANCEMENT',
          inputContext: result.contextInput,
          outputContext: result.contextOutput,
          confidence: 0.9,
          metadata: {
            executionId: result.executionId,
            interactionCount: result.interactions.length,
            artifactCount: result.artifacts?.length || 0
          }
        });
      }
    }
    
    mergedContext.enrichments = enrichments;
    
    return mergedContext;
  }

  private async validateAgentExecution(
    request: AgentExecutionRequest,
    context: AgentExecutionContext
  ): Promise<void> {
    
    // Validate required context fields for each agent type
    const requiredFields = this.getRequiredContextFields(request.agentPhase);
    
    for (const field of requiredFields) {
      if (!this.hasContextField(context.context, field)) {
        throw new Error(`Required context field missing for ${request.agentPhase}: ${field}`);
      }
    }

    // Validate agent sequence
    if (request.previousAgentResults && request.previousAgentResults.length > 0) {
      const lastAgent = request.previousAgentResults[request.previousAgentResults.length - 1].agentPhase;
      const expectedPrevious = this.getPreviousAgent(request.agentPhase);
      
      if (expectedPrevious && lastAgent !== expectedPrevious) {
        throw new Error(`Invalid agent sequence: expected ${expectedPrevious} before ${request.agentPhase}, got ${lastAgent}`);
      }
    }
  }

  private getRequiredContextFields(agentPhase: AgentPhase): string[] {
    const requirements: Record<AgentPhase, string[]> = {
      'ANALYST': ['projectInput'],
      'PM': ['projectInput', 'businessAnalysis'],
      'UX_EXPERT': ['projectInput', 'businessAnalysis', 'projectScope'],
      'ARCHITECT': ['projectInput', 'businessAnalysis', 'projectScope', 'userExperience']
    };
    
    return requirements[agentPhase] || ['projectInput'];
  }

  private hasContextField(context: WorkflowContext, field: string): boolean {
    return field.split('.').reduce((obj: any, key: string) => obj?.[key], context) !== undefined;
  }

  private getPreviousAgent(currentAgent: AgentPhase): AgentPhase | undefined {
    const sequence: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    const index = sequence.indexOf(currentAgent);
    return index > 0 ? sequence[index - 1] : undefined;
  }

  private async enrichContext(context: AgentExecutionContext): Promise<WorkflowContext> {
    // Context enrichment logic based on agent phase and existing context
    const enrichedContext = { ...context.context };

    switch (context.agentPhase) {
      case 'ANALYST':
        // Add business analysis specific enrichments
        enrichedContext.analysisContext = {
          timestamp: new Date(),
          focusAreas: ['market validation', 'user needs', 'business requirements'],
          analysisDepth: 'comprehensive'
        };
        break;

      case 'PM':
        // Add project management specific enrichments
        enrichedContext.pmContext = {
          timestamp: new Date(),
          focusAreas: ['scope definition', 'feature prioritization', 'user stories'],
          methodologies: ['agile', 'lean']
        };
        break;

      case 'UX_EXPERT':
        // Add UX specific enrichments
        enrichedContext.uxContext = {
          timestamp: new Date(),
          focusAreas: ['user experience', 'interface design', 'usability'],
          designPrinciples: ['user-centered', 'accessible', 'responsive']
        };
        break;

      case 'ARCHITECT':
        // Add architecture specific enrichments
        enrichedContext.architectureContext = {
          timestamp: new Date(),
          focusAreas: ['system design', 'technology selection', 'scalability'],
          architecturalPatterns: ['microservices', 'serverless', 'event-driven']
        };
        break;
    }

    return enrichedContext;
  }

  private async runAgentExecution(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    
    try {
      // This is where we would integrate with the actual agent implementations
      // For now, we'll create a mock execution result
      
      const mockInteraction = {
        id: generateInteractionId(),
        type: 'QUESTION' as InteractionType,
        prompt: this.generateAgentPrompt(context),
        response: this.generateMockResponse(context),
        timestamp: new Date(),
        metadata: {
          agentPhase: context.agentPhase,
          executionId: context.executionId
        }
      };

      context.interactions.push(mockInteraction);
      context.metrics.interactionCount++;

      // Generate mock artifacts based on agent type
      const artifacts = this.generateMockArtifacts(context);
      context.artifacts.push(...artifacts);

      // Update metrics
      context.metrics.duration = Date.now() - startTime;
      context.metrics.tokensUsed = this.estimateTokenUsage(mockInteraction.prompt, mockInteraction.response);
      context.metrics.cost = this.estimateCost(context.metrics.tokensUsed);

      const result: AgentExecutionResult = {
        agentPhase: context.agentPhase,
        executionId: context.executionId,
        startTime: context.startTime,
        endTime: new Date(),
        status: 'COMPLETE',
        interactions: context.interactions,
        contextInput: context.context,
        contextOutput: await this.generateContextOutput(context),
        artifacts: context.artifacts,
        metrics: context.metrics
      };

      return result;

    } catch (error) {
      const result: AgentExecutionResult = {
        agentPhase: context.agentPhase,
        executionId: context.executionId,
        startTime: context.startTime,
        endTime: new Date(),
        status: 'ERROR',
        interactions: context.interactions,
        contextInput: context.context,
        metrics: {
          ...context.metrics,
          duration: Date.now() - startTime
        },
        errors: [{
          code: 'EXECUTION_ERROR',
          message: (error as Error).message,
          timestamp: new Date(),
          recoverable: false
        }]
      };

      return result;
    }
  }

  private generateAgentPrompt(context: AgentExecutionContext): string {
    // Generate agent-specific prompts
    const basePrompt = `You are a ${context.agentPhase.replace('_', ' ').toLowerCase()} working on a project: "${context.context.projectInput}"`;
    
    const phaseSpecificPrompts: Record<AgentPhase, string> = {
      'ANALYST': basePrompt + '\n\nFocus on business analysis, market validation, and requirements gathering. What questions do you have about the business context?',
      'PM': basePrompt + '\n\nFocus on project management, feature prioritization, and user stories. Based on the business analysis, what is the project scope?',
      'UX_EXPERT': basePrompt + '\n\nFocus on user experience design and interface planning. What are the key user experience considerations?',
      'ARCHITECT': basePrompt + '\n\nFocus on technical architecture and implementation planning. What is the recommended technical architecture?'
    };

    return phaseSpecificPrompts[context.agentPhase];
  }

  private generateMockResponse(context: AgentExecutionContext): string {
    const responses: Record<AgentPhase, string> = {
      'ANALYST': 'Based on the project requirements, I recommend conducting market research and user interviews to validate the business case.',
      'PM': 'The project scope should focus on MVP features with clear user stories and acceptance criteria for iterative development.',
      'UX_EXPERT': 'User experience should prioritize intuitive navigation, responsive design, and accessibility compliance.',
      'ARCHITECT': 'I recommend a microservices architecture with cloud-native deployment for scalability and maintainability.'
    };

    return responses[context.agentPhase];
  }

  private generateMockArtifacts(context: AgentExecutionContext) {
    const artifactTemplates: Record<AgentPhase, any[]> = {
      'ANALYST': [
        {
          id: generateExecutionId(),
          type: 'business-analysis',
          name: 'Business Analysis Report',
          content: {
            marketSize: 'Large addressable market',
            competitors: ['Competitor A', 'Competitor B'],
            valueProposition: 'Unique value proposition identified'
          },
          metadata: { confidence: 0.85 }
        }
      ],
      'PM': [
        {
          id: generateExecutionId(),
          type: 'project-scope',
          name: 'Project Scope Document',
          content: {
            mvpFeatures: ['Feature 1', 'Feature 2', 'Feature 3'],
            userStories: ['As a user, I want...'],
            acceptanceCriteria: ['Given when then...']
          },
          metadata: { priority: 'high' }
        }
      ],
      'UX_EXPERT': [
        {
          id: generateExecutionId(),
          type: 'ux-design',
          name: 'UX Design Guidelines',
          content: {
            designPrinciples: ['User-centered', 'Accessible'],
            userJourneys: ['Onboarding', 'Main workflow'],
            wireframes: ['Homepage', 'Dashboard']
          },
          metadata: { designSystem: 'modern' }
        }
      ],
      'ARCHITECT': [
        {
          id: generateExecutionId(),
          type: 'technical-architecture',
          name: 'System Architecture Plan',
          content: {
            architecture: 'Microservices',
            technologies: ['React', 'Node.js', 'PostgreSQL'],
            deployment: 'Cloud-native'
          },
          metadata: { scalability: 'high' }
        }
      ]
    };

    return artifactTemplates[context.agentPhase] || [];
  }

  private async generateContextOutput(context: AgentExecutionContext): Promise<Record<string, any>> {
    const baseOutput = {
      agentPhase: context.agentPhase,
      executionId: context.executionId,
      completedAt: new Date(),
      confidence: 0.9
    };

    const phaseSpecificOutputs: Record<AgentPhase, Record<string, any>> = {
      'ANALYST': {
        ...baseOutput,
        businessAnalysis: {
          marketValidation: 'Validated',
          userNeeds: ['Need 1', 'Need 2'],
          requirements: ['Requirement 1', 'Requirement 2']
        }
      },
      'PM': {
        ...baseOutput,
        projectScope: {
          mvpFeatures: ['Feature 1', 'Feature 2'],
          timeline: '6 months',
          resources: 'Small team'
        }
      },
      'UX_EXPERT': {
        ...baseOutput,
        userExperience: {
          designPrinciples: ['User-friendly', 'Accessible'],
          userFlows: ['Main flow', 'Alternative flow'],
          interfaces: ['Web', 'Mobile']
        }
      },
      'ARCHITECT': {
        ...baseOutput,
        technicalArchitecture: {
          systemDesign: 'Distributed',
          technologies: ['Modern stack'],
          scalability: 'High'
        }
      }
    };

    return phaseSpecificOutputs[context.agentPhase] || baseOutput;
  }

  private estimateTokenUsage(prompt: string, response?: string): number {
    // Simple token estimation (roughly 4 chars per token)
    const promptTokens = Math.ceil(prompt.length / 4);
    const responseTokens = response ? Math.ceil(response.length / 4) : 0;
    return promptTokens + responseTokens;
  }

  private estimateCost(tokens: number): number {
    // Simple cost estimation ($0.01 per 1000 tokens)
    return (tokens / 1000) * 0.01;
  }

  private async validateExecutionResult(
    result: AgentExecutionResult,
    context: AgentExecutionContext
  ): Promise<void> {
    
    if (result.status !== 'COMPLETE') {
      throw new Error(`Agent execution not completed successfully: ${result.status}`);
    }

    if (!result.contextOutput) {
      throw new Error('Agent execution must produce context output');
    }

    if (result.interactions.length === 0) {
      throw new Error('Agent execution must have at least one interaction');
    }

    // Agent-specific validation
    await this.validateAgentSpecificOutput(result, context);
  }

  private async validateAgentSpecificOutput(
    result: AgentExecutionResult,
    context: AgentExecutionContext
  ): Promise<void> {
    
    const requiredOutputFields: Record<AgentPhase, string[]> = {
      'ANALYST': ['businessAnalysis'],
      'PM': ['projectScope'],
      'UX_EXPERT': ['userExperience'],
      'ARCHITECT': ['technicalArchitecture']
    };

    const required = requiredOutputFields[context.agentPhase];
    if (!required) return;

    for (const field of required) {
      if (!result.contextOutput![field]) {
        throw new Error(`Required output field missing for ${context.agentPhase}: ${field}`);
      }
    }
  }

  private async prepareHandoffData(
    result: AgentExecutionResult,
    context: AgentExecutionContext
  ): Promise<AgentHandoffData | undefined> {
    
    const nextAgent = this.getNextAgent(context.agentPhase);
    if (!nextAgent) return undefined;

    return {
      fromAgent: context.agentPhase,
      toAgent: nextAgent,
      contextSummary: this.generateContextSummary(result, context),
      keyFindings: this.extractKeyFindings(result),
      recommendations: this.extractRecommendations(result),
      artifacts: result.artifacts?.map(a => ({
        type: a.type,
        name: a.name,
        content: a.content,
        description: `Generated by ${context.agentPhase}`
      })) || [],
      validationChecklist: this.generateValidationChecklist(nextAgent),
      confidence: 0.9,
      handoffTimestamp: new Date()
    };
  }

  private getNextAgent(currentAgent: AgentPhase): AgentPhase | undefined {
    const sequence: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    const index = sequence.indexOf(currentAgent);
    return index < sequence.length - 1 ? sequence[index + 1] : undefined;
  }

  private generateContextSummary(result: AgentExecutionResult, context: AgentExecutionContext): string {
    return `${context.agentPhase} phase completed successfully with ${result.interactions.length} interactions and ${result.artifacts?.length || 0} artifacts generated.`;
  }

  private extractKeyFindings(result: AgentExecutionResult): string[] {
    // Extract key findings from interactions and artifacts
    return result.interactions.map(i => `Finding from ${i.type}: ${i.response?.substring(0, 100)}...`).filter(f => f);
  }

  private extractRecommendations(result: AgentExecutionResult): string[] {
    // Extract recommendations from context output
    return ['Recommendation 1', 'Recommendation 2']; // Simplified for now
  }

  private generateValidationChecklist(nextAgent: AgentPhase): Array<{item: string; completed: boolean; notes?: string}> {
    const checklists: Record<AgentPhase, Array<{item: string; completed: boolean}>> = {
      'ANALYST': [
        { item: 'Project requirements gathered', completed: true },
        { item: 'Market validation conducted', completed: true }
      ],
      'PM': [
        { item: 'Business analysis reviewed', completed: true },
        { item: 'Project scope defined', completed: true }
      ],
      'UX_EXPERT': [
        { item: 'PM deliverables reviewed', completed: true },
        { item: 'User experience design planned', completed: true }
      ],
      'ARCHITECT': [
        { item: 'UX requirements reviewed', completed: true },
        { item: 'Technical architecture planned', completed: true }
      ]
    };

    return checklists[nextAgent] || [];
  }

  private async createContextEnrichment(
    result: AgentExecutionResult,
    context: AgentExecutionContext
  ): Promise<ContextEnrichment> {
    
    return {
      timestamp: new Date(),
      agentPhase: context.agentPhase,
      enrichmentType: 'ENHANCEMENT',
      inputContext: context.context,
      outputContext: result.contextOutput || {},
      confidence: 0.9,
      metadata: {
        executionId: result.executionId,
        duration: result.metrics.duration,
        interactionCount: result.interactions.length
      }
    };
  }

  // Event handlers
  private async handleAgentExecutionStarted(event: { executionId: string; context: AgentExecutionContext }): Promise<void> {
    logger.debug('Agent execution started event', {
      executionId: event.executionId,
      agentPhase: event.context.agentPhase
    });
  }

  private async handleAgentExecutionComplete(event: { executionId: string; result: AgentTransitionResult }): Promise<void> {
    logger.debug('Agent execution complete event', {
      executionId: event.executionId,
      success: event.result.success,
      agentPhase: event.result.toAgent
    });
  }

  private async handleAgentHandoff(event: any): Promise<void> {
    logger.debug('Agent handoff event', event);
  }

  // Public API methods
  getActiveExecutions(): Array<{ executionId: string; agentPhase: AgentPhase; startTime: Date }> {
    return Array.from(this.activeExecutions.entries()).map(([id, context]) => ({
      executionId: id,
      agentPhase: context.agentPhase,
      startTime: context.startTime
    }));
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const context = this.activeExecutions.get(executionId);
    if (!context) return false;

    this.activeExecutions.delete(executionId);
    
    logger.info('Agent execution cancelled', {
      executionId,
      agentPhase: context.agentPhase
    });

    this.emit('agent-execution-cancelled', { executionId, context });
    return true;
  }
}

// Export singleton instance
export const agentCoordinator = new AgentCoordinator();