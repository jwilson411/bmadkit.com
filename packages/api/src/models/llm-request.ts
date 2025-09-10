import { z } from 'zod';

export type LLMProvider = 'openai' | 'anthropic';
export type LLMModel = 'gpt-4' | 'gpt-4-turbo' | 'claude-3-opus' | 'claude-3-sonnet' | 'claude-3-haiku';

export const LLMMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  timestamp: z.date().optional(),
});

export const LLMRequestSchema = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic']),
  model: z.string(),
  messages: z.array(LLMMessageSchema),
  maxTokens: z.number().min(1).max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stopSequences: z.array(z.string()).optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  correlationId: z.string(),
  createdAt: z.date(),
  timeout: z.number().min(1000).max(300000).optional(), // 1s to 5min
});

export const LLMResponseSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  provider: z.enum(['openai', 'anthropic']),
  model: z.string(),
  content: z.string(),
  finishReason: z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'error']),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }),
  cost: z.object({
    promptCost: z.number(),
    completionCost: z.number(),
    totalCost: z.number(),
    currency: z.string().default('USD'),
  }),
  latency: z.number(), // milliseconds
  createdAt: z.date(),
  metadata: z.record(z.any()).optional(),
});

export const LLMErrorSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  provider: z.enum(['openai', 'anthropic']),
  errorType: z.enum([
    'authentication_error',
    'rate_limit_error',
    'context_length_error',
    'content_filter_error',
    'network_error',
    'timeout_error',
    'service_unavailable',
    'quota_exceeded',
    'invalid_request',
    'unknown_error'
  ]),
  message: z.string(),
  statusCode: z.number().optional(),
  retryable: z.boolean(),
  retryAfter: z.number().optional(), // seconds
  createdAt: z.date(),
  metadata: z.record(z.any()).optional(),
});

export const ProviderHealthSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  latency: z.number(), // average latency in ms
  successRate: z.number().min(0).max(1), // 0-1
  errorRate: z.number().min(0).max(1), // 0-1
  lastError: z.string().optional(),
  lastSuccessAt: z.date().optional(),
  lastErrorAt: z.date().optional(),
  consecutiveFailures: z.number().min(0),
  circuitBreakerState: z.enum(['closed', 'open', 'half_open']),
  requestsInLastMinute: z.number().min(0),
  tokensUsedToday: z.number().min(0),
  costToday: z.number().min(0),
  updatedAt: z.date(),
});

export const LLMConfigSchema = z.object({
  providers: z.object({
    openai: z.object({
      enabled: z.boolean(),
      apiKey: z.string(),
      organization: z.string().optional(),
      baseURL: z.string().optional(),
      defaultModel: z.string().default('gpt-4'),
      maxTokens: z.number().default(2048),
      temperature: z.number().default(0.7),
      timeout: z.number().default(30000),
      retryAttempts: z.number().default(3),
      rateLimits: z.object({
        requestsPerMinute: z.number().default(60),
        tokensPerMinute: z.number().default(100000),
      }),
      pricing: z.object({
        promptTokenCost: z.number(), // per 1K tokens
        completionTokenCost: z.number(), // per 1K tokens
      }),
    }),
    anthropic: z.object({
      enabled: z.boolean(),
      apiKey: z.string(),
      baseURL: z.string().optional(),
      defaultModel: z.string().default('claude-3-sonnet-20240229'),
      maxTokens: z.number().default(2048),
      temperature: z.number().default(0.7),
      timeout: z.number().default(30000),
      retryAttempts: z.number().default(3),
      rateLimits: z.object({
        requestsPerMinute: z.number().default(60),
        tokensPerMinute: z.number().default(100000),
      }),
      pricing: z.object({
        promptTokenCost: z.number(), // per 1K tokens
        completionTokenCost: z.number(), // per 1K tokens
      }),
    }),
  }),
  gateway: z.object({
    primaryProvider: z.enum(['openai', 'anthropic']).default('openai'),
    enableFailover: z.boolean().default(true),
    healthCheckInterval: z.number().default(30000), // 30 seconds
    circuitBreakerThreshold: z.number().default(5), // failures before opening
    circuitBreakerTimeout: z.number().default(60000), // 1 minute
    maxConcurrentRequests: z.number().default(100),
    requestTimeout: z.number().default(60000), // 1 minute
    enableCaching: z.boolean().default(true),
    cacheTimeToLive: z.number().default(300000), // 5 minutes
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  }),
  monitoring: z.object({
    enableMetrics: z.boolean().default(true),
    enableTracing: z.boolean().default(true),
    alertThresholds: z.object({
      errorRatePercent: z.number().default(10),
      latencyMs: z.number().default(5000),
      costPerHour: z.number().default(100),
    }),
  }),
});

export const UsageMetricsSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  timeframe: z.enum(['hour', 'day', 'week', 'month']),
  requestCount: z.number(),
  tokenCount: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalCost: z.number(),
  averageLatency: z.number(),
  errorCount: z.number(),
  errorRate: z.number(),
  startTime: z.date(),
  endTime: z.date(),
  topModels: z.array(z.object({
    model: z.string(),
    requestCount: z.number(),
    tokenCount: z.number(),
    cost: z.number(),
  })).optional(),
});

export const CircuitBreakerStateSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  state: z.enum(['closed', 'open', 'half_open']),
  failureCount: z.number(),
  threshold: z.number(),
  timeout: z.number(),
  lastFailureAt: z.date().optional(),
  nextAttemptAt: z.date().optional(),
  successCount: z.number().optional(), // for half_open state
});

// TypeScript types derived from schemas
export type LLMMessage = z.infer<typeof LLMMessageSchema>;
export type LLMRequest = z.infer<typeof LLMRequestSchema>;
export type LLMResponse = z.infer<typeof LLMResponseSchema>;
export type LLMError = z.infer<typeof LLMErrorSchema>;
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;
export type CircuitBreakerState = z.infer<typeof CircuitBreakerStateSchema>;

// Helper functions for model mapping
export const MODEL_MAPPINGS = {
  openai: {
    'gpt-4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo-preview',
    'gpt-4-latest': 'gpt-4',
  },
  anthropic: {
    'claude-3-opus': 'claude-3-opus-20240229',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307',
  },
} as const;

// Pricing constants (per 1K tokens as of September 2024)
export const PRICING = {
  openai: {
    'gpt-4': { prompt: 0.03, completion: 0.06 },
    'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  },
  anthropic: {
    'claude-3-opus': { prompt: 0.015, completion: 0.075 },
    'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
    'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 },
  },
} as const;

// Error type categorization
export const isRetryableError = (errorType: LLMError['errorType']): boolean => {
  return [
    'rate_limit_error',
    'network_error', 
    'timeout_error',
    'service_unavailable'
  ].includes(errorType);
};

export const shouldSwitchProvider = (errorType: LLMError['errorType']): boolean => {
  return [
    'service_unavailable',
    'quota_exceeded',
    'timeout_error'
  ].includes(errorType);
};