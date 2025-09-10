import { logger } from '../utils/logger.ts';
import { AgentType } from '../models/agent-prompt.ts';
import { promptLoader } from './agent-prompt-loader.ts';
import { templateEngine } from './template-engine.ts';
import { promptValidator } from './prompt-validator.ts';
import { versionManager } from './prompt-version-manager.ts';

export interface RecoveryStrategy {
  name: string;
  description: string;
  canRecover: (error: Error, context?: any) => boolean;
  recover: (error: Error, context?: any) => Promise<any>;
}

export interface ErrorContext {
  agentType?: AgentType;
  version?: string;
  operation?: string;
  requestId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface RecoveryResult {
  success: boolean;
  strategy?: string;
  result?: any;
  fallbackUsed?: boolean;
  warnings?: string[];
  error?: Error;
}

export class ErrorRecoveryService {
  private strategies: RecoveryStrategy[] = [];
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private retryConfig: RetryConfig;

  constructor() {
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2,
      jitter: true,
    };

    this.initializeStrategies();
    this.setupCircuitBreakers();
  }

  /**
   * Attempt to recover from an error using available strategies
   */
  async recoverFromError(
    error: Error, 
    context: ErrorContext = {}
  ): Promise<RecoveryResult> {
    const requestId = context.requestId || this.generateRequestId();
    
    logger.warn('Attempting error recovery', {
      requestId,
      error: error.message,
      errorType: error.constructor.name,
      context
    });

    // Check circuit breakers
    const operationKey = this.getOperationKey(context);
    if (this.isCircuitOpen(operationKey)) {
      logger.error('Circuit breaker is open, failing fast', {
        requestId,
        operationKey
      });
      
      return {
        success: false,
        error: new Error('Service temporarily unavailable - circuit breaker open'),
        warnings: ['Circuit breaker is open for this operation']
      };
    }

    // Try each recovery strategy
    for (const strategy of this.strategies) {
      try {
        if (strategy.canRecover(error, context)) {
          logger.info('Attempting recovery strategy', {
            requestId,
            strategy: strategy.name,
            error: error.message
          });

          const result = await this.executeWithRetry(
            () => strategy.recover(error, context),
            context
          );

          this.recordSuccess(operationKey);

          logger.info('Recovery successful', {
            requestId,
            strategy: strategy.name,
            hasResult: !!result
          });

          return {
            success: true,
            strategy: strategy.name,
            result,
            warnings: []
          };
        }
      } catch (recoveryError) {
        logger.warn('Recovery strategy failed', {
          requestId,
          strategy: strategy.name,
          originalError: error.message,
          recoveryError: (recoveryError as Error).message
        });
      }
    }

    // All recovery strategies failed
    this.recordFailure(operationKey);
    
    logger.error('All recovery strategies failed', {
      requestId,
      originalError: error.message,
      context
    });

    return {
      success: false,
      error,
      warnings: ['No recovery strategy was successful']
    };
  }

  /**
   * Execute operation with automatic retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: ErrorContext = {}
  ): Promise<T> {
    let lastError: Error;
    let delay = this.retryConfig.baseDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const jitteredDelay = this.retryConfig.jitter 
            ? delay * (0.5 + Math.random() * 0.5)
            : delay;
          
          logger.debug('Retrying operation', {
            attempt,
            delay: Math.round(jitteredDelay),
            context
          });
          
          await this.sleep(jitteredDelay);
        }

        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Don't retry certain error types
        if (this.shouldNotRetry(lastError)) {
          break;
        }

        delay = Math.min(
          delay * this.retryConfig.backoffFactor,
          this.retryConfig.maxDelay
        );
      }
    }

    throw lastError!;
  }

  /**
   * Get system health status
   */
  getHealthStatus(): SystemHealthStatus {
    const circuitBreakerStatuses = Array.from(this.circuitBreakers.entries())
      .map(([operation, state]) => ({
        operation,
        state: state.state,
        failures: state.failures,
        lastFailure: state.lastFailure,
        nextAttempt: state.nextAttempt
      }));

    return {
      overall: circuitBreakerStatuses.every(cb => cb.state !== 'OPEN') ? 'HEALTHY' : 'DEGRADED',
      circuitBreakers: circuitBreakerStatuses,
      timestamp: new Date()
    };
  }

  /**
   * Reset circuit breaker for a specific operation
   */
  resetCircuitBreaker(operationKey: string): void {
    const breaker = this.circuitBreakers.get(operationKey);
    if (breaker) {
      breaker.state = 'CLOSED';
      breaker.failures = 0;
      breaker.lastFailure = null;
      breaker.nextAttempt = null;
      
      logger.info('Circuit breaker reset', { operationKey });
    }
  }

  // Private methods

