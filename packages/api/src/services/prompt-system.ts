import { logger } from '../utils/logger.ts';
import { promptLoader } from './agent-prompt-loader.ts';
import { templateEngine } from './template-engine.ts';
import { promptValidator } from './prompt-validator.ts';
import { versionManager } from './prompt-version-manager.ts';
import { errorRecovery } from './error-recovery.ts';
import { AgentType, PromptExecutionContext } from '../models/agent-prompt.ts';

export interface PromptSystemConfig {
  enableMetrics?: boolean;
  enableHotReload?: boolean;
  cacheSize?: number;
  cacheTTL?: number;
}

export interface PromptSystemStatus {
  initialized: boolean;
  services: {
    loader: 'healthy' | 'degraded' | 'down';
    templateEngine: 'healthy' | 'degraded' | 'down';
    validator: 'healthy' | 'degraded' | 'down';
    versionManager: 'healthy' | 'degraded' | 'down';
    errorRecovery: 'healthy' | 'degraded' | 'down';
  };
  metrics: {
    totalPrompts: number;
    cacheHitRatio: number;
    averageResponseTime: number;
    errorRate: number;
  };
  lastHealthCheck: Date;
}

/**
 * Main orchestrator for the prompt system
 * Provides high-level API for prompt operations with built-in error recovery
 */
export class PromptSystem {
  private initialized = false;
  private config: PromptSystemConfig;
  private healthStatus: PromptSystemStatus;

  constructor(config: PromptSystemConfig = {}) {
    this.config = {
      enableMetrics: true,
      enableHotReload: process.env.NODE_ENV === 'development',
      cacheSize: 100,
      cacheTTL: 1000 * 60 * 30, // 30 minutes
      ...config
    };

    this.healthStatus = this.initializeHealthStatus();
  }

  /**
   * Initialize the prompt system
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Prompt system already initialized');
      return;
    }

    try {
      logger.info('Initializing BMAD Prompt System', this.config);

      // Test all services
      await this.performHealthCheck();

      // Validate that all required prompts are available
      await this.validateSystemPrompts();

      this.initialized = true;
      
      logger.info('BMAD Prompt System initialized successfully', {
        services: this.healthStatus.services,
        totalPrompts: this.healthStatus.metrics.totalPrompts
      });

    } catch (error) {
      logger.error('Failed to initialize prompt system', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * Execute prompt with full error recovery and metrics
   */
  async executePrompt(
    agentType: AgentType,
    executionContext: PromptExecutionContext,
    version?: string
  ): Promise<string> {
    this.ensureInitialized();

    const startTime = Date.now();
    
    try {
      logger.info('Executing prompt', {
        agentType,
        version,
        contextKeys: Object.keys(executionContext.variables || {})
      });

      // Load prompt with error recovery
      const prompt = await errorRecovery.executeWithRetry(
        () => promptLoader.loadPrompt(agentType, { version }),
        {
          agentType,
          version,
          operation: 'prompt-loading'
        }
      );

      // Process template with error recovery
      const processedPrompt = await errorRecovery.executeWithRetry(
        () => templateEngine.processAgentPrompt(prompt, executionContext),
        {
          agentType,
          version,
          operation: 'template-processing',
          metadata: { prompt, executionContext }
        }
      );

      const responseTime = Date.now() - startTime;
      
      logger.info('Prompt executed successfully', {
        agentType,
        version: prompt.version,
        responseTime,
        outputLength: processedPrompt.length
      });

      this.updateMetrics('success', responseTime);
      
      return processedPrompt;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateMetrics('error', responseTime);

      logger.error('Prompt execution failed', {
        agentType,
        version,
        error: (error as Error).message,
        responseTime
      });

      // Attempt system-wide error recovery
      const recoveryResult = await errorRecovery.recoverFromError(error as Error, {
        agentType,
        version,
        operation: 'prompt-execution',
        metadata: { executionContext }
      });

      if (recoveryResult.success) {
        logger.info('Prompt execution recovered', {
          agentType,
          strategy: recoveryResult.strategy,
          totalTime: Date.now() - startTime
        });
        return recoveryResult.result;
      }

      throw error;
    }
  }

  /**
   * Validate prompt with comprehensive checks
   */
  async validatePrompt(prompt: any): Promise<any> {
    this.ensureInitialized();

    return errorRecovery.executeWithRetry(
      () => promptValidator.validatePrompt(prompt),
      {
        operation: 'prompt-validation',
        metadata: { prompt }
      }
    );
  }

  /**
   * Get system status and health
   */
  async getSystemStatus(): Promise<PromptSystemStatus> {
    await this.performHealthCheck();
    return { ...this.healthStatus };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    logger.info('Shutting down prompt system');

    try {
      await promptLoader.shutdown();
      await templateEngine.shutdown();
      
      this.initialized = false;
      
      logger.info('Prompt system shutdown complete');
    } catch (error) {
      logger.error('Error during prompt system shutdown', {
        error: (error as Error).message
      });
    }
  }

  /**
   * Clear all caches (development/admin only)
   */
  clearAllCaches(): void {
    this.ensureInitialized();
    
    logger.info('Clearing all prompt system caches');
    
    promptLoader.clearCache();
    templateEngine.clearCache();
    
    logger.info('All caches cleared');
  }

