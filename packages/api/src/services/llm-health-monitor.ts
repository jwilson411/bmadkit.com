import { EventEmitter } from 'events';
import { logger } from '../utils/logger.ts';
import { LLMProvider, ProviderHealth, LLMRequest, LLMResponse, LLMError } from '../models/llm-request.ts';
import { OpenAIClient } from './openai-client.ts';
import { AnthropicClient } from './anthropic-client.ts';

export interface HealthCheckConfig {
  interval: number; // milliseconds
  timeout: number; // milliseconds
  healthyThreshold: number; // consecutive successes to mark as healthy
  unhealthyThreshold: number; // consecutive failures to mark as unhealthy
  enableAutoRecovery: boolean;
}

export interface HealthMetrics {
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalLatency: number;
  recentLatencies: number[];
  recentErrors: string[];
  lastRequestTime?: Date;
  lastSuccessTime?: Date;
  lastErrorTime?: Date;
}

export class LLMHealthMonitor extends EventEmitter {
  private config: HealthCheckConfig;
  private healthStatus = new Map<LLMProvider, ProviderHealth>();
  private metrics = new Map<LLMProvider, HealthMetrics>();
  private healthCheckIntervals = new Map<LLMProvider, NodeJS.Timeout>();
  private clients: {
    openai?: OpenAIClient;
    anthropic?: AnthropicClient;
  } = {};

  constructor(config: Partial<HealthCheckConfig> = {}) {
    super();
    
    this.config = {
      interval: 30000, // 30 seconds
      timeout: 10000, // 10 seconds
      healthyThreshold: 3,
      unhealthyThreshold: 3,
      enableAutoRecovery: true,
      ...config
    };

    // Initialize health status for all providers
    this.initializeHealthStatus();
    
    logger.info('LLM Health Monitor initialized', {
      interval: this.config.interval,
      timeout: this.config.timeout,
      autoRecovery: this.config.enableAutoRecovery
    });
  }

  /**
   * Register LLM clients for health monitoring
   */
  registerClients(clients: { openai?: OpenAIClient; anthropic?: AnthropicClient }): void {
    this.clients = clients;
    
    // Start health checks for registered clients
    if (clients.openai) {
      this.startHealthCheck('openai');
    }
    if (clients.anthropic) {
      this.startHealthCheck('anthropic');
    }

    logger.info('LLM clients registered for health monitoring', {
      openai: !!clients.openai,
      anthropic: !!clients.anthropic
    });
  }

  /**
   * Record successful request
   */
  recordSuccess(provider: LLMProvider, latency: number, response?: LLMResponse): void {
    const metrics = this.getMetrics(provider);
    const health = this.getHealth(provider);

    metrics.requestCount++;
    metrics.successCount++;
    metrics.totalLatency += latency;
    metrics.recentLatencies.push(latency);
    metrics.lastRequestTime = new Date();
    metrics.lastSuccessTime = new Date();

    // Keep only recent latencies (last 100)
    if (metrics.recentLatencies.length > 100) {
      metrics.recentLatencies = metrics.recentLatencies.slice(-100);
    }

    // Update health status
    health.lastSuccessAt = new Date();
    health.consecutiveFailures = 0;
    health.requestsInLastMinute++;

    if (response) {
      health.tokensUsedToday += response.usage.totalTokens;
      health.costToday += response.cost.totalCost;
    }

    this.updateHealthStatus(provider);
    this.emitMetricsUpdate(provider);

    logger.debug('Recorded successful request', {
      provider,
      latency,
      requestCount: metrics.requestCount,
      successRate: metrics.successCount / metrics.requestCount
    });
  }

  /**
   * Record failed request
   */
  recordFailure(provider: LLMProvider, error: LLMError, latency?: number): void {
    const metrics = this.getMetrics(provider);
    const health = this.getHealth(provider);

    metrics.requestCount++;
    metrics.errorCount++;
    metrics.lastRequestTime = new Date();
    metrics.lastErrorTime = new Date();
    
    if (latency) {
      metrics.totalLatency += latency;
      metrics.recentLatencies.push(latency);
    }

    metrics.recentErrors.push(error.message);
    
    // Keep only recent errors (last 50)
    if (metrics.recentErrors.length > 50) {
      metrics.recentErrors = metrics.recentErrors.slice(-50);
    }

    // Update health status
    health.lastErrorAt = new Date();
    health.lastError = error.message;
    health.consecutiveFailures++;
    health.requestsInLastMinute++;

    this.updateHealthStatus(provider);
    this.emitMetricsUpdate(provider);

    logger.warn('Recorded failed request', {
      provider,
      error: error.message,
      errorType: error.errorType,
      consecutiveFailures: health.consecutiveFailures,
      errorRate: metrics.errorCount / metrics.requestCount
    });
  }