  private initializeStrategies(): void {
    // Strategy 1: Fallback to latest version
    this.strategies.push({
      name: 'fallback-to-latest',
      description: 'Fallback to latest version when specific version fails',
      canRecover: (error, context) => {
        return error.message.includes('PROMPT_NOT_FOUND') && 
               context?.version && 
               context?.agentType;
      },
      recover: async (error, context) => {
        logger.info('Falling back to latest version', {
          agentType: context.agentType,
          requestedVersion: context.version
        });
        
        return promptLoader.loadPrompt(context.agentType, {
          useCache: true,
          validateSchema: true,
          fallbackToLatest: false // Prevent infinite recursion
        });
      }
    });

    // Strategy 2: Cache bypass and reload
    this.strategies.push({
      name: 'cache-bypass-reload',
      description: 'Bypass cache and reload from disk',
      canRecover: (error, context) => {
        return error.message.includes('LOAD_ERROR') && 
               context?.agentType;
      },
      recover: async (error, context) => {
        logger.info('Bypassing cache and reloading', {
          agentType: context.agentType,
          version: context.version
        });
        
        promptLoader.clearCache(context.agentType, context.version);
        return promptLoader.loadPrompt(context.agentType, {
          version: context.version,
          useCache: false,
          validateSchema: true
        });
      }
    });

    // Strategy 3: Template simplification
    this.strategies.push({
      name: 'template-simplification',
      description: 'Simplify template when processing fails',
      canRecover: (error, context) => {
        return error.message.includes('TEMPLATE_') && 
               context?.metadata?.template;
      },
      recover: async (error, context) => {
        logger.info('Attempting template simplification', {
          originalTemplate: context.metadata.template?.substring(0, 100) + '...'
        });
        
        // Create a simplified template without complex expressions
        const simplifiedTemplate = this.simplifyTemplate(context.metadata.template);
        
        return templateEngine.processTemplate('simplified', simplifiedTemplate, {
          variables: context.metadata.variables || {}
        });
      }
    });

    // Strategy 4: Validation bypass for development
    this.strategies.push({
      name: 'validation-bypass',
      description: 'Bypass validation in development mode',
      canRecover: (error, context) => {
        return process.env.NODE_ENV === 'development' &&
               error.message.includes('SCHEMA_VALIDATION_ERROR');
      },
      recover: async (error, context) => {
        logger.warn('Bypassing validation in development mode', {
          error: error.message
        });
        
        // Return the original data without validation
        return context.metadata?.originalData;
      }
    });
  }

  private setupCircuitBreakers(): void {
    const operations = [
      'prompt-loading',
      'template-processing',
      'prompt-validation',
      'version-management'
    ];

    for (const operation of operations) {
      this.circuitBreakers.set(operation, {
        state: 'CLOSED',
        failures: 0,
        threshold: 5,
        timeout: 60000, // 1 minute
        lastFailure: null,
        nextAttempt: null
      });
    }
  }

  private isCircuitOpen(operationKey: string): boolean {
    const breaker = this.circuitBreakers.get(operationKey);
    if (!breaker || breaker.state === 'CLOSED') {
      return false;
    }

    if (breaker.state === 'HALF_OPEN') {
      return false; // Allow one attempt
    }

    // Check if timeout has passed
    if (breaker.nextAttempt && Date.now() >= breaker.nextAttempt.getTime()) {
      breaker.state = 'HALF_OPEN';
      return false;
    }

    return true;
  }

  private recordSuccess(operationKey: string): void {
    const breaker = this.circuitBreakers.get(operationKey);
    if (breaker) {
      breaker.state = 'CLOSED';
      breaker.failures = 0;
      breaker.lastFailure = null;
      breaker.nextAttempt = null;
    }
  }

  private recordFailure(operationKey: string): void {
    const breaker = this.circuitBreakers.get(operationKey);
    if (breaker) {
      breaker.failures++;
      breaker.lastFailure = new Date();

      if (breaker.failures >= breaker.threshold) {
        breaker.state = 'OPEN';
        breaker.nextAttempt = new Date(Date.now() + breaker.timeout);
        
        logger.warn('Circuit breaker opened', {
          operationKey,
          failures: breaker.failures,
          nextAttempt: breaker.nextAttempt
        });
      }
    }
  }

  private getOperationKey(context: ErrorContext): string {
    if (context.operation) {
      return context.operation;
    }
    
    if (context.agentType) {
      return 'prompt-loading';
    }
    
    return 'general';
  }

  private shouldNotRetry(error: Error): boolean {
    // Don't retry validation errors, schema errors, or user input errors
    const nonRetryablePatterns = [
      'SCHEMA_VALIDATION_ERROR',
      'INVALID_INPUT',
      'PERMISSION_DENIED',
      'AUTHENTICATION_ERROR'
    ];

    return nonRetryablePatterns.some(pattern => 
      error.message.includes(pattern)
    );
  }

  private simplifyTemplate(template: string): string {
    // Remove complex handlebars expressions and keep only simple variables
    return template
      .replace(/\{\{#.*?\}\}.*?\{\{\/.*?\}\}/gs, '') // Remove blocks
      .replace(/\{\{>.*?\}\}/g, '') // Remove partials
      .replace(/\{\{\{.*?\}\}\}/g, '{{simplified}}') // Replace triple braces
      .replace(/\{\{[^}]*\|[^}]*\}\}/g, '{{simplified}}'); // Remove pipes/helpers
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Types
interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  threshold: number;
  timeout: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitter: boolean;
}

interface SystemHealthStatus {
  overall: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  circuitBreakers: Array<{
    operation: string;
    state: string;
    failures: number;
    lastFailure: Date | null;
    nextAttempt: Date | null;
  }>;
  timestamp: Date;
}

// Export singleton instance
export const errorRecovery = new ErrorRecoveryService();