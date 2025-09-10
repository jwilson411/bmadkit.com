import { EventEmitter } from 'events';
import Redis from 'ioredis';

/**
 * LLM API Request Queue Manager
 * Intelligent queuing and rate limiting for efficient LLM provider quota management
 */

export interface LLMProvider {
  name: string;
  endpoint: string;
  apiKey: string;
  rateLimit: RateLimit;
  costPerRequest: number;
  priority: number;
  healthStatus: 'healthy' | 'degraded' | 'down';
}

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  concurrent: number;
}

export interface LLMRequest {
  id: string;
  sessionId: string;
  userId: string;
  provider: string;
  model: string;
  prompt: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  maxTokens: number;
  temperature: number;
  metadata: Record<string, any>;
  createdAt: number;
  estimatedCost: number;
  retryCount: number;
}

export interface QueueMetrics {
  totalRequests: number;
  queuedRequests: number;
  processingRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageWaitTime: number;
  averageProcessingTime: number;
  providerHealth: Record<string, string>;
  costMetrics: CostMetrics;
}

export interface CostMetrics {
  totalCost: number;
  costPerProvider: Record<string, number>;
  costPerModel: Record<string, number>;
  projectedMonthlyCost: number;
  budgetUtilization: number;
}

export interface ProviderResponse {
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed: number;
  cost: number;
  responseTime: number;
  provider: string;
  model: string;
}

/**
 * Intelligent LLM Request Queue Manager
 * Handles provider load balancing, rate limiting, and cost optimization
 */
export class LLMQueueManager extends EventEmitter {
  private providers: Map<string, LLMProvider>;
  private queues: Map<string, LLMRequest[]>;
  private processing: Map<string, LLMRequest[]>;
  private redis: Redis;
  private metrics: QueueMetrics;
  private rateLimiters: Map<string, RateLimiter>;
  private healthCheckers: Map<string, ProviderHealthChecker>;
  private costTracker: CostTracker;
  private cacheManager: ResponseCacheManager;

  constructor(providers: LLMProvider[], redisUrl: string) {
    super();
    
    this.providers = new Map(providers.map(p => [p.name, p]));
    this.queues = new Map();
    this.processing = new Map();
    this.redis = new Redis(redisUrl);
    this.rateLimiters = new Map();
    this.healthCheckers = new Map();
    
    this.metrics = {
      totalRequests: 0,
      queuedRequests: 0,
      processingRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      averageWaitTime: 0,
      averageProcessingTime: 0,
      providerHealth: {},
      costMetrics: {
        totalCost: 0,
        costPerProvider: {},
        costPerModel: {},
        projectedMonthlyCost: 0,
        budgetUtilization: 0
      }
    };

    this.costTracker = new CostTracker();
    this.cacheManager = new ResponseCacheManager(this.redis);
    
    this.initializeComponents();
  }

  /**
   * Initialize queue manager components
   */
  private async initializeComponents(): Promise<void> {
    // Initialize priority queues for each provider
    for (const [providerName, provider] of this.providers.entries()) {
      this.queues.set(providerName, []);
      this.processing.set(providerName, []);
      
      // Initialize rate limiters
      this.rateLimiters.set(providerName, new RateLimiter(provider.rateLimit, this.redis));
      
      // Initialize health checkers
      this.healthCheckers.set(providerName, new ProviderHealthChecker(provider));
    }

    // Start background processes
    this.startQueueProcessor();
    this.startHealthMonitoring();
    this.startMetricsCollection();
    this.startCostOptimization();

    console.log(`Initialized LLM queue manager with ${this.providers.size} providers`);
  }

