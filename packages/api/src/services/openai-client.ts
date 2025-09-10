import OpenAI from 'openai';
import { logger } from '../utils/logger.ts';
import { circuitBreakerRegistry } from '../utils/circuit-breaker.ts';
import { retryLLMOperation } from '../utils/retry-logic.ts';
import { 
  LLMRequest, 
  LLMResponse, 
  LLMError, 
  LLMMessage,
  MODEL_MAPPINGS,
  PRICING 
} from '../models/llm-request.ts';

export interface OpenAIClientConfig {
  apiKey: string;
  organization?: string;
  baseURL?: string;
  timeout?: number;
  retryAttempts?: number;
  enableCircuitBreaker?: boolean;
}

export class OpenAIClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorType?: LLMError['errorType'],
    public retryable: boolean = false,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'OpenAIClientError';
  }
}

export class OpenAIClient {
  private client: OpenAI;
  private config: OpenAIClientConfig;
  private circuitBreaker;

  constructor(config: OpenAIClientConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      enableCircuitBreaker: true,
      ...config
    };

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      organization: this.config.organization,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
    });

    // Initialize circuit breaker
    if (this.config.enableCircuitBreaker) {
      this.circuitBreaker = circuitBreakerRegistry.getOrCreate('openai', {
        failureThreshold: 5,
        timeout: 60000,
        volumeThreshold: 10,
        errorThresholdPercentage: 50
      });
    }

    logger.info('OpenAI client initialized', {
      hasOrganization: !!this.config.organization,
      timeout: this.config.timeout,
      circuitBreakerEnabled: this.config.enableCircuitBreaker
    });
  }

  /**
   * Send completion request to OpenAI
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    
    logger.debug('OpenAI completion request', {
      requestId: request.id,
      model: request.model,
      messageCount: request.messages.length,
      maxTokens: request.maxTokens
    });

    const operation = async (): Promise<LLMResponse> => {
      try {
        // Map to OpenAI format
        const openAIMessages = this.formatMessagesForOpenAI(request.messages);
        const openAIModel = this.mapModelName(request.model);

        const completion = await this.client.chat.completions.create({
          model: openAIModel,
          messages: openAIMessages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          top_p: request.topP,
          frequency_penalty: request.frequencyPenalty,
          presence_penalty: request.presencePenalty,
          stop: request.stopSequences,
          user: request.userId,
        });

        const response = this.formatOpenAIResponse(completion, request, startTime);
        
        logger.info('OpenAI completion successful', {
          requestId: request.id,
          model: openAIModel,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          latency: response.latency,
          cost: response.cost.totalCost
        });

        return response;

      } catch (error) {
        const latency = Date.now() - startTime;
        const llmError = this.handleOpenAIError(error as Error, request, latency);
        
        logger.error('OpenAI completion failed', {
          requestId: request.id,
          error: llmError.message,
          errorType: llmError.errorType,
          statusCode: llmError.statusCode,
          latency,
          retryable: llmError.retryable
        });

        throw llmError;
      }
    };

    // Execute with circuit breaker and retry logic
    if (this.circuitBreaker) {
      return await retryLLMOperation(
        () => this.circuitBreaker.execute(operation),
        'openai',
        'completion'
      );
    } else {
      return await retryLLMOperation(operation, 'openai', 'completion');
    }
  }

  /**
   * Test connection to OpenAI API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      logger.info('OpenAI connection test successful');
      return true;
    } catch (error) {
      logger.error('OpenAI connection test failed', {
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      const modelIds = models.data
        .filter(model => model.id.includes('gpt'))
        .map(model => model.id)
        .sort();

      logger.debug('Retrieved OpenAI models', { count: modelIds.length });
      return modelIds;

    } catch (error) {
      logger.error('Failed to retrieve OpenAI models', {
        error: (error as Error).message
      });
      throw this.handleOpenAIError(error as Error);
    }
  }

  /**
   * Get token count for text using OpenAI's tiktoken
   */
  async getTokenCount(text: string, model: string = 'gpt-4'): Promise<number> {
    try {
      // For now, use a rough estimation
      // In production, you'd want to use tiktoken library
      const roughTokenCount = Math.ceil(text.length / 4);
      
      logger.debug('Estimated token count', {
        textLength: text.length,
        estimatedTokens: roughTokenCount,
        model
      });

      return roughTokenCount;
    } catch (error) {
      logger.warn('Token counting failed, using fallback', {
        error: (error as Error).message,
        textLength: text.length
      });
      return Math.ceil(text.length / 4);
    }
  }

  // Private methods

  private formatMessagesForOpenAI(messages: LLMMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }));
  }

  private formatOpenAIResponse(
    completion: OpenAI.Chat.ChatCompletion,
    request: LLMRequest,
    startTime: number
  ): LLMResponse {
    const choice = completion.choices[0];
    const usage = completion.usage!;
    const latency = Date.now() - startTime;

    // Calculate costs
    const modelPricing = PRICING.openai[request.model as keyof typeof PRICING.openai] 
      || PRICING.openai['gpt-4'];

    const promptCost = (usage.prompt_tokens / 1000) * modelPricing.prompt;
    const completionCost = (usage.completion_tokens / 1000) * modelPricing.completion;

    return {
      id: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: request.id,
      provider: 'openai',
      model: request.model,
      content: choice.message.content || '',
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      latency,
      createdAt: new Date(),
      metadata: {
        openaiId: completion.id,
        model: completion.model,
        systemFingerprint: completion.system_fingerprint,
      },
    };
  }

  private mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      case 'tool_calls':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  private mapModelName(model: string): string {
    return MODEL_MAPPINGS.openai[model as keyof typeof MODEL_MAPPINGS.openai] || model;
  }

  private handleOpenAIError(error: Error, request?: LLMRequest, latency?: number): LLMError {
    const baseError: Partial<LLMError> = {
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: request?.id || 'unknown',
      provider: 'openai',
      createdAt: new Date(),
      metadata: { originalError: error.message, latency }
    };

    // Handle OpenAI specific errors
    if (error instanceof OpenAI.APIError) {
      const apiError = error as OpenAI.APIError;
      
      switch (apiError.status) {
        case 400:
          return {
            ...baseError,
            errorType: 'invalid_request',
            message: `Invalid request: ${apiError.message}`,
            statusCode: 400,
            retryable: false,
          } as LLMError;

        case 401:
          return {
            ...baseError,
            errorType: 'authentication_error',
            message: 'Invalid API key or authentication failed',
            statusCode: 401,
            retryable: false,
          } as LLMError;

        case 403:
          return {
            ...baseError,
            errorType: 'authentication_error',
            message: 'Access forbidden - check permissions',
            statusCode: 403,
            retryable: false,
          } as LLMError;

        case 429:
          const retryAfter = this.parseRetryAfter(apiError.headers?.['retry-after']);
          return {
            ...baseError,
            errorType: apiError.message.includes('quota') ? 'quota_exceeded' : 'rate_limit_error',
            message: `Rate limited: ${apiError.message}`,
            statusCode: 429,
            retryable: true,
            retryAfter,
          } as LLMError;

        case 500:
        case 502:
        case 503:
        case 504:
          return {
            ...baseError,
            errorType: 'service_unavailable',
            message: `OpenAI service error: ${apiError.message}`,
            statusCode: apiError.status,
            retryable: true,
          } as LLMError;

        default:
          return {
            ...baseError,
            errorType: 'unknown_error',
            message: `OpenAI API error: ${apiError.message}`,
            statusCode: apiError.status,
            retryable: false,
          } as LLMError;
      }
    }

    // Handle network/timeout errors
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return {
        ...baseError,
        errorType: 'timeout_error',
        message: 'Request timeout - OpenAI API did not respond in time',
        retryable: true,
      } as LLMError;
    }

    if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
      return {
        ...baseError,
        errorType: 'network_error',
        message: 'Network error - unable to connect to OpenAI API',
        retryable: true,
      } as LLMError;
    }

    // Generic error fallback
    return {
      ...baseError,
      errorType: 'unknown_error',
      message: `Unexpected error: ${error.message}`,
      retryable: false,
    } as LLMError;
  }

  private parseRetryAfter(retryAfterHeader?: string): number | undefined {
    if (!retryAfterHeader) return undefined;
    
    const seconds = parseInt(retryAfterHeader, 10);
    return isNaN(seconds) ? undefined : seconds;
  }
}