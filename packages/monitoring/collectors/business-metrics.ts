import { EventEmitter } from 'events';
import winston from 'winston';
import Redis from 'ioredis';

/**
 * LLM Provider Monitoring Service
 * Comprehensive monitoring with automatic failover triggers and cost tracking
 */

export interface LLMProvider {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiVersion: string;
  priority: number;
  healthStatus: ProviderHealth;
  configuration: ProviderConfiguration;
  metrics: ProviderMetrics;
  costTracking: CostTracking;
  qualityMetrics: QualityMetrics;
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  lastHealthCheck: number;
  consecutiveFailures: number;
  uptime: number;
  responseTime: HealthResponseTime;
  errorRates: HealthErrorRates;
  throughput: HealthThroughput;
}

export interface HealthResponseTime {
  current: number;
  average: number;
  p95: number;
  p99: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface HealthErrorRates {
  current: number;
  average: number;
  byType: Record<string, number>;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface HealthThroughput {
  requestsPerSecond: number;
  tokensPerSecond: number;
  capacity: number;
  utilization: number;
}

export interface ProviderConfiguration {
  maxConcurrentRequests: number;
  timeout: number;
  retryPolicy: RetryPolicy;
  rateLimits: RateLimits;
  failoverRules: FailoverRule[];
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export interface RateLimits {
  requestsPerMinute: number;
  tokensPerMinute: number;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
}

export interface FailoverRule {
  trigger: FailoverTrigger;
  threshold: number;
  duration: number;
  action: 'failover' | 'reduce_traffic' | 'alert_only';
  cooldownPeriod: number;
}

export interface FailoverTrigger {
  type: 'response_time' | 'error_rate' | 'availability' | 'cost' | 'quality';
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte';
}

export interface ProviderMetrics {
  requests: RequestMetrics;
  responses: ResponseMetrics;
  errors: ErrorMetrics;
  performance: PerformanceMetrics;
  availability: AvailabilityMetrics;
}

export interface RequestMetrics {
  total: number;
  successful: number;
  failed: number;
  retried: number;
  rate: number;
  tokensConsumed: number;
}

export interface ResponseMetrics {
  averageTime: number;
  medianTime: number;
  p95Time: number;
  p99Time: number;
  timeoutCount: number;
  qualityScore: number;
}

export interface ErrorMetrics {
  total: number;
  rate: number;
  byStatusCode: Record<string, number>;
  byErrorType: Record<string, number>;
  recoverable: number;
  nonRecoverable: number;
}

export interface PerformanceMetrics {
  throughput: number;
  latency: number;
  reliability: number;
  efficiency: number;
  overallScore: number;
}

export interface AvailabilityMetrics {
  uptime: number;
  sla: number;
  mtbf: number; // Mean Time Between Failures
  mttr: number; // Mean Time To Recovery
  plannedDowntime: number;
}

export interface CostTracking {
  current: CostMetrics;
  historical: HistoricalCost[];
  budget: BudgetTracking;
  forecasting: CostForecasting;
  optimization: CostOptimization;
}

export interface CostMetrics {
  totalCost: number;
  costPerRequest: number;
  costPerToken: number;
  costPerMinute: number;
  currency: string;
  billingPeriod: string;
}

export interface HistoricalCost {
  timestamp: number;
  cost: number;
  requests: number;
  tokens: number;
  period: string;
}

export interface BudgetTracking {
  monthlyBudget: number;
  currentSpend: number;
  utilization: number;
  forecastedSpend: number;
  alertThresholds: number[];
}

export interface CostForecasting {
  nextMonth: number;
  nextQuarter: number;
  nextYear: number;
  confidence: number;
  factors: string[];
}

export interface CostOptimization {
  recommendations: OptimizationRecommendation[];
  potentialSavings: number;
  implementationEffort: 'low' | 'medium' | 'high';
}

export interface OptimizationRecommendation {
  type: string;
  description: string;
  impact: number;
  effort: 'low' | 'medium' | 'high';
  timeframe: string;
}

export interface QualityMetrics {
  accuracy: number;
  relevance: number;
  completeness: number;
  consistency: number;
  responseQuality: ResponseQuality;
  userSatisfaction: number;
  overallScore: number;
}

export interface ResponseQuality {
  coherence: number;
  factualAccuracy: number;
  helpfulness: number;
  safety: number;
  bias: number;
}

/**
 * LLM Provider Monitor
 * Monitors provider health, performance, costs, and quality with automatic failover
 */
export class LLMProviderMonitor extends EventEmitter {
  private redis: Redis;
  private logger: winston.Logger;
  private providers: Map<string, LLMProvider> = new Map();
  private healthCheckTimer: NodeJS.Timer | null = null;
  private metricsTimer: NodeJS.Timer | null = null;
  private costTrackingTimer: NodeJS.Timer | null = null;
  private failoverManager: FailoverManager;
  private costOptimizer: CostOptimizer;
  private qualityAnalyzer: QualityAnalyzer;

  constructor(
    private config: {
      redis: {
        url: string;
        keyPrefix: string;
      };
      monitoring: {
        healthCheckInterval: number;
        metricsInterval: number;
        costTrackingInterval: number;
      };
      failover: {
        enabled: boolean;
        defaultRules: FailoverRule[];
      };
      cost: {
        trackingEnabled: boolean;
        budgetAlerts: number[];
        optimizationEnabled: boolean;
      };
      quality: {
        monitoringEnabled: boolean;
        samplingRate: number;
        benchmarks: Record<string, number>;
      };
    }
  ) {
    super();
    
    this.initializeRedis();
    this.initializeLogger();
    this.failoverManager = new FailoverManager(this);
    this.costOptimizer = new CostOptimizer(config.cost);
    this.qualityAnalyzer = new QualityAnalyzer(config.quality);
    
    this.startMonitoring();
  }

  /**
   * Initialize Redis connection
   */
  private initializeRedis(): void {
    this.redis = new Redis(this.config.redis.url, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.redis.on('error', (error) => {
      this.logger.error('LLM Monitor Redis error', { error: error.message });
    });
  }

  /**
   * Initialize structured logging
   */
  private initializeLogger(): void {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'llm-provider-monitor' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/llm-provider-monitor.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Start monitoring processes
   */
  private startMonitoring(): void {
    // Health checks
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.monitoring.healthCheckInterval);

    // Metrics collection
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoring.metricsInterval);

    // Cost tracking
    if (this.config.cost.trackingEnabled) {
      this.costTrackingTimer = setInterval(() => {
        this.updateCostTracking();
      }, this.config.monitoring.costTrackingInterval);
    }

    this.logger.info('LLM provider monitoring started');
  }

  /**
   * Register LLM provider for monitoring
   */
  async registerProvider(providerConfig: {
    id: string;
    name: string;
    endpoint: string;
    model: string;
    apiVersion: string;
    priority: number;
    configuration: ProviderConfiguration;
  }): Promise<void> {
    const provider: LLMProvider = {
      id: providerConfig.id,
      name: providerConfig.name,
      endpoint: providerConfig.endpoint,
      model: providerConfig.model,
      apiVersion: providerConfig.apiVersion,
      priority: providerConfig.priority,
      configuration: providerConfig.configuration,
      healthStatus: {
        status: 'healthy',
        lastHealthCheck: 0,
        consecutiveFailures: 0,
        uptime: 100,
        responseTime: {
          current: 0,
          average: 0,
          p95: 0,
          p99: 0,
          trend: 'stable'
        },
        errorRates: {
          current: 0,
          average: 0,
          byType: {},
          trend: 'stable'
        },
        throughput: {
          requestsPerSecond: 0,
          tokensPerSecond: 0,
          capacity: 100,
          utilization: 0
        }
      },
      metrics: {
        requests: {
          total: 0,
          successful: 0,
          failed: 0,
          retried: 0,
          rate: 0,
          tokensConsumed: 0
        },
        responses: {
          averageTime: 0,
          medianTime: 0,
          p95Time: 0,
          p99Time: 0,
          timeoutCount: 0,
          qualityScore: 100
        },
        errors: {
          total: 0,
          rate: 0,
          byStatusCode: {},
          byErrorType: {},
          recoverable: 0,
          nonRecoverable: 0
        },
        performance: {
          throughput: 0,
          latency: 0,
          reliability: 100,
          efficiency: 100,
          overallScore: 100
        },
        availability: {
          uptime: 100,
          sla: 99.9,
          mtbf: 0,
          mttr: 0,
          plannedDowntime: 0
        }
      },
      costTracking: {
        current: {
          totalCost: 0,
          costPerRequest: 0,
          costPerToken: 0,
          costPerMinute: 0,
          currency: 'USD',
          billingPeriod: 'monthly'
        },
        historical: [],
        budget: {
          monthlyBudget: 1000,
          currentSpend: 0,
          utilization: 0,
          forecastedSpend: 0,
          alertThresholds: this.config.cost.budgetAlerts
        },
        forecasting: {
          nextMonth: 0,
          nextQuarter: 0,
          nextYear: 0,
          confidence: 0,
          factors: []
        },
        optimization: {
          recommendations: [],
          potentialSavings: 0,
          implementationEffort: 'low'
        }
      },
      qualityMetrics: {
        accuracy: 100,
        relevance: 100,
        completeness: 100,
        consistency: 100,
        responseQuality: {
          coherence: 100,
          factualAccuracy: 100,
          helpfulness: 100,
          safety: 100,
          bias: 0
        },
        userSatisfaction: 100,
        overallScore: 100
      }
    };

    this.providers.set(providerConfig.id, provider);
    await this.storeProvider(provider);

    this.logger.info('LLM provider registered', {
      providerId: providerConfig.id,
      name: providerConfig.name,
      model: providerConfig.model,
      priority: providerConfig.priority
    });

    this.emit('providerRegistered', provider);
  }

  /**
   * Record LLM request
   */
  async recordRequest(providerId: string, request: {
    requestId: string;
    startTime: number;
    endTime: number;
    tokensUsed: number;
    cost: number;
    success: boolean;
    errorType?: string;
    statusCode?: number;
    quality?: number;
  }): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    // Update request metrics
    provider.metrics.requests.total++;
    provider.metrics.requests.tokensConsumed += request.tokensUsed;

    if (request.success) {
      provider.metrics.requests.successful++;
      
      // Update response metrics
      const responseTime = request.endTime - request.startTime;
      this.updateResponseMetrics(provider, responseTime, request.quality);
      
    } else {
      provider.metrics.requests.failed++;
      
      // Update error metrics
      this.updateErrorMetrics(provider, request.errorType, request.statusCode);
    }

    // Update cost tracking
    if (this.config.cost.trackingEnabled) {
      this.updateCostMetrics(provider, request.cost, request.tokensUsed);
    }

    // Update quality metrics
    if (this.config.quality.monitoringEnabled && request.quality) {
      await this.qualityAnalyzer.recordQuality(providerId, request.quality);
    }

    // Store updated metrics
    await this.storeProvider(provider);

    // Check failover conditions
    if (this.config.failover.enabled) {
      await this.failoverManager.evaluateProvider(provider);
    }

    this.emit('requestRecorded', { providerId, request, provider });
  }

  /**
   * Perform health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.providers.values()).map(provider => 
      this.performHealthCheck(provider)
    );

    await Promise.allSettled(promises);
  }

  /**
   * Perform health check on individual provider
   */
  private async performHealthCheck(provider: LLMProvider): Promise<void> {
    const startTime = Date.now();

    try {
      // Mock health check - in reality, make actual API call
      const healthy = await this.checkProviderHealth(provider);
      const responseTime = Date.now() - startTime;

      if (healthy) {
        provider.healthStatus.status = 'healthy';
        provider.healthStatus.consecutiveFailures = 0;
        provider.healthStatus.responseTime.current = responseTime;
        
        // Update uptime
        provider.healthStatus.uptime = Math.min(100, provider.healthStatus.uptime + 0.1);
      } else {
        provider.healthStatus.consecutiveFailures++;
        
        if (provider.healthStatus.consecutiveFailures >= 3) {
          provider.healthStatus.status = 'unhealthy';
          provider.healthStatus.uptime = Math.max(0, provider.healthStatus.uptime - 1);
        } else {
          provider.healthStatus.status = 'degraded';
        }
      }

      provider.healthStatus.lastHealthCheck = Date.now();
      await this.storeProvider(provider);

      this.emit('healthCheckCompleted', { provider, healthy, responseTime });

    } catch (error) {
      provider.healthStatus.status = 'offline';
      provider.healthStatus.consecutiveFailures++;
      provider.healthStatus.lastHealthCheck = Date.now();

      this.logger.error('Health check failed', {
        providerId: provider.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      this.emit('healthCheckFailed', { provider, error });
    }
  }

  /**
   * Check provider health (mock implementation)
   */
  private async checkProviderHealth(provider: LLMProvider): Promise<boolean> {
    // Mock implementation - would make actual API call to provider
    return Math.random() > 0.1; // 90% success rate
  }

  /**
   * Collect and aggregate metrics
   */
  private async collectMetrics(): Promise<void> {
    for (const provider of this.providers.values()) {
      // Calculate performance scores
      this.calculatePerformanceScores(provider);
      
      // Update trends
      this.updateTrends(provider);
      
      // Store updated metrics
      await this.storeProvider(provider);
    }

    // Generate provider comparison metrics
    await this.generateComparisonMetrics();
  }

  /**
   * Update cost tracking for all providers
   */
  private async updateCostTracking(): Promise<void> {
    for (const provider of this.providers.values()) {
      await this.updateProviderCostTracking(provider);
    }

    // Check budget alerts
    await this.checkBudgetAlerts();

    // Generate cost optimization recommendations
    if (this.config.cost.optimizationEnabled) {
      await this.generateCostOptimizations();
    }
  }

  /**
   * Update response time metrics
   */
  private updateResponseMetrics(provider: LLMProvider, responseTime: number, quality?: number): void {
    const responses = provider.metrics.responses;
    
    // Update response time statistics (simplified)
    responses.averageTime = (responses.averageTime + responseTime) / 2;
    
    if (quality) {
      responses.qualityScore = (responses.qualityScore + quality) / 2;
    }
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(provider: LLMProvider, errorType?: string, statusCode?: number): void {
    const errors = provider.metrics.errors;
    errors.total++;

    if (errorType) {
      errors.byErrorType[errorType] = (errors.byErrorType[errorType] || 0) + 1;
    }

    if (statusCode) {
      errors.byStatusCode[statusCode.toString()] = (errors.byStatusCode[statusCode.toString()] || 0) + 1;
      
      // Classify as recoverable or non-recoverable
      if (statusCode >= 500) {
        errors.recoverable++;
      } else {
        errors.nonRecoverable++;
      }
    }

    // Update error rate
    errors.rate = errors.total / provider.metrics.requests.total;
  }

  /**
   * Update cost metrics
   */
  private updateCostMetrics(provider: LLMProvider, cost: number, tokens: number): void {
    const costMetrics = provider.costTracking.current;
    
    costMetrics.totalCost += cost;
    costMetrics.costPerRequest = costMetrics.totalCost / provider.metrics.requests.total;
    
    if (tokens > 0) {
      costMetrics.costPerToken = costMetrics.totalCost / provider.metrics.requests.tokensConsumed;
    }

    // Update budget tracking
    provider.costTracking.budget.currentSpend += cost;
    provider.costTracking.budget.utilization = 
      provider.costTracking.budget.currentSpend / provider.costTracking.budget.monthlyBudget;
  }

  /**
   * Calculate performance scores
   */
  private calculatePerformanceScores(provider: LLMProvider): void {
    const metrics = provider.metrics;
    const performance = metrics.performance;

    // Calculate individual scores (0-100)
    performance.throughput = Math.min(100, (metrics.requests.rate / 10) * 100); // Max 10 RPS = 100
    performance.latency = Math.max(0, 100 - (metrics.responses.averageTime / 50)); // 5000ms = 0 score
    performance.reliability = Math.max(0, 100 - (metrics.errors.rate * 100));
    performance.efficiency = Math.min(100, (metrics.requests.tokensConsumed / metrics.requests.total) / 10 * 100);

    // Overall performance score
    performance.overallScore = (
      performance.throughput * 0.3 +
      performance.latency * 0.3 +
      performance.reliability * 0.3 +
      performance.efficiency * 0.1
    );
  }

  /**
   * Update trend indicators
   */
  private updateTrends(provider: LLMProvider): void {
    // Simplified trend calculation
    const health = provider.healthStatus;
    
    // Response time trend
    if (health.responseTime.current > health.responseTime.average * 1.2) {
      health.responseTime.trend = 'degrading';
    } else if (health.responseTime.current < health.responseTime.average * 0.8) {
      health.responseTime.trend = 'improving';
    } else {
      health.responseTime.trend = 'stable';
    }

    // Error rate trend
    if (health.errorRates.current > health.errorRates.average * 1.5) {
      health.errorRates.trend = 'degrading';
    } else if (health.errorRates.current < health.errorRates.average * 0.5) {
      health.errorRates.trend = 'improving';
    } else {
      health.errorRates.trend = 'stable';
    }
  }

  /**
   * Update cost tracking for specific provider
   */
  private async updateProviderCostTracking(provider: LLMProvider): Promise<void> {
    const costTracking = provider.costTracking;
    
    // Add historical cost entry
    const now = Date.now();
    const hourStart = Math.floor(now / 3600000) * 3600000;
    
    costTracking.historical.push({
      timestamp: hourStart,
      cost: costTracking.current.totalCost,
      requests: provider.metrics.requests.total,
      tokens: provider.metrics.requests.tokensConsumed,
      period: 'hourly'
    });

    // Keep only last 24 hours of data
    costTracking.historical = costTracking.historical.slice(-24);

    // Update forecasting
    await this.updateCostForecasting(provider);
  }

  /**
   * Update cost forecasting
   */
  private async updateCostForecasting(provider: LLMProvider): Promise<void> {
    const historical = provider.costTracking.historical;
    if (historical.length < 3) return;

    // Simple linear regression for forecasting
    const recentCosts = historical.slice(-7).map(h => h.cost); // Last 7 hours
    const avgHourlyCost = recentCosts.reduce((sum, cost) => sum + cost, 0) / recentCosts.length;

    const forecasting = provider.costTracking.forecasting;
    forecasting.nextMonth = avgHourlyCost * 24 * 30;
    forecasting.nextQuarter = forecasting.nextMonth * 3;
    forecasting.nextYear = forecasting.nextMonth * 12;
    forecasting.confidence = Math.min(90, historical.length * 10); // More data = higher confidence
  }

  /**
   * Check budget alerts
   */
  private async checkBudgetAlerts(): Promise<void> {
    for (const provider of this.providers.values()) {
      const budget = provider.costTracking.budget;
      
      for (const threshold of budget.alertThresholds) {
        if (budget.utilization >= threshold / 100 && budget.utilization < (threshold + 5) / 100) {
          this.emit('budgetAlert', {
            providerId: provider.id,
            providerName: provider.name,
            threshold,
            currentUtilization: budget.utilization,
            currentSpend: budget.currentSpend,
            monthlyBudget: budget.monthlyBudget
          });
        }
      }
    }
  }

  /**
   * Generate cost optimizations
   */
  private async generateCostOptimizations(): Promise<void> {
    for (const provider of this.providers.values()) {
      const recommendations = await this.costOptimizer.generateRecommendations(provider);
      provider.costTracking.optimization.recommendations = recommendations;
      provider.costTracking.optimization.potentialSavings = 
        recommendations.reduce((sum, rec) => sum + rec.impact, 0);
    }
  }

  /**
   * Generate provider comparison metrics
   */
  private async generateComparisonMetrics(): Promise<void> {
    const providers = Array.from(this.providers.values());
    if (providers.length < 2) return;

    const comparison = {
      timestamp: Date.now(),
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        performanceScore: p.metrics.performance.overallScore,
        costEfficiency: p.costTracking.current.costPerToken,
        reliability: p.metrics.performance.reliability,
        responseTime: p.healthStatus.responseTime.average,
        qualityScore: p.qualityMetrics.overallScore
      })),
      recommendations: this.generateProviderRecommendations(providers)
    };

    await this.storeComparisonMetrics(comparison);
    this.emit('comparisonGenerated', comparison);
  }

  /**
   * Generate provider recommendations
   */
  private generateProviderRecommendations(providers: LLMProvider[]): string[] {
    const recommendations: string[] = [];
    
    // Find best performer
    const bestPerformer = providers.reduce((best, current) => 
      current.metrics.performance.overallScore > best.metrics.performance.overallScore ? current : best
    );
    
    // Find most cost-effective
    const mostCostEffective = providers.reduce((best, current) => 
      current.costTracking.current.costPerToken < best.costTracking.current.costPerToken ? current : best
    );

    if (bestPerformer.id !== mostCostEffective.id) {
      recommendations.push(
        `Consider ${bestPerformer.name} for performance-critical requests and ${mostCostEffective.name} for cost optimization`
      );
    }

    // Check for underperforming providers
    const avgPerformance = providers.reduce((sum, p) => sum + p.metrics.performance.overallScore, 0) / providers.length;
    const underperformers = providers.filter(p => p.metrics.performance.overallScore < avgPerformance * 0.8);
    
    if (underperformers.length > 0) {
      recommendations.push(
        `Consider reducing traffic to ${underperformers.map(p => p.name).join(', ')} due to performance issues`
      );
    }

    return recommendations;
  }

  // Storage methods
  private async storeProvider(provider: LLMProvider): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:providers:${provider.id}`;
    await this.redis.setex(key, 86400, JSON.stringify(provider)); // 24 hours retention
  }

  private async storeComparisonMetrics(comparison: any): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:comparison:${Math.floor(Date.now() / 3600000)}`;
    await this.redis.setex(key, 86400 * 7, JSON.stringify(comparison)); // 7 days retention
  }

  // Public API methods
  getProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId);
  }

  getHealthyProviders(): LLMProvider[] {
    return Array.from(this.providers.values())
      .filter(p => p.healthStatus.status === 'healthy')
      .sort((a, b) => b.priority - a.priority);
  }

  async getProviderMetrics(providerId: string): Promise<ProviderMetrics | undefined> {
    const provider = this.providers.get(providerId);
    return provider?.metrics;
  }

  async getCostSummary(): Promise<any> {
    const providers = Array.from(this.providers.values());
    
    return {
      totalCost: providers.reduce((sum, p) => sum + p.costTracking.current.totalCost, 0),
      totalRequests: providers.reduce((sum, p) => sum + p.metrics.requests.total, 0),
      totalTokens: providers.reduce((sum, p) => sum + p.metrics.requests.tokensConsumed, 0),
      averageCostPerRequest: providers.reduce((sum, p) => sum + p.costTracking.current.costPerRequest, 0) / providers.length,
      budgetUtilization: providers.reduce((sum, p) => sum + p.costTracking.budget.utilization, 0) / providers.length,
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        cost: p.costTracking.current.totalCost,
        utilization: p.costTracking.budget.utilization
      }))
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down LLM provider monitor...');

    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.costTrackingTimer) clearInterval(this.costTrackingTimer);

    await this.redis.disconnect();
    this.logger.info('LLM provider monitor shutdown complete');
  }
}