  /**
   * Queue an LLM request with intelligent routing
   */
  async queueRequest(request: Omit<LLMRequest, 'id' | 'createdAt' | 'estimatedCost' | 'retryCount'>): Promise<string> {
    const requestId = this.generateRequestId();
    
    // Check cache first
    const cacheKey = this.generateCacheKey(request.prompt, request.model);
    const cachedResponse = await this.cacheManager.get(cacheKey);
    
    if (cachedResponse) {
      this.emit('requestCompleted', {
        id: requestId,
        ...request,
        response: cachedResponse,
        source: 'cache'
      });
      return requestId;
    }

    // Estimate cost and select optimal provider
    const optimalProvider = await this.selectOptimalProvider(request);
    const estimatedCost = this.calculateEstimatedCost(request, optimalProvider);

    const fullRequest: LLMRequest = {
      id: requestId,
      createdAt: Date.now(),
      estimatedCost,
      retryCount: 0,
      ...request
    };

    // Add to appropriate queue
    const queue = this.queues.get(optimalProvider.name);
    if (!queue) {
      throw new Error(`Provider ${optimalProvider.name} not found`);
    }

    // Insert based on priority
    this.insertByPriority(queue, fullRequest);
    
    this.metrics.totalRequests++;
    this.metrics.queuedRequests++;

    this.emit('requestQueued', { requestId, provider: optimalProvider.name, estimatedCost });

    return requestId;
  }

  /**
   * Select optimal provider based on multiple factors
   */
  private async selectOptimalProvider(request: Omit<LLMRequest, 'id' | 'createdAt' | 'estimatedCost' | 'retryCount'>): Promise<LLMProvider> {
    const availableProviders = Array.from(this.providers.values())
      .filter(p => p.healthStatus !== 'down')
      .filter(p => this.supportsModel(p, request.model));

    if (availableProviders.length === 0) {
      throw new Error('No available providers for the requested model');
    }

    // Calculate provider scores based on multiple factors
    const providerScores = await Promise.all(
      availableProviders.map(async provider => {
        const rateLimiter = this.rateLimiters.get(provider.name)!;
        const queueLength = this.queues.get(provider.name)!.length;
        const processingCount = this.processing.get(provider.name)!.length;

        const score = await this.calculateProviderScore({
          provider,
          rateLimitCapacity: await rateLimiter.getCapacity(),
          queueLength,
          processingCount,
          request
        });

        return { provider, score };
      })
    );

    // Sort by score (higher is better)
    providerScores.sort((a, b) => b.score - a.score);

    return providerScores[0].provider;
  }

  private async calculateProviderScore(params: {
    provider: LLMProvider;
    rateLimitCapacity: number;
    queueLength: number;
    processingCount: number;
    request: any;
  }): Promise<number> {
    const { provider, rateLimitCapacity, queueLength, processingCount, request } = params;

    let score = 100;

    // Health status weight
    const healthWeight = provider.healthStatus === 'healthy' ? 1 : 
                        provider.healthStatus === 'degraded' ? 0.7 : 0;
    score *= healthWeight;

    // Rate limit capacity weight (0-1)
    const rateLimitWeight = Math.min(rateLimitCapacity / 100, 1);
    score *= rateLimitWeight;

    // Queue length weight (inverse relationship)
    const queueWeight = Math.max(0, 1 - (queueLength / 100));
    score *= queueWeight;

    // Processing capacity weight
    const processingWeight = Math.max(0, 1 - (processingCount / provider.rateLimit.concurrent));
    score *= processingWeight;

    // Cost efficiency weight
    const costWeight = 1 / (provider.costPerRequest + 0.001);
    score *= Math.min(costWeight, 10);

    // Priority bonus
    score *= provider.priority;

    return score;
  }

  /**
   * Start the main queue processor
   */
  private startQueueProcessor(): void {
    setInterval(async () => {
      await this.processQueues();
    }, 1000); // Process every second
  }

