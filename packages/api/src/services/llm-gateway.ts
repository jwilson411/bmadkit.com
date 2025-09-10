import { EventEmitter } from 'events';
import { LRUCache } from 'lru-cache';
import { logger } from '../utils/logger.ts';
import { 
  LLMRequest, 
  LLMResponse, 
  LLMError,
  LLMProvider, 
  LLMConfig,
  LLMMessage,
  UsageMetrics,
  ProviderHealth,
  LLMConfigSchema
} from '../models/llm-request.ts';
import { OpenAIClient } from './openai-client.ts';
import { AnthropicClient } from './anthropic-client.ts';
import { LLMHealthMonitor } from './llm-health-monitor.ts';

export interface GatewayConfig {
  providers: {
    openai?: {
      enabled: boolean;
      apiKey: string;
      organization?: string;
    };
    anthropic?: {
      enabled: boolean;
      apiKey: string;
    };
  };
  gateway: {
    primaryProvider: LLMProvider;
    enableFailover: boolean;
    maxRetries: number;
    requestTimeout: number;
    enableCaching: boolean;
    cacheTimeToLive: number;
  };
}

export interface GatewayStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  providerSwitches: number;
  cacheHits: number;
  cacheMisses: number;
  totalCost: number;
  averageLatency: number;
  uptime: number; // seconds
}

export class LLMGatewayError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: LLMProvider,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'LLMGatewayError';
  }
}

export class LLMGateway extends EventEmitter {
  private config: LLMConfig;
  private clients: Map<LLMProvider, OpenAIClient | AnthropicClient> = new Map();
  private healthMonitor: LLMHealthMonitor;
  private responseCache: LRUCache<string, LLMResponse>;
  private usageMetrics: Map<LLMProvider, UsageMetrics> = new Map();
  private gatewayStats: GatewayStats;
  private startTime: Date;