  /**
   * Reload specific prompt (bypass cache)
   */
  async reloadPrompt(agentType: AgentType, version?: string): Promise<void> {
    this.ensureInitialized();
    
    logger.info('Reloading prompt', { agentType, version });
    
    await promptLoader.reloadPrompt(agentType, version);
    templateEngine.clearCache(`${agentType}_${version || 'latest'}`);
  }

  /**
   * Get available agent types
   */
  getAvailableAgentTypes(): AgentType[] {
    return ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
  }

  // Private methods

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Prompt system not initialized. Call initialize() first.');
    }
  }

  private initializeHealthStatus(): PromptSystemStatus {
    return {
      initialized: false,
      services: {
        loader: 'down',
        templateEngine: 'down',
        validator: 'down',
        versionManager: 'down',
        errorRecovery: 'down'
      },
      metrics: {
        totalPrompts: 0,
        cacheHitRatio: 0,
        averageResponseTime: 0,
        errorRate: 0
      },
      lastHealthCheck: new Date()
    };
  }

  private async performHealthCheck(): Promise<void> {
    logger.debug('Performing prompt system health check');

    const checks = {
      loader: this.checkLoaderHealth(),
      templateEngine: this.checkTemplateEngineHealth(),
      validator: this.checkValidatorHealth(),
      versionManager: this.checkVersionManagerHealth(),
      errorRecovery: this.checkErrorRecoveryHealth()
    };

    const results = await Promise.allSettled(Object.values(checks));
    const serviceNames = Object.keys(checks) as (keyof typeof checks)[];

    for (let i = 0; i < results.length; i++) {
      const serviceName = serviceNames[i];
      const result = results[i];
      
      if (result.status === 'fulfilled') {
        this.healthStatus.services[serviceName] = 'healthy';
      } else {
        logger.warn(`Health check failed for ${serviceName}`, {
          error: result.reason
        });
        this.healthStatus.services[serviceName] = 'down';
      }
    }

    this.healthStatus.lastHealthCheck = new Date();
    this.updateSystemMetrics();
  }

  private async checkLoaderHealth(): Promise<void> {
    // Try to load a prompt to verify loader is working
    await promptLoader.loadPrompt('ANALYST', { useCache: false });
  }

  private async checkTemplateEngineHealth(): Promise<void> {
    // Test template processing with simple template
    await templateEngine.processTemplate('health-check', 'Hello {{name}}', {
      variables: { name: 'World' }
    });
  }

  private async checkValidatorHealth(): Promise<void> {
    // Test validation with minimal valid prompt
    const testPrompt = {
      version: '1.0.0',
      agent_type: 'ANALYST',
      identity: { role: 'Test', expertise: ['Testing'], communication_style: 'Test' },
      system_prompt: 'Test prompt',
      user_prompt_template: 'Test {{input}}',
      template_variables: [],
      capabilities: [],
      constraints: [],
      handoff_procedures: []
    };
    
    await promptValidator.validatePrompt(testPrompt);
  }

  private async checkVersionManagerHealth(): Promise<void> {
    // Just verify the service is available
    await versionManager.listVersions('ANALYST');
  }

  private async checkErrorRecoveryHealth(): Promise<void> {
    // Check that error recovery service is responsive
    const healthStatus = errorRecovery.getHealthStatus();
    if (!healthStatus) {
      throw new Error('Error recovery service not responding');
    }
  }

  private async validateSystemPrompts(): Promise<void> {
    const agentTypes = this.getAvailableAgentTypes();
    const missingPrompts: AgentType[] = [];

    for (const agentType of agentTypes) {
      try {
        await promptLoader.promptExists(agentType);
      } catch {
        missingPrompts.push(agentType);
      }
    }

    if (missingPrompts.length > 0) {
      throw new Error(`Missing prompts for agent types: ${missingPrompts.join(', ')}`);
    }

    this.healthStatus.metrics.totalPrompts = agentTypes.length;
  }

  private updateSystemMetrics(): void {
    // Get metrics from individual services
    const loaderMetrics = promptLoader.getMetrics() as Map<AgentType, any>;
    let totalLoads = 0;
    let totalCacheHits = 0;
    let totalResponseTime = 0;
    let totalErrors = 0;

    if (loaderMetrics) {
      for (const metrics of loaderMetrics.values()) {
        totalLoads += metrics.totalLoads || 0;
        totalCacheHits += metrics.cacheHits || 0;
        totalResponseTime += metrics.averageLoadTime || 0;
        totalErrors += metrics.loadErrors || 0;
      }
    }

    this.healthStatus.metrics = {
      totalPrompts: this.healthStatus.metrics.totalPrompts,
      cacheHitRatio: totalLoads > 0 ? totalCacheHits / totalLoads : 0,
      averageResponseTime: totalLoads > 0 ? totalResponseTime / loaderMetrics.size : 0,
      errorRate: totalLoads > 0 ? totalErrors / totalLoads : 0
    };
  }

  private updateMetrics(type: 'success' | 'error', responseTime: number): void {
    // This would typically update metrics in a proper metrics store
    // For now, just log the metric
    logger.debug('Prompt execution metric', {
      type,
      responseTime,
      timestamp: new Date()
    });
  }
}

// Export singleton instance
export const promptSystem = new PromptSystem();