/**
 * Failover Manager
 * Handles automatic failover decisions based on provider health
 */
class FailoverManager {
  constructor(private monitor: LLMProviderMonitor) {}

  async evaluateProvider(provider: LLMProvider): Promise<void> {
    for (const rule of provider.configuration.failoverRules) {
      const shouldTrigger = await this.evaluateFailoverRule(provider, rule);
      
      if (shouldTrigger) {
        await this.executeFailoverAction(provider, rule);
      }
    }
  }

  private async evaluateFailoverRule(provider: LLMProvider, rule: FailoverRule): Promise<boolean> {
    const currentValue = this.getMetricValue(provider, rule.trigger.metric);
    
    switch (rule.trigger.operator) {
      case 'gt': return currentValue > rule.threshold;
      case 'gte': return currentValue >= rule.threshold;
      case 'lt': return currentValue < rule.threshold;
      case 'lte': return currentValue <= rule.threshold;
      default: return false;
    }
  }

  private getMetricValue(provider: LLMProvider, metric: string): number {
    switch (metric) {
      case 'response_time': return provider.healthStatus.responseTime.current;
      case 'error_rate': return provider.healthStatus.errorRates.current;
      case 'availability': return provider.healthStatus.uptime;
      case 'cost_per_token': return provider.costTracking.current.costPerToken;
      case 'quality_score': return provider.qualityMetrics.overallScore;
      default: return 0;
    }
  }