  private async processQueues(): Promise<void> {
    for (const [providerName, provider] of this.providers.entries()) {
      if (provider.healthStatus === 'down') {
        continue;
      }

      const queue = this.queues.get(providerName)!;
      const processing = this.processing.get(providerName)!;
      const rateLimiter = this.rateLimiters.get(providerName)!;

      // Check if we can process more requests
      if (queue.length === 0 || processing.length >= provider.rateLimit.concurrent) {
        continue;
      }

      // Check rate limits
      const canProcess = await rateLimiter.checkLimit();
      if (!canProcess) {
        continue;
      }

      // Get next request from queue
      const request = queue.shift()!;
      processing.push(request);

      this.metrics.queuedRequests--;
      this.metrics.processingRequests++;

      // Process request asynchronously
      this.processRequest(request, provider)
        .catch(error => this.handleRequestError(request, provider, error));
    }
  }

  private async processRequest(request: LLMRequest, provider: LLMProvider): Promise<void> {
    const startTime = Date.now();

    try {
      // Make API request to provider
      const response = await this.makeProviderRequest(request, provider);

      if (response.success) {
        // Cache successful response
        const cacheKey = this.generateCacheKey(request.prompt, request.model);
        await this.cacheManager.set(cacheKey, response.data, 3600); // Cache for 1 hour

        // Update cost tracking
        this.costTracker.recordCost(provider.name, request.model, response.cost);

        // Update metrics
        this.updateSuccessMetrics(request, response, startTime);

        this.emit('requestCompleted', { request, response });
      } else {
        throw new Error(response.error || 'Provider request failed');
      }
    } catch (error) {
      await this.handleRequestError(request, provider, error);
    } finally {
      // Remove from processing queue
      const processing = this.processing.get(provider.name)!;
      const index = processing.findIndex(r => r.id === request.id);
      if (index >= 0) {
        processing.splice(index, 1);
        this.metrics.processingRequests--;
      }
    }
  }

  private async makeProviderRequest(request: LLMRequest, provider: LLMProvider): Promise<ProviderResponse> {
    const startTime = Date.now();

    try {
      // Simulate provider API call - in real implementation, use actual provider SDKs
      const response = await this.callProviderAPI(request, provider);
      
      const responseTime = Date.now() - startTime;
      const tokensUsed = this.estimateTokensUsed(response);
      const cost = this.calculateActualCost(provider, request.model, tokensUsed);

      return {
        success: true,
        data: response,
        tokensUsed,
        cost,
        responseTime,
        provider: provider.name,
        model: request.model
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        tokensUsed: 0,
        cost: 0,
        responseTime: Date.now() - startTime,
        provider: provider.name,
        model: request.model
      };
    }
  }