  constructor(config: Partial<LLMConfig>) {
    super();

    // Validate and set configuration
    this.config = LLMConfigSchema.parse({
      providers: {
        openai: {
          enabled: false,
          apiKey: '',
          defaultModel: 'gpt-4',
          maxTokens: 2048,
          temperature: 0.7,
          timeout: 30000,
          retryAttempts: 3,
          rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100000 },
          pricing: { promptTokenCost: 0.03, completionTokenCost: 0.06 }
        },
        anthropic: {
          enabled: false,
          apiKey: '',
          defaultModel: 'claude-3-sonnet-20240229',
          maxTokens: 2048,
          temperature: 0.7,
          timeout: 30000,
          retryAttempts: 3,
          rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100000 },
          pricing: { promptTokenCost: 0.003, completionTokenCost: 0.015 }
        }
      },
      gateway: {
        primaryProvider: 'openai',
        enableFailover: true,
        healthCheckInterval: 30000,
        circuitBreakerThreshold: 5,
        circuitBreakerTimeout: 60000,
        maxConcurrentRequests: 100,
        requestTimeout: 60000,
        enableCaching: true,
        cacheTimeToLive: 300000,
        logLevel: 'info'
      },
      monitoring: {
        enableMetrics: true,
        enableTracing: true,
        alertThresholds: {
          errorRatePercent: 10,
          latencyMs: 5000,
          costPerHour: 100
        }
      },
      ...config
    });

    this.startTime = new Date();
    this.gatewayStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      providerSwitches: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalCost: 0,
      averageLatency: 0,
      uptime: 0
    };

    // Initialize response cache
    this.responseCache = new LRUCache<string, LLMResponse>({
      max: 1000,
      ttl: this.config.gateway.cacheTimeToLive,
      updateAgeOnGet: true,
    });

    // Initialize health monitor
    this.healthMonitor = new LLMHealthMonitor({
      interval: this.config.gateway.healthCheckInterval,
      timeout: 10000,
      healthyThreshold: 3,
      unhealthyThreshold: 3,
      enableAutoRecovery: true
    });

    // Listen to health monitor events
    this.setupHealthMonitorEvents();

    logger.info('LLM Gateway initialized', {
      primaryProvider: this.config.gateway.primaryProvider,
      enableFailover: this.config.gateway.enableFailover,
      enableCaching: this.config.gateway.enableCaching,
      providers: Object.keys(this.config.providers).filter(p => this.config.providers[p as LLMProvider].enabled)
    });
  }

  /**
   * Initialize the gateway with configured providers
   */
  async initialize(): Promise<void> {
    try {
      // Initialize enabled providers
      await this.initializeProviders();
      
      // Register clients with health monitor
      const clientsToRegister: { openai?: OpenAIClient; anthropic?: AnthropicClient } = {};
      
      if (this.clients.has('openai')) {
        clientsToRegister.openai = this.clients.get('openai') as OpenAIClient;
      }
      if (this.clients.has('anthropic')) {
        clientsToRegister.anthropic = this.clients.get('anthropic') as AnthropicClient;
      }
      
      this.healthMonitor.registerClients(clientsToRegister);

      // Initialize usage metrics
      this.initializeUsageMetrics();

      logger.info('LLM Gateway initialized successfully', {
        enabledProviders: Array.from(this.clients.keys()),
        cacheEnabled: this.config.gateway.enableCaching
      });

      this.emit('initialized', {
        providers: Array.from(this.clients.keys()),
        primaryProvider: this.config.gateway.primaryProvider
      });

    } catch (error) {
      logger.error('Failed to initialize LLM Gateway', {
        error: (error as Error).message
      });
      throw new LLMGatewayError(
        `Gateway initialization failed: ${(error as Error).message}`,
        'INITIALIZATION_ERROR'
      );
    }
  }

  /**
   * Send completion request with automatic provider selection and failover
   */
  async complete(messages: LLMMessage[], options: Partial<LLMRequest> = {}): Promise<LLMResponse> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Build complete request
    const request: LLMRequest = {
      id: requestId,
      provider: this.selectProvider(),
      model: options.model || this.getDefaultModel(this.config.gateway.primaryProvider),
      messages,
      maxTokens: options.maxTokens || this.config.providers[this.config.gateway.primaryProvider].maxTokens,
      temperature: options.temperature || this.config.providers[this.config.gateway.primaryProvider].temperature,
      topP: options.topP,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      stopSequences: options.stopSequences,
      userId: options.userId,
      sessionId: options.sessionId,
      correlationId: options.correlationId || requestId,
      createdAt: new Date(),
      timeout: options.timeout || this.config.gateway.requestTimeout
    };

    this.gatewayStats.totalRequests++;

    logger.info('LLM Gateway completion request', {
      requestId,
      provider: request.provider,
      model: request.model,
      messageCount: messages.length,
      maxTokens: request.maxTokens
    });

    try {
      // Check cache first
      if (this.config.gateway.enableCaching) {
        const cacheKey = this.generateCacheKey(request);
        const cachedResponse = this.responseCache.get(cacheKey);
        
        if (cachedResponse) {
          this.gatewayStats.cacheHits++;
          
          logger.debug('Cache hit for completion request', {
            requestId,
            cacheKey: cacheKey.substring(0, 32) + '...'
          });

          return {
            ...cachedResponse,
            id: `cached_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            requestId,
            createdAt: new Date()
          };
        }
        
        this.gatewayStats.cacheMisses++;
      }

      // Execute request with failover
      const response = await this.executeWithFailover(request);

      // Cache successful response
      if (this.config.gateway.enableCaching && response) {
        const cacheKey = this.generateCacheKey(request);
        this.responseCache.set(cacheKey, response);
      }

      // Update metrics
      const latency = Date.now() - startTime;
      this.updateGatewayStats(true, latency, response.cost.totalCost);
      this.healthMonitor.recordSuccess(request.provider, latency, response);

      logger.info('LLM Gateway completion successful', {
        requestId,
        provider: request.provider,
        latency,
        cost: response.cost.totalCost,
        tokens: response.usage.totalTokens
      });

      this.emit('completion', { request, response, latency });

      return response;

    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateGatewayStats(false, latency, 0);

      logger.error('LLM Gateway completion failed', {
        requestId,
        provider: request.provider,
        error: (error as Error).message,
        latency
      });

      this.emit('error', { request, error, latency });

      throw error;
    }
  }

  /**
   * Get current health status for all providers
   */
  getHealthStatus(): Map<LLMProvider, ProviderHealth> {
    return this.healthMonitor.getAllHealthStatus();
  }

  /**
   * Get usage metrics for all providers
   */
  getUsageMetrics(): Map<LLMProvider, UsageMetrics> {
    return new Map(this.usageMetrics);
  }

  /**
   * Get gateway statistics
   */
  getGatewayStats(): GatewayStats {
    return {
      ...this.gatewayStats,
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000)
    };
  }

  /**
   * Clear response cache
   */
  clearCache(): void {
    this.responseCache.clear();
    this.gatewayStats.cacheHits = 0;
    this.gatewayStats.cacheMisses = 0;
    
    logger.info('LLM Gateway cache cleared');
    this.emit('cacheCleared');
  }

  /**
   * Force provider health check
   */
  async checkProviderHealth(provider: LLMProvider): Promise<ProviderHealth> {
    return await this.healthMonitor.forceHealthCheck(provider);
  }

  /**
   * Gracefully shutdown the gateway
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down LLM Gateway');

    this.healthMonitor.shutdown();
    this.responseCache.clear();
    this.removeAllListeners();

    logger.info('LLM Gateway shutdown complete');
  }

  // Private methods

  private async initializeProviders(): Promise<void> {
    if (this.config.providers.openai.enabled) {
      const client = new OpenAIClient({
        apiKey: this.config.providers.openai.apiKey,
        organization: this.config.providers.openai.organization,
        timeout: this.config.providers.openai.timeout
      });
      
      this.clients.set('openai', client);
      logger.debug('OpenAI client initialized');
    }

    if (this.config.providers.anthropic.enabled) {
      const client = new AnthropicClient({
        apiKey: this.config.providers.anthropic.apiKey,
        timeout: this.config.providers.anthropic.timeout
      });
      
      this.clients.set('anthropic', client);
      logger.debug('Anthropic client initialized');
    }

    if (this.clients.size === 0) {
      throw new Error('No LLM providers enabled in configuration');
    }
  }

  private initializeUsageMetrics(): void {
    const providers = Array.from(this.clients.keys()) as LLMProvider[];
    
    for (const provider of providers) {
      this.usageMetrics.set(provider, {
        provider,
        timeframe: 'day',
        requestCount: 0,
        tokenCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalCost: 0,
        averageLatency: 0,
        errorCount: 0,
        errorRate: 0,
        startTime: new Date(),
        endTime: new Date()
      });
    }
  }

  private selectProvider(): LLMProvider {
    if (!this.config.gateway.enableFailover) {
      return this.config.gateway.primaryProvider;
    }

    // Get healthiest provider
    const healthiestProvider = this.healthMonitor.getHealthiestProvider();
    
    if (healthiestProvider && this.healthMonitor.isProviderHealthy(healthiestProvider)) {
      return healthiestProvider;
    }

    // Fallback to primary provider
    if (this.healthMonitor.isProviderHealthy(this.config.gateway.primaryProvider)) {
      return this.config.gateway.primaryProvider;
    }

    // Find any healthy provider
    for (const [provider] of this.clients) {
      if (this.healthMonitor.isProviderHealthy(provider)) {
        return provider;
      }
    }

    // No healthy providers, return primary (will likely fail but provides consistent error handling)
    return this.config.gateway.primaryProvider;
  }

  private async executeWithFailover(request: LLMRequest): Promise<LLMResponse> {
    const providers = this.getProviderFallbackOrder(request.provider);
    let lastError: Error;

    for (const provider of providers) {
      const client = this.clients.get(provider);
      if (!client) {
        continue;
      }

      try {
        request.provider = provider;
        
        if (provider !== providers[0]) {
          this.gatewayStats.providerSwitches++;
          logger.info('Switching to fallback provider', {
            requestId: request.id,
            from: providers[0],
            to: provider
          });
        }

        const response = await client.complete(request);
        return response;

      } catch (error) {
        lastError = error as Error;
        
        if (error instanceof Error && 'errorType' in error) {
          const llmError = error as LLMError;
          this.healthMonitor.recordFailure(provider, llmError);
          
          // Don't try other providers for certain error types
          if (!llmError.retryable) {
            break;
          }
        }

        logger.warn('Provider request failed, trying next', {
          requestId: request.id,
          provider,
          error: (error as Error).message
        });
      }
    }

    throw lastError! || new LLMGatewayError('All providers failed', 'ALL_PROVIDERS_FAILED');
  }

  private getProviderFallbackOrder(primaryProvider: LLMProvider): LLMProvider[] {
    const providers = Array.from(this.clients.keys()) as LLMProvider[];
    
    // Put primary provider first, then others
    const fallbackOrder = [primaryProvider];
    for (const provider of providers) {
      if (provider !== primaryProvider) {
        fallbackOrder.push(provider);
      }
    }
    
    return fallbackOrder;
  }

  private getDefaultModel(provider: LLMProvider): string {
    return this.config.providers[provider].defaultModel;
  }

  private generateCacheKey(request: LLMRequest): string {
    const keyData = {
      model: request.model,
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      topP: request.topP,
      stopSequences: request.stopSequences
    };
    
    // Simple hash of the request data
    return `cache_${Buffer.from(JSON.stringify(keyData)).toString('base64').slice(0, 32)}`;
  }

  private updateGatewayStats(success: boolean, latency: number, cost: number): void {
    if (success) {
      this.gatewayStats.successfulRequests++;
    } else {
      this.gatewayStats.failedRequests++;
    }

    this.gatewayStats.totalCost += cost;
    
    // Update average latency
    const totalRequests = this.gatewayStats.totalRequests;
    this.gatewayStats.averageLatency = 
      (this.gatewayStats.averageLatency * (totalRequests - 1) + latency) / totalRequests;
  }

  private setupHealthMonitorEvents(): void {
    this.healthMonitor.on('healthStatusChanged', (event) => {
      logger.info('Provider health status changed', event);
      this.emit('providerHealthChanged', event);
    });

    this.healthMonitor.on('metricsUpdate', (event) => {
      this.emit('providerMetricsUpdate', event);
    });
  }
}

// Export configured instance factory
export function createLLMGateway(config: Partial<LLMConfig>): LLMGateway {
  return new LLMGateway(config);
}