  private async executeFailoverAction(provider: LLMProvider, rule: FailoverRule): Promise<void> {
    switch (rule.action) {
      case 'failover':
        this.monitor.emit('failoverTriggered', {
          providerId: provider.id,
          rule: rule.trigger.type,
          reason: `${rule.trigger.metric} ${rule.trigger.operator} ${rule.threshold}`
        });
        break;
      
      case 'reduce_traffic':
        this.monitor.emit('reduceTraffic', {
          providerId: provider.id,
          reduction: 0.5 // Reduce by 50%
        });
        break;
      
      case 'alert_only':
        this.monitor.emit('failoverAlert', {
          providerId: provider.id,
          severity: 'warning',
          message: `Failover condition met: ${rule.trigger.metric} ${rule.trigger.operator} ${rule.threshold}`
        });
        break;
    }
  }
}

/**
 * Cost Optimizer
 * Generates cost optimization recommendations
 */
class CostOptimizer {
  constructor(private config: any) {}

  async generateRecommendations(provider: LLMProvider): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];
    const costMetrics = provider.costTracking.current;
    const performance = provider.metrics.performance;

    // High cost per request
    if (costMetrics.costPerRequest > 0.1) {
      recommendations.push({
        type: 'cost_per_request',
        description: 'Consider using more efficient prompts or switching to a more cost-effective model',
        impact: costMetrics.costPerRequest * 0.3,
        effort: 'medium',
        timeframe: '2-4 weeks'
      });
    }

    // Low efficiency with high cost
    if (performance.efficiency < 70 && costMetrics.totalCost > 100) {
      recommendations.push({
        type: 'efficiency_optimization',
        description: 'Optimize request patterns and implement better caching to improve efficiency',
        impact: costMetrics.totalCost * 0.2,
        effort: 'high',
        timeframe: '4-8 weeks'
      });
    }

    return recommendations;
  }
}