  /**
   * Get current health status for a provider
   */
  getProviderHealth(provider: LLMProvider): ProviderHealth {
    return { ...this.getHealth(provider) };
  }

  /**
   * Get health status for all providers
   */
  getAllHealthStatus(): Map<LLMProvider, ProviderHealth> {
    const allHealth = new Map<LLMProvider, ProviderHealth>();
    
    for (const [provider, health] of this.healthStatus.entries()) {
      allHealth.set(provider, { ...health });
    }
    
    return allHealth;
  }

  /**
   * Get detailed metrics for a provider
   */
  getProviderMetrics(provider: LLMProvider): HealthMetrics {
    return { ...this.getMetrics(provider) };
  }

  /**
   * Get the healthiest provider
   */
  getHealthiestProvider(): LLMProvider | null {
    let healthiestProvider: LLMProvider | null = null;
    let bestScore = -1;

    for (const [provider, health] of this.healthStatus.entries()) {
      const score = this.calculateHealthScore(provider, health);
      
      if (score > bestScore) {
        bestScore = score;
        healthiestProvider = provider;
      }
    }

    logger.debug('Healthiest provider determined', {
      provider: healthiestProvider,
      score: bestScore
    });

    return healthiestProvider;
  }

  /**
   * Check if a provider is available for requests
   */
  isProviderHealthy(provider: LLMProvider): boolean {
    const health = this.getHealth(provider);
    return health.status === 'healthy' && health.circuitBreakerState === 'closed';
  }

  /**
   * Force health check for specific provider
   */
  async forceHealthCheck(provider: LLMProvider): Promise<ProviderHealth> {
    await this.performHealthCheck(provider);
    return this.getProviderHealth(provider);
  }

  /**
   * Reset health metrics for a provider
   */
  resetProviderMetrics(provider: LLMProvider): void {
    this.metrics.set(provider, this.createEmptyMetrics());
    this.initializeProviderHealth(provider);
    
    logger.info('Reset health metrics', { provider });
    this.emitMetricsUpdate(provider);
  }

  /**
   * Stop health monitoring
   */
  shutdown(): void {
    for (const [provider, intervalId] of this.healthCheckIntervals.entries()) {
      clearInterval(intervalId);
      logger.debug('Stopped health check interval', { provider });
    }
    
    this.healthCheckIntervals.clear();
    this.removeAllListeners();
    
    logger.info('LLM Health Monitor shutdown complete');
  }

  // Private methods

  private initializeHealthStatus(): void {
    const providers: LLMProvider[] = ['openai', 'anthropic'];
    
    for (const provider of providers) {
      this.initializeProviderHealth(provider);
      this.metrics.set(provider, this.createEmptyMetrics());
    }
  }

  private initializeProviderHealth(provider: LLMProvider): void {
    this.healthStatus.set(provider, {
      provider,
      status: 'unknown',
      latency: 0,
      successRate: 0,
      errorRate: 0,
      consecutiveFailures: 0,
      circuitBreakerState: 'closed',
      requestsInLastMinute: 0,
      tokensUsedToday: 0,
      costToday: 0,
      updatedAt: new Date(),
    });
  }

  private createEmptyMetrics(): HealthMetrics {
    return {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      totalLatency: 0,
      recentLatencies: [],
      recentErrors: [],
    };
  }

  private getHealth(provider: LLMProvider): ProviderHealth {
    return this.healthStatus.get(provider)!;
  }

  private getMetrics(provider: LLMProvider): HealthMetrics {
    return this.metrics.get(provider)!;
  }

  private startHealthCheck(provider: LLMProvider): void {
    // Clear existing interval if any
    const existingInterval = this.healthCheckIntervals.get(provider);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Start new health check interval
    const interval = setInterval(() => {
      this.performHealthCheck(provider).catch(error => {
        logger.error('Health check failed', {
          provider,
          error: error.message
        });
      });
    }, this.config.interval);

    this.healthCheckIntervals.set(provider, interval);
    
    // Perform initial health check
    this.performHealthCheck(provider).catch(error => {
      logger.warn('Initial health check failed', {
        provider,
        error: error.message
      });
    });

    logger.info('Started health check', { provider, interval: this.config.interval });
  }