  private async callProviderAPI(request: LLMRequest, provider: LLMProvider): Promise<any> {
    // Mock implementation - replace with actual provider API calls
    await this.sleep(100 + Math.random() * 500); // Simulate API latency

    // Simulate occasional failures (5% failure rate)
    if (Math.random() < 0.05) {
      throw new Error('Provider API error');
    }

    return {
      id: `response_${request.id}`,
      choices: [
        {
          message: {
            role: 'assistant',
            content: `LLM response for: ${request.prompt.substring(0, 50)}...`
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: Math.floor(request.prompt.length / 4),
        completion_tokens: Math.floor(Math.random() * 500) + 50,
        total_tokens: 0
      }
    };
  }

  private async handleRequestError(request: LLMRequest, provider: LLMProvider, error: any): Promise<void> {
    console.error(`Request ${request.id} failed on provider ${provider.name}:`, error);

    request.retryCount++;

    // Retry logic
    if (request.retryCount < 3) {
      // Try different provider or re-queue
      const alternativeProvider = await this.findAlternativeProvider(request, provider.name);
      
      if (alternativeProvider) {
        const queue = this.queues.get(alternativeProvider.name)!;
        this.insertByPriority(queue, request);
        this.metrics.queuedRequests++;
      } else {
        // Re-queue with exponential backoff
        setTimeout(() => {
          const queue = this.queues.get(provider.name)!;
          queue.unshift(request); // Add to front with lower priority
          this.metrics.queuedRequests++;
        }, Math.pow(2, request.retryCount) * 1000);
      }
    } else {
      // Max retries exceeded
      this.metrics.failedRequests++;
      this.emit('requestFailed', { request, error: error.message });
    }
  }

  private async findAlternativeProvider(request: LLMRequest, excludeProvider: string): Promise<LLMProvider | null> {
    const alternatives = Array.from(this.providers.values())
      .filter(p => p.name !== excludeProvider)
      .filter(p => p.healthStatus !== 'down')
      .filter(p => this.supportsModel(p, request.model));

    if (alternatives.length === 0) {
      return null;
    }

    // Return the provider with the highest priority and best health
    alternatives.sort((a, b) => {
      if (a.healthStatus !== b.healthStatus) {
        return a.healthStatus === 'healthy' ? -1 : 1;
      }
      return b.priority - a.priority;
    });

    return alternatives[0];
  }

  /**
   * Start health monitoring for all providers
   */
  private startHealthMonitoring(): void {
    setInterval(async () => {
      for (const [providerName, healthChecker] of this.healthCheckers.entries()) {
        try {
          const health = await healthChecker.checkHealth();
          const provider = this.providers.get(providerName)!;
          provider.healthStatus = health;
          this.metrics.providerHealth[providerName] = health;
        } catch (error) {
          console.error(`Health check failed for provider ${providerName}:`, error);
          const provider = this.providers.get(providerName)!;
          provider.healthStatus = 'down';
          this.metrics.providerHealth[providerName] = 'down';
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Start metrics collection and reporting
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.updateAggregateMetrics();
      this.emit('metricsUpdated', this.metrics);
    }, 10000); // Update every 10 seconds
  }

  private updateAggregateMetrics(): void {
    // Calculate queue lengths
    let totalQueued = 0;
    let totalProcessing = 0;

    for (const queue of this.queues.values()) {
      totalQueued += queue.length;
    }

    for (const processing of this.processing.values()) {
      totalProcessing += processing.length;
    }

    this.metrics.queuedRequests = totalQueued;
    this.metrics.processingRequests = totalProcessing;

    // Update cost metrics
    this.metrics.costMetrics = this.costTracker.getMetrics();
  }

  /**
   * Start cost optimization processes
   */
  private startCostOptimization(): void {
    setInterval(() => {
      this.optimizeCosts();
    }, 300000); // Optimize every 5 minutes
  }

  private optimizeCosts(): void {
    const costMetrics = this.costTracker.getMetrics();
    
    // Check if costs are approaching budget limits
    if (costMetrics.budgetUtilization > 0.8) {
      this.emit('costAlert', {
        level: 'warning',
        message: 'Cost budget utilization above 80%',
        metrics: costMetrics
      });
      
      // Implement cost-saving measures
      this.implementCostSavingMeasures();
    }

    // Analyze provider cost efficiency
    this.analyzeProviderCostEfficiency();
  }

  private implementCostSavingMeasures(): void {
    console.log('Implementing cost-saving measures...');
    
    // Increase cache TTL to reduce API calls
    this.cacheManager.increaseTTL(1.5);
    
    // Prioritize cheaper providers for low-priority requests
    this.adjustProviderPriorities();
  }

  private adjustProviderPriorities(): void {
    const costMetrics = this.costTracker.getMetrics();
    
    for (const [providerName, provider] of this.providers.entries()) {
      const providerCost = costMetrics.costPerProvider[providerName] || 0;
      const avgCost = costMetrics.totalCost / this.providers.size;
      
      if (providerCost > avgCost * 1.5) {
        // Reduce priority for expensive providers
        provider.priority = Math.max(provider.priority * 0.8, 0.1);
      }
    }
  }

  private analyzeProviderCostEfficiency(): void {
    // Analyze and emit recommendations for cost optimization
    const analysis = this.costTracker.analyzeEfficiency();
    this.emit('costAnalysis', analysis);
  }

  // Utility methods
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCacheKey(prompt: string, model: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(`${prompt}:${model}`).digest('hex');
  }

  private insertByPriority(queue: LLMRequest[], request: LLMRequest): void {
    const priorities = { critical: 4, high: 3, medium: 2, low: 1 };
    const requestPriority = priorities[request.priority];
    
    let insertIndex = 0;
    while (insertIndex < queue.length && priorities[queue[insertIndex].priority] >= requestPriority) {
      insertIndex++;
    }
    
    queue.splice(insertIndex, 0, request);
  }

  private supportsModel(provider: LLMProvider, model: string): boolean {
    // Mock implementation - in reality, check provider's supported models
    return true;
  }

  private calculateEstimatedCost(request: any, provider: LLMProvider): number {
    const estimatedTokens = Math.floor(request.prompt.length / 4) + request.maxTokens;
    return estimatedTokens * provider.costPerRequest;
  }

  private calculateActualCost(provider: LLMProvider, model: string, tokensUsed: number): number {
    return tokensUsed * provider.costPerRequest;
  }

  private estimateTokensUsed(response: any): number {
    return response.usage?.total_tokens || 100;
  }

  private updateSuccessMetrics(request: LLMRequest, response: ProviderResponse, startTime: number): void {
    const processingTime = Date.now() - startTime;
    const waitTime = startTime - request.createdAt;

    this.metrics.completedRequests++;
    this.metrics.averageProcessingTime = this.updateAverage(
      this.metrics.averageProcessingTime,
      processingTime,
      this.metrics.completedRequests
    );
    this.metrics.averageWaitTime = this.updateAverage(
      this.metrics.averageWaitTime,
      waitTime,
      this.metrics.completedRequests
    );
  }

  private updateAverage(currentAvg: number, newValue: number, count: number): number {
    return (currentAvg * (count - 1) + newValue) / count;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API methods
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  getQueueStatus(provider?: string): any {
    if (provider) {
      return {
        provider,
        queued: this.queues.get(provider)?.length || 0,
        processing: this.processing.get(provider)?.length || 0,
        health: this.providers.get(provider)?.healthStatus
      };
    }

    const status: any = {};
    for (const [name, provider] of this.providers.entries()) {
      status[name] = {
        queued: this.queues.get(name)?.length || 0,
        processing: this.processing.get(name)?.length || 0,
        health: provider.healthStatus
      };
    }
    return status;
  }

  async pauseProvider(providerName: string): Promise<void> {
    const provider = this.providers.get(providerName);
    if (provider) {
      provider.healthStatus = 'down';
    }
  }

  async resumeProvider(providerName: string): Promise<void> {
    const provider = this.providers.get(providerName);
    if (provider) {
      provider.healthStatus = 'healthy';
    }
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down LLM queue manager...');
    await this.redis.disconnect();
  }
}

/**
 * Rate Limiter for provider API limits
 */
class RateLimiter {
  private redis: Redis;
  private limits: RateLimit;
  private keyPrefix: string;

  constructor(limits: RateLimit, redis: Redis) {
    this.limits = limits;
    this.redis = redis;
    this.keyPrefix = 'rate_limit';
  }

  async checkLimit(): Promise<boolean> {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const hour = Math.floor(now / 3600000);
    const day = Math.floor(now / 86400000);

    const keys = [
      `${this.keyPrefix}:minute:${minute}`,
      `${this.keyPrefix}:hour:${hour}`,
      `${this.keyPrefix}:day:${day}`
    ];

    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    
    const results = await pipeline.exec();
    const counts = results?.map(r => parseInt(r[1] as string) || 0) || [0, 0, 0];

    return counts[0] < this.limits.requestsPerMinute &&
           counts[1] < this.limits.requestsPerHour &&
           counts[2] < this.limits.requestsPerDay;
  }

  async recordRequest(): Promise<void> {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const hour = Math.floor(now / 3600000);
    const day = Math.floor(now / 86400000);

    const pipeline = this.redis.pipeline();
    pipeline.incr(`${this.keyPrefix}:minute:${minute}`);
    pipeline.expire(`${this.keyPrefix}:minute:${minute}`, 60);
    pipeline.incr(`${this.keyPrefix}:hour:${hour}`);
    pipeline.expire(`${this.keyPrefix}:hour:${hour}`, 3600);
    pipeline.incr(`${this.keyPrefix}:day:${day}`);
    pipeline.expire(`${this.keyPrefix}:day:${day}`, 86400);
    
    await pipeline.exec();
  }

  async getCapacity(): Promise<number> {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    
    const count = await this.redis.get(`${this.keyPrefix}:minute:${minute}`);
    const currentCount = parseInt(count || '0');
    
    return Math.max(0, this.limits.requestsPerMinute - currentCount);
  }
}

/**
 * Provider Health Checker
 */
class ProviderHealthChecker {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async checkHealth(): Promise<'healthy' | 'degraded' | 'down'> {
    try {
      // Mock health check - in reality, make actual API calls
      await this.makeHealthCheckRequest();
      return 'healthy';
    } catch (error) {
      console.error(`Health check failed for ${this.provider.name}:`, error);
      return 'down';
    }
  }

  private async makeHealthCheckRequest(): Promise<void> {
    // Mock implementation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (Math.random() < 0.05) { // 5% failure rate
      throw new Error('Health check failed');
    }
  }
}

/**
 * Cost Tracking and Analysis
 */
class CostTracker {
  private costs: Map<string, number> = new Map();
  private monthlyCosts: Map<string, number> = new Map();

  recordCost(provider: string, model: string, cost: number): void {
    const providerKey = `provider:${provider}`;
    const modelKey = `model:${model}`;
    
    this.costs.set(providerKey, (this.costs.get(providerKey) || 0) + cost);
    this.costs.set(modelKey, (this.costs.get(modelKey) || 0) + cost);
    
    // Track monthly costs
    const monthKey = new Date().toISOString().slice(0, 7);
    this.monthlyCosts.set(monthKey, (this.monthlyCosts.get(monthKey) || 0) + cost);
  }

  getMetrics(): CostMetrics {
    const totalCost = Array.from(this.costs.values()).reduce((sum, cost) => sum + cost, 0);
    
    const costPerProvider: Record<string, number> = {};
    const costPerModel: Record<string, number> = {};
    
    for (const [key, cost] of this.costs.entries()) {
      if (key.startsWith('provider:')) {
        costPerProvider[key.replace('provider:', '')] = cost;
      } else if (key.startsWith('model:')) {
        costPerModel[key.replace('model:', '')] = cost;
      }
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthlyCost = this.monthlyCosts.get(currentMonth) || 0;
    
    return {
      totalCost,
      costPerProvider,
      costPerModel,
      projectedMonthlyCost: monthlyCost * (30 / new Date().getDate()),
      budgetUtilization: monthlyCost / 1000 // Assuming $1000 monthly budget
    };
  }

  analyzeEfficiency(): any {
    return {
      recommendations: [
        'Consider using cheaper providers for low-priority requests',
        'Implement more aggressive caching for repeated queries',
        'Optimize prompt engineering to reduce token usage'
      ],
      trends: {
        costGrowth: 0.15, // 15% growth
        efficiency: 0.85 // 85% efficiency
      }
    };
  }
}

/**
 * Response Cache Manager
 */
class ResponseCacheManager {
  private redis: Redis;
  private defaultTTL: number = 3600;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async get(key: string): Promise<any> {
    const cached = await this.redis.get(`cache:${key}`);
    return cached ? JSON.parse(cached) : null;
  }

  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    await this.redis.setex(`cache:${key}`, ttl, JSON.stringify(value));
  }

  increaseTTL(multiplier: number): void {
    this.defaultTTL = Math.floor(this.defaultTTL * multiplier);
  }
}

export default LLMQueueManager;