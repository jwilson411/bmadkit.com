import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { circuitBreakerService, withCircuitBreaker } from '../middleware/circuit-breaker';
import { RetryLogic } from '../../web/src/utils/retry-logic';

export interface LLMRequest {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  role: string;
  finishReason?: string;
  metadata?: {
    provider: string;
    model: string;
    duration: number;
    tokens: number;
    cost: number;
  };
}

export interface LLMProvider {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeout: number;
  priority: number;
  costPerToken: number;
  healthCheckEndpoint?: string;
}

interface FailoverState {
  currentProvider: string;
  failedProviders: Set<string>;
  lastFailoverTime: number;
  totalFailovers: number;
}

class LLMProviderFailover {
  private providers = new Map<string, LLMProvider>();
  private failoverState: FailoverState = {
    currentProvider: '',
    failedProviders: new Set(),
    lastFailoverTime: 0,
    totalFailovers: 0
  };
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.initializeProviders();
    this.startHealthChecking();
  }

  private initializeProviders() {
    const providers: LLMProvider[] = [
      {
        name: 'openai-gpt4',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'gpt-4-turbo-preview',
        maxTokens: 4000,
        timeout: 30000,
        priority: 1,
        costPerToken: 0.00003,
        healthCheckEndpoint: 'https://api.openai.com/v1/models'
      },
      {
        name: 'anthropic-claude',
        endpoint: 'https://api.anthropic.com/v1/messages',
        apiKey: process.env.ANTHROPIC_API_KEY!,
        model: 'claude-3-sonnet-20240229',
        maxTokens: 4000,
        timeout: 30000,
        priority: 2,
        costPerToken: 0.000015,
        healthCheckEndpoint: 'https://api.anthropic.com/v1/models'
      },
      {
        name: 'azure-openai',
        endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        apiKey: process.env.AZURE_OPENAI_KEY!,
        model: 'gpt-4',
        maxTokens: 4000,
        timeout: 30000,
        priority: 3,
        costPerToken: 0.00003
      }
    ];

    providers.forEach(provider => {
      this.providers.set(provider.name, provider);
      circuitBreakerService.createBreaker({
        name: `llm-${provider.name}`,
        failureThreshold: 3,
        recoveryTimeout: 60000,
        monitoringWindow: 300000
      });
    });

    this.failoverState.currentProvider = providers[0]?.name || '';
  }

  private startHealthChecking() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 60000);
  }

  private async performHealthChecks() {
    for (const [name, provider] of this.providers) {
      if (!provider.healthCheckEndpoint) continue;

      try {
        await withCircuitBreaker(
          `llm-${name}-health`,
          async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
              const response = await fetch(provider.healthCheckEndpoint!, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${provider.apiKey}`,
                  'Content-Type': 'application/json'
                },
                signal: controller.signal
              });

              clearTimeout(timeoutId);

              if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
              }

              return await response.json();
            } catch (error) {
              clearTimeout(timeoutId);
              throw error;
            }
          }
        );

        if (this.failoverState.failedProviders.has(name)) {
          this.failoverState.failedProviders.delete(name);
          logger.info(`LLM provider '${name}' recovered and is healthy again`);
        }
      } catch (error) {
        this.failoverState.failedProviders.add(name);
        logger.warn(`LLM provider '${name}' health check failed:`, error);
      }
    }
  }

  async executeWithFailover(request: LLMRequest): Promise<LLMResponse> {
    const availableProviders = this.getAvailableProviders();
    
    if (availableProviders.length === 0) {
      throw new Error('No LLM providers available');
    }

    let lastError: Error;
    
    for (const provider of availableProviders) {
      try {
        logger.info(`Attempting LLM request with provider: ${provider.name}`);
        
        const response = await withCircuitBreaker(
          `llm-${provider.name}`,
          async () => {
            return await this.executeProviderRequest(provider, request);
          },
          async () => {
            throw new Error(`Circuit breaker open for ${provider.name}`);
          }
        );

        if (this.failoverState.currentProvider !== provider.name) {
          logger.info(`Successfully failed over to provider: ${provider.name}`);
          this.failoverState.currentProvider = provider.name;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`LLM provider '${provider.name}' failed:`, error);
        
        this.failoverState.failedProviders.add(provider.name);
        
        if (this.failoverState.currentProvider === provider.name) {
          this.recordFailover();
        }
      }
    }

    throw new Error(`All LLM providers failed. Last error: ${lastError!.message}`);
  }

  private getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.values())
      .filter(provider => !this.failoverState.failedProviders.has(provider.name))
      .sort((a, b) => {
        if (a.name === this.failoverState.currentProvider) return -1;
        if (b.name === this.failoverState.currentProvider) return 1;
        return a.priority - b.priority;
      });
  }

  private async executeProviderRequest(provider: LLMProvider, request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    
    try {
      const providerRequest = this.transformRequest(provider, request);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), provider.timeout);

      const response = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'BMAD-Platform/1.0'
        },
        body: JSON.stringify(providerRequest),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Provider request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const responseData = await response.json();
      const transformedResponse = this.transformResponse(provider, responseData);
      
      const duration = Date.now() - startTime;
      const tokens = this.estimateTokens(request.messages) + this.estimateTokens([{ role: 'assistant', content: transformedResponse.content }]);
      const cost = tokens * provider.costPerToken;

      logger.info(`LLM request completed:`, {
        provider: provider.name,
        duration,
        tokens,
        cost: `$${cost.toFixed(6)}`
      });

      return {
        ...transformedResponse,
        metadata: {
          provider: provider.name,
          model: provider.model,
          duration,
          tokens,
          cost
        }
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`LLM provider '${provider.name}' request failed:`, {
        error: (error as Error).message,
        duration,
        provider: provider.name
      });
      throw error;
    }
  }

  private transformRequest(provider: LLMProvider, request: LLMRequest): any {
    switch (provider.name) {
      case 'openai-gpt4':
      case 'azure-openai':
        return {
          model: provider.model,
          messages: request.messages,
          max_tokens: request.maxTokens || provider.maxTokens,
          temperature: request.temperature || 0.7,
          stream: request.stream || false
        };
      
      case 'anthropic-claude':
        return {
          model: provider.model,
          max_tokens: request.maxTokens || provider.maxTokens,
          messages: request.messages,
          temperature: request.temperature || 0.7,
          stream: request.stream || false
        };
      
      default:
        return request;
    }
  }

  private transformResponse(provider: LLMProvider, response: any): LLMResponse {
    switch (provider.name) {
      case 'openai-gpt4':
      case 'azure-openai':
        return {
          content: response.choices?.[0]?.message?.content || '',
          role: 'assistant',
          finishReason: response.choices?.[0]?.finish_reason
        };
      
      case 'anthropic-claude':
        return {
          content: response.content?.[0]?.text || '',
          role: 'assistant',
          finishReason: response.stop_reason
        };
      
      default:
        return response;
    }
  }

  private estimateTokens(messages: Array<{ role: string; content: string }>): number {
    const text = messages.map(m => m.content).join(' ');
    return Math.ceil(text.length / 4);
  }

  private recordFailover() {
    this.failoverState.lastFailoverTime = Date.now();
    this.failoverState.totalFailovers++;
    
    logger.warn(`LLM provider failover recorded. Total failovers: ${this.failoverState.totalFailovers}`);
  }

  getProviderStatus() {
    const providers = Array.from(this.providers.entries()).map(([name, config]) => {
      const circuitState = circuitBreakerService.getState(`llm-${name}`);
      const isFailed = this.failoverState.failedProviders.has(name);
      
      return {
        name,
        model: config.model,
        priority: config.priority,
        costPerToken: config.costPerToken,
        isCurrent: name === this.failoverState.currentProvider,
        isFailed,
        circuitState: circuitState?.state,
        lastFailure: circuitState?.lastFailureTime,
        successRate: this.calculateSuccessRate(name)
      };
    });

    return {
      currentProvider: this.failoverState.currentProvider,
      totalFailovers: this.failoverState.totalFailovers,
      lastFailoverTime: this.failoverState.lastFailoverTime,
      providers
    };
  }

  private calculateSuccessRate(providerName: string): number {
    const circuitState = circuitBreakerService.getState(`llm-${providerName}`);
    if (!circuitState || circuitState.recentCalls?.length === 0) return 100;
    
    const successes = circuitState.recentCalls?.filter(call => call.success).length || 0;
    return (successes / (circuitState.recentCalls?.length || 1)) * 100;
  }

  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}

export const llmProviderFailover = new LLMProviderFailover();

// Express middleware for LLM request handling
export function llmErrorRecoveryMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json;
  
  res.json = function(body?: any) {
    if (res.statusCode >= 500 && body?.error) {
      body.recovery = {
        suggestions: [
          'Try your request again in a few moments',
          'Check your network connection',
          'Contact support if the problem persists'
        ],
        supportContact: 'support@bmadkit.com',
        timestamp: new Date().toISOString()
      };
    }
    
    return originalJson.call(this, body);
  };
  
  next();
}