  private async performHealthCheck(provider: LLMProvider): Promise<void> {
    const startTime = Date.now();
    
    try {
      let isHealthy = false;
      
      switch (provider) {
        case 'openai':
          if (this.clients.openai) {
            isHealthy = await this.clients.openai.testConnection();
          }
          break;
        case 'anthropic':
          if (this.clients.anthropic) {
            isHealthy = await this.clients.anthropic.testConnection();
          }
          break;
      }

      const latency = Date.now() - startTime;
      
      if (isHealthy) {
        this.recordHealthCheckSuccess(provider, latency);
      } else {
        this.recordHealthCheckFailure(provider, 'Health check failed', latency);
      }

    } catch (error) {
      const latency = Date.now() - startTime;
      this.recordHealthCheckFailure(provider, (error as Error).message, latency);
    }
  }

  private recordHealthCheckSuccess(provider: LLMProvider, latency: number): void {
    const health = this.getHealth(provider);
    
    health.latency = latency;
    health.lastSuccessAt = new Date();
    health.consecutiveFailures = 0;
    
    this.updateHealthStatus(provider);

    logger.debug('Health check successful', { provider, latency });
  }

  private recordHealthCheckFailure(provider: LLMProvider, error: string, latency: number): void {
    const health = this.getHealth(provider);
    
    health.latency = latency;
    health.lastError = error;
    health.lastErrorAt = new Date();
    health.consecutiveFailures++;
    
    this.updateHealthStatus(provider);

    logger.warn('Health check failed', { provider, error, consecutiveFailures: health.consecutiveFailures });
  }

  private updateHealthStatus(provider: LLMProvider): void {
    const health = this.getHealth(provider);
    const metrics = this.getMetrics(provider);
    
    // Calculate rates
    if (metrics.requestCount > 0) {
      health.successRate = metrics.successCount / metrics.requestCount;
      health.errorRate = metrics.errorCount / metrics.requestCount;
    }

    // Calculate average latency
    if (metrics.recentLatencies.length > 0) {
      health.latency = metrics.recentLatencies.reduce((sum, lat) => sum + lat, 0) / metrics.recentLatencies.length;
    }

    // Determine health status
    const previousStatus = health.status;
    health.status = this.calculateHealthStatus(provider, health);
    health.updatedAt = new Date();

    // Emit status change events
    if (previousStatus !== health.status) {
      this.emit('healthStatusChanged', {
        provider,
        previousStatus,
        newStatus: health.status,
        health: { ...health }
      });

      logger.info('Provider health status changed', {
        provider,
        from: previousStatus,
        to: health.status,
        consecutiveFailures: health.consecutiveFailures
      });
    }
  }

  private calculateHealthStatus(provider: LLMProvider, health: ProviderHealth): ProviderHealth['status'] {
    // If circuit breaker is open, provider is unhealthy
    if (health.circuitBreakerState === 'open') {
      return 'unhealthy';
    }

    // Check consecutive failures
    if (health.consecutiveFailures >= this.config.unhealthyThreshold) {
      return 'unhealthy';
    }

    if (health.consecutiveFailures > 0) {
      return 'degraded';
    }

    // Check error rate
    if (health.errorRate > 0.1) { // More than 10% error rate
      return 'degraded';
    }

    if (health.errorRate > 0.2) { // More than 20% error rate
      return 'unhealthy';
    }

    // Check recent activity
    if (health.lastSuccessAt && Date.now() - health.lastSuccessAt.getTime() < this.config.interval * 2) {
      return 'healthy';
    }

    return 'unknown';
  }

  private calculateHealthScore(provider: LLMProvider, health: ProviderHealth): number {
    if (health.status === 'unhealthy') return 0;
    if (health.status === 'unknown') return 10;
    if (health.status === 'degraded') return 50;

    // Healthy provider - calculate score based on metrics
    let score = 100;

    // Penalize high latency
    if (health.latency > 5000) score -= 20;
    else if (health.latency > 2000) score -= 10;

    // Penalize high error rate
    score -= health.errorRate * 30;

    // Penalize recent errors
    if (health.consecutiveFailures > 0) {
      score -= health.consecutiveFailures * 5;
    }

    return Math.max(0, score);
  }

  private emitMetricsUpdate(provider: LLMProvider): void {
    this.emit('metricsUpdate', {
      provider,
      health: { ...this.getHealth(provider) },
      metrics: { ...this.getMetrics(provider) }
    });
  }
}