/**
 * Quality Analyzer
 * Analyzes LLM response quality
 */
class QualityAnalyzer {
  private qualityBuffer: Map<string, number[]> = new Map();

  constructor(private config: any) {}

  async recordQuality(providerId: string, qualityScore: number): Promise<void> {
    if (!this.qualityBuffer.has(providerId)) {
      this.qualityBuffer.set(providerId, []);
    }

    const scores = this.qualityBuffer.get(providerId)!;
    scores.push(qualityScore);

    // Keep only recent scores
    if (scores.length > 100) {
      scores.splice(0, scores.length - 100);
    }
  }

  async analyzeQuality(providerId: string): Promise<any> {
    const scores = this.qualityBuffer.get(providerId);
    if (!scores || scores.length === 0) return null;

    const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    
    return {
      average: avg,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      trend: this.calculateTrend(scores),
      sampleSize: scores.length
    };
  }

  private calculateTrend(scores: number[]): 'improving' | 'stable' | 'degrading' {
    if (scores.length < 10) return 'stable';

    const recent = scores.slice(-5);
    const older = scores.slice(-10, -5);

    const recentAvg = recent.reduce((sum, s) => sum + s, 0) / recent.length;
    const olderAvg = older.reduce((sum, s) => sum + s, 0) / older.length;

    if (recentAvg > olderAvg * 1.05) return 'improving';
    if (recentAvg < olderAvg * 0.95) return 'degrading';
    return 'stable';
  }
}

export default LLMProviderMonitor;