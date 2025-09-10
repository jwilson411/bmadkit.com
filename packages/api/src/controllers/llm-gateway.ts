import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.ts';
import { LLMGateway, createLLMGateway } from '../services/llm-gateway.ts';
import { llmRequestLogger } from '../services/llm-request-logger.ts';
import { LLMMessage, LLMProvider, LLMMessageSchema } from '../models/llm-request.ts';

// Request validation schemas
export const CompletionRequestSchema = z.object({
  messages: z.array(LLMMessageSchema),
  model: z.string().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  maxTokens: z.number().min(1).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stopSequences: z.array(z.string()).optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  stream: z.boolean().default(false),
});

export const HealthCheckRequestSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
});

export const MetricsRequestSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
  period: z.enum(['hour', 'day', 'week']).default('day'),
  startTime: z.string().datetime().optional(),
});

export const LogsRequestSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  correlationId: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;
export type HealthCheckRequest = z.infer<typeof HealthCheckRequestSchema>;
export type MetricsRequest = z.infer<typeof MetricsRequestSchema>;
export type LogsRequest = z.infer<typeof LogsRequestSchema>;

export class LLMGatewayController {
  private gateway: LLMGateway | null = null;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // Initialize gateway on first request
  }

  /**
   * POST /api/v1/llm/chat/completions
   * Send completion request to LLM providers
   */
  async completions(req: Request, res: Response): Promise<void> {
    const requestId = `llm_req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Validate request
      const validatedRequest = CompletionRequestSchema.parse(req.body);
      
      logger.info('LLM completion request received', {
        requestId,
        messageCount: validatedRequest.messages.length,
        model: validatedRequest.model,
        provider: validatedRequest.provider,
        userId: validatedRequest.userId,
        sessionId: validatedRequest.sessionId
      });

      // Ensure gateway is initialized
      await this.ensureGatewayInitialized();

      // Send completion request
      const response = await this.gateway!.complete(validatedRequest.messages, {
        model: validatedRequest.model,
        provider: validatedRequest.provider,
        maxTokens: validatedRequest.maxTokens,
        temperature: validatedRequest.temperature,
        topP: validatedRequest.topP,
        frequencyPenalty: validatedRequest.frequencyPenalty,
        presencePenalty: validatedRequest.presencePenalty,
        stopSequences: validatedRequest.stopSequences,
        userId: validatedRequest.userId,
        sessionId: validatedRequest.sessionId,
        correlationId: requestId,
      });

      // Log response
      llmRequestLogger.logResponse(response);

      logger.info('LLM completion successful', {
        requestId,
        responseId: response.id,
        provider: response.provider,
        model: response.model,
        latency: response.latency,
        totalTokens: response.usage.totalTokens,
        cost: response.cost.totalCost
      });

      res.status(200).json({
        success: true,
        data: {
          id: response.id,
          object: 'chat.completion',
          created: Math.floor(response.createdAt.getTime() / 1000),
          model: response.model,
          provider: response.provider,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: response.content,
            },
            finish_reason: response.finishReason,
          }],
          usage: response.usage,
          cost: response.cost,
          latency: response.latency,
          metadata: {
            requestId,
            correlationId: requestId,
            ...response.metadata
          }
        }
      });

    } catch (error) {
      logger.error('LLM completion failed', {
        requestId,
        error: (error as Error).message,
        stack: (error as Error).stack
      });

      // Log error if it's an LLM error
      if (error && typeof error === 'object' && 'errorType' in error) {
        llmRequestLogger.logError(error as any);
      }

      const statusCode = this.getErrorStatusCode(error as Error);
      
      res.status(statusCode).json({
        success: false,
        error: {
          message: (error as Error).message,
          type: error.constructor.name,
          requestId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * GET /api/v1/llm/health
   * Get health status of all LLM providers
   */
  async health(req: Request, res: Response): Promise<void> {
    try {
      const { provider } = HealthCheckRequestSchema.parse(req.query);

      await this.ensureGatewayInitialized();

      if (provider) {
        // Check specific provider health
        const healthStatus = await this.gateway!.checkProviderHealth(provider);
        
        res.status(200).json({
          success: true,
          data: {
            provider,
            ...healthStatus,
            timestamp: new Date()
          }
        });
      } else {
        // Check all providers health
        const allHealthStatus = this.gateway!.getHealthStatus();
        const gatewayStats = this.gateway!.getGatewayStats();
        
        const overallHealth = this.calculateOverallHealth(allHealthStatus);
        
        res.status(overallHealth === 'unhealthy' ? 503 : 200).json({
          success: true,
          data: {
            overall: overallHealth,
            providers: Object.fromEntries(allHealthStatus),
            gateway: gatewayStats,
            timestamp: new Date()
          }
        });
      }

    } catch (error) {
      logger.error('Health check failed', {
        error: (error as Error).message
      });

      res.status(503).json({
        success: false,
        error: {
          message: 'Health check failed',
          details: (error as Error).message,
          timestamp: new Date()
        }
      });
    }
  }

  /**
   * GET /api/v1/llm/metrics
   * Get usage metrics and performance data
   */
  async metrics(req: Request, res: Response): Promise<void> {
    try {
      const { provider, period, startTime } = MetricsRequestSchema.parse(req.query);

      await this.ensureGatewayInitialized();

      const gatewayStats = this.gateway!.getGatewayStats();
      const usageMetrics = this.gateway!.getUsageMetrics();
      const healthStatus = this.gateway!.getHealthStatus();

      let performanceMetrics = null;
      if (provider) {
        const start = startTime ? new Date(startTime) : undefined;
        performanceMetrics = llmRequestLogger.getPerformanceMetrics(provider, period, start);
      }

      res.status(200).json({
        success: true,
        data: {
          gateway: gatewayStats,
          usage: Object.fromEntries(usageMetrics),
          health: Object.fromEntries(healthStatus),
          performance: performanceMetrics,
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Metrics retrieval failed', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to retrieve metrics',
          details: (error as Error).message,
          timestamp: new Date()
        }
      });
    }
  }

  /**
   * GET /api/v1/llm/logs
   * Retrieve request/response logs
   */
  async logs(req: Request, res: Response): Promise<void> {
    try {
      // Check admin permissions
      if ((req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: {
            message: 'Admin access required to view logs',
            code: 'FORBIDDEN'
          }
        });
        return;
      }

      const { provider, startTime, endTime, correlationId, format } = LogsRequestSchema.parse(req.query);

      if (correlationId) {
        // Search by correlation ID
        const logs = llmRequestLogger.searchByCorrelationId(correlationId);
        
        res.status(200).json({
          success: true,
          data: logs
        });
        return;
      }

      const start = new Date(startTime);
      const end = new Date(endTime);

      if (format === 'csv') {
        // Export as CSV
        const csvData = llmRequestLogger.exportLogs('csv', start, end, provider);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="llm-logs.csv"');
        res.send(csvData);
        return;
      }

      // Return JSON logs
      const requestLogs = llmRequestLogger.getRequestLogs(start, end, provider);
      const responseLogs = llmRequestLogger.getResponseLogs(start, end, provider);
      const errorLogs = llmRequestLogger.getErrorLogs(start, end, provider);

      res.status(200).json({
        success: true,
        data: {
          requests: requestLogs,
          responses: responseLogs,
          errors: errorLogs,
          summary: {
            totalRequests: requestLogs.length,
            totalResponses: responseLogs.length,
            totalErrors: errorLogs.length,
            period: { start, end }
          }
        }
      });

    } catch (error) {
      logger.error('Log retrieval failed', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to retrieve logs',
          details: (error as Error).message
        }
      });
    }
  }

  /**
   * POST /api/v1/llm/cache/clear
   * Clear response cache (admin only)
   */
  async clearCache(req: Request, res: Response): Promise<void> {
    try {
      // Check admin permissions
      if ((req as any).user?.role !== 'admin') {
        res.status(403).json({
          success: false,
          error: {
            message: 'Admin access required to clear cache',
            code: 'FORBIDDEN'
          }
        });
        return;
      }

      await this.ensureGatewayInitialized();

      this.gateway!.clearCache();

      logger.info('LLM Gateway cache cleared by admin', {
        userId: (req as any).user?.id
      });

      res.status(200).json({
        success: true,
        message: 'Cache cleared successfully',
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Cache clear failed', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to clear cache',
          details: (error as Error).message
        }
      });
    }
  }

  /**
   * GET /api/v1/llm/models
   * List available models for each provider
   */
  async models(req: Request, res: Response): Promise<void> {
    try {
      await this.ensureGatewayInitialized();

      // For now, return static model lists
      // In a full implementation, you'd query each provider's API
      const models = {
        openai: [
          { id: 'gpt-4', name: 'GPT-4', maxTokens: 8192, contextWindow: 8192 },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', maxTokens: 4096, contextWindow: 128000 },
        ],
        anthropic: [
          { id: 'claude-3-opus', name: 'Claude 3 Opus', maxTokens: 4096, contextWindow: 200000 },
          { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', maxTokens: 4096, contextWindow: 200000 },
          { id: 'claude-3-haiku', name: 'Claude 3 Haiku', maxTokens: 4096, contextWindow: 200000 },
        ]
      };

      res.status(200).json({
        success: true,
        data: models
      });

    } catch (error) {
      logger.error('Models listing failed', {
        error: (error as Error).message
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Failed to list models',
          details: (error as Error).message
        }
      });
    }
  }

  // Private methods

  private async ensureGatewayInitialized(): Promise<void> {
    if (this.gateway) return;

    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    this.initializationPromise = this.initializeGateway();
    await this.initializationPromise;
  }

  private async initializeGateway(): Promise<void> {
    try {
      // Load configuration from environment variables
      const config = {
        providers: {
          openai: {
            enabled: !!process.env.OPENAI_API_KEY,
            apiKey: process.env.OPENAI_API_KEY || '',
            organization: process.env.OPENAI_ORGANIZATION,
            defaultModel: 'gpt-4',
            maxTokens: 2048,
            temperature: 0.7,
            timeout: 30000,
            retryAttempts: 3,
            rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100000 },
            pricing: { promptTokenCost: 0.03, completionTokenCost: 0.06 }
          },
          anthropic: {
            enabled: !!process.env.ANTHROPIC_API_KEY,
            apiKey: process.env.ANTHROPIC_API_KEY || '',
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
          primaryProvider: (process.env.PRIMARY_LLM_PROVIDER as LLMProvider) || 'openai',
          enableFailover: process.env.ENABLE_LLM_FAILOVER !== 'false',
          healthCheckInterval: 30000,
          circuitBreakerThreshold: 5,
          circuitBreakerTimeout: 60000,
          maxConcurrentRequests: 100,
          requestTimeout: 60000,
          enableCaching: process.env.ENABLE_LLM_CACHING !== 'false',
          cacheTimeToLive: 300000,
          logLevel: 'info' as const
        },
        monitoring: {
          enableMetrics: true,
          enableTracing: true,
          alertThresholds: {
            errorRatePercent: 10,
            latencyMs: 5000,
            costPerHour: 100
          }
        }
      };

      this.gateway = createLLMGateway(config);
      await this.gateway.initialize();

      logger.info('LLM Gateway Controller initialized', {
        enabledProviders: Object.keys(config.providers).filter(p => config.providers[p as LLMProvider].enabled),
        primaryProvider: config.gateway.primaryProvider,
        enableFailover: config.gateway.enableFailover
      });

    } catch (error) {
      logger.error('Failed to initialize LLM Gateway', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  private calculateOverallHealth(healthStatus: Map<LLMProvider, any>): 'healthy' | 'degraded' | 'unhealthy' {
    const statuses = Array.from(healthStatus.values()).map(h => h.status);
    
    if (statuses.every(s => s === 'healthy')) return 'healthy';
    if (statuses.some(s => s === 'healthy' || s === 'degraded')) return 'degraded';
    return 'unhealthy';
  }

  private getErrorStatusCode(error: Error): number {
    if (error.message.includes('rate limit')) return 429;
    if (error.message.includes('authentication')) return 401;
    if (error.message.includes('forbidden')) return 403;
    if (error.message.includes('not found')) return 404;
    if (error.message.includes('validation')) return 400;
    if (error.message.includes('timeout')) return 408;
    return 500;
  }
}

// Export singleton controller
export const llmGatewayController = new LLMGatewayController();