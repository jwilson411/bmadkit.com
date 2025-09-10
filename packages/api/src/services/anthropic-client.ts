import Anthropic from '@anthropic-ai/sdk';
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

export interface AnthropicClientConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  retryAttempts?: number;
  enableCircuitBreaker?: boolean;
}

export class AnthropicClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorType?: LLMError['errorType'],
    public retryable: boolean = false,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'AnthropicClientError';
  }
}

export class AnthropicClient {
  private client: Anthropic;
  private config: AnthropicClientConfig;
  private circuitBreaker;

  constructor(config: AnthropicClientConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      enableCircuitBreaker: true,
      ...config
    };

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
    });

    // Initialize circuit breaker
    if (this.config.enableCircuitBreaker) {
      this.circuitBreaker = circuitBreakerRegistry.getOrCreate('anthropic', {
        failureThreshold: 5,
        timeout: 60000,
        volumeThreshold: 10,
        errorThresholdPercentage: 50
      });
    }

    logger.info('Anthropic client initialized', {
      timeout: this.config.timeout,
      circuitBreakerEnabled: this.config.enableCircuitBreaker
    });
  }

  /**
   * Send completion request to Anthropic
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    
    logger.debug('Anthropic completion request', {
      requestId: request.id,
      model: request.model,
      messageCount: request.messages.length,
      maxTokens: request.maxTokens
    });

    const operation = async (): Promise<LLMResponse> => {
      try {
        // Convert messages to Anthropic format
        const { system, messages } = this.formatMessagesForAnthropic(request.messages);
        const anthropicModel = this.mapModelName(request.model);

        const completion = await this.client.messages.create({
          model: anthropicModel,
          max_tokens: request.maxTokens || 2048,
          temperature: request.temperature,
          top_p: request.topP,
          stop_sequences: request.stopSequences,
          system: system,
          messages: messages,
        });

        const response = this.formatAnthropicResponse(completion, request, startTime);
        
        logger.info('Anthropic completion successful', {
          requestId: request.id,
          model: anthropicModel,
          inputTokens: response.usage.promptTokens,
          outputTokens: response.usage.completionTokens,
          latency: response.latency,
          cost: response.cost.totalCost
        });

        return response;

      } catch (error) {
        const latency = Date.now() - startTime;
        const llmError = this.handleAnthropicError(error as Error, request, latency);
        
        logger.error('Anthropic completion failed', {
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
        'anthropic',
        'completion'
      );
    } else {
      return await retryLLMOperation(operation, 'anthropic', 'completion');
    }
  }

  /**
   * Test connection to Anthropic API
   */
  async testConnection(): Promise<boolean> {
    try {
      // Simple test message to verify API access
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      
      logger.info('Anthropic connection test successful');
      return true;
    } catch (error) {
      logger.error('Anthropic connection test failed', {
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Get available models (Anthropic doesn't have a models list endpoint)
   */
  async getAvailableModels(): Promise<string[]> {
    // Return known Claude models
    const models = [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];

    logger.debug('Retrieved Anthropic models', { count: models.length });
    return models;
  }

  /**
   * Get token count for text
   */
  async getTokenCount(text: string, model: string = 'claude-3-sonnet'): Promise<number> {
    try {
      // Anthropic uses a similar tokenization to GPT models
      // This is a rough estimation - in production, you might want to use
      // Anthropic's token counting if available
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

  private formatMessagesForAnthropic(messages: LLMMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    const systemMessage = messages.find(msg => msg.role === 'system');
    const conversationMessages = messages.filter(msg => msg.role !== 'system');

    const anthropicMessages: Anthropic.MessageParam[] = conversationMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

    return {
      system: systemMessage?.content,
      messages: anthropicMessages,
    };
  }

  private formatAnthropicResponse(
    completion: Anthropic.Message,
    request: LLMRequest,
    startTime: number
  ): LLMResponse {
    const latency = Date.now() - startTime;

    // Extract text content
    const textContent = completion.content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('');

    // Calculate costs
    const modelPricing = PRICING.anthropic[request.model as keyof typeof PRICING.anthropic] 
      || PRICING.anthropic['claude-3-sonnet'];

    const inputTokens = completion.usage.input_tokens;
    const outputTokens = completion.usage.output_tokens;

    const promptCost = (inputTokens / 1000) * modelPricing.prompt;
    const completionCost = (outputTokens / 1000) * modelPricing.completion;

    return {
      id: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: request.id,
      provider: 'anthropic',
      model: request.model,
      content: textContent,
      finishReason: this.mapStopReason(completion.stop_reason),
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
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
        anthropicId: completion.id,
        model: completion.model,
        stopReason: completion.stop_reason,
        stopSequence: completion.stop_sequence,
      },
    };
  }

  private mapStopReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }

  private mapModelName(model: string): string {
    return MODEL_MAPPINGS.anthropic[model as keyof typeof MODEL_MAPPINGS.anthropic] || model;
  }

  private handleAnthropicError(error: Error, request?: LLMRequest, latency?: number): LLMError {
    const baseError: Partial<LLMError> = {
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: request?.id || 'unknown',
      provider: 'anthropic',
      createdAt: new Date(),
      metadata: { originalError: error.message, latency }
    };

    // Handle Anthropic specific errors
    if (error instanceof Anthropic.APIError) {
      const apiError = error as Anthropic.APIError;
      
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
            message: `Anthropic service error: ${apiError.message}`,
            statusCode: apiError.status,
            retryable: true,
          } as LLMError;

        default:
          return {
            ...baseError,
            errorType: 'unknown_error',
            message: `Anthropic API error: ${apiError.message}`,
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
        message: 'Request timeout - Anthropic API did not respond in time',
        retryable: true,
      } as LLMError;
    }

    if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
      return {
        ...baseError,
        errorType: 'network_error',
        message: 'Network error - unable to connect to Anthropic API',
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