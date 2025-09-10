interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitterFactor: number;
  retryCondition?: (error: any, attempt: number) => boolean;
  onRetry?: (error: any, attempt: number) => void;
}

interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
}

export class RetryLogic {
  private static defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    jitterFactor: 0.1,
    retryCondition: (error, attempt) => {
      // Default retry condition: retry on network errors and 5xx status codes
      if (error.name === 'NetworkError' || error.name === 'TypeError') return true;
      if (error.status >= 500 && error.status < 600) return true;
      if (error.code === 'TIMEOUT') return true;
      return false;
    }
  };

  static async execute<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<RetryResult<T>> {
    const config = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    let lastError: Error;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await operation();
        return {
          success: true,
          data: result,
          attempts: attempt,
          totalDuration: Date.now() - startTime
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if we should retry this error
        if (attempt === config.maxAttempts || !config.retryCondition!(lastError, attempt)) {
          break;
        }
        
        // Call retry callback if provided
        config.onRetry?.(lastError, attempt);
        
        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, config);
        await this.sleep(delay);
      }
    }
    
    return {
      success: false,
      error: lastError!,
      attempts: config.maxAttempts,
      totalDuration: Date.now() - startTime
    };
  }

  private static calculateDelay(attempt: number, config: RetryOptions): number {
    // Exponential backoff: baseDelay * (backoffFactor ^ (attempt - 1))
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffFactor, attempt - 1);
    
    // Apply jitter to prevent thundering herd
    const jitter = exponentialDelay * config.jitterFactor * Math.random();
    const delayWithJitter = exponentialDelay + jitter;
    
    // Cap at maxDelay
    return Math.min(delayWithJitter, config.maxDelay);
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Specialized retry for LLM API calls
  static async executeLLMRequest<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<RetryResult<T>> {
    const llmOptions: Partial<RetryOptions> = {
      maxAttempts: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitterFactor: 0.2,
      retryCondition: (error, attempt) => {
        // Retry on rate limits, timeouts, and server errors
        if (error.status === 429) return true; // Rate limit
        if (error.status === 503) return true; // Service unavailable
        if (error.status >= 500 && error.status < 600) return true; // Server errors
        if (error.name === 'TimeoutError') return true;
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') return true;
        return false;
      },
      ...options
    };
    
    return this.execute(operation, llmOptions);
  }

  // Specialized retry for API calls with circuit breaker awareness
  static async executeAPIRequest<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<RetryResult<T>> {
    const apiOptions: Partial<RetryOptions> = {
      maxAttempts: 2,
      baseDelay: 500,
      maxDelay: 5000,
      backoffFactor: 2,
      jitterFactor: 0.1,
      retryCondition: (error, attempt) => {
        // Don't retry on client errors (4xx), except rate limits
        if (error.status >= 400 && error.status < 500 && error.status !== 429) return false;
        // Retry on network errors and server errors
        if (error.status >= 500) return true;
        if (error.status === 429) return true; // Rate limit
        if (error.name === 'NetworkError') return true;
        return false;
      },
      ...options
    };
    
    return this.execute(operation, apiOptions);
  }

  // Utility for timeout wrapper
  static withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      })
    ]);
  }
}

// Hook for React components
import React from 'react';

export function useRetry() {
  const [isRetrying, setIsRetrying] = React.useState(false);
  const [retryCount, setRetryCount] = React.useState(0);
  const [lastError, setLastError] = React.useState<Error | null>(null);

  const executeWithRetry = React.useCallback(async <T>(
    operation: () => Promise<T>,
    options?: Partial<RetryOptions>
  ) => {
    setIsRetrying(true);
    setLastError(null);
    
    const result = await RetryLogic.execute(operation, {
      ...options,
      onRetry: (error, attempt) => {
        setRetryCount(attempt);
        setLastError(error);
        options?.onRetry?.(error, attempt);
      }
    });
    
    setIsRetrying(false);
    
    if (!result.success) {
      setLastError(result.error!);
    }
    
    return result;
  }, []);

  const reset = React.useCallback(() => {
    setRetryCount(0);
    setLastError(null);
    setIsRetrying(false);
  }, []);

  return {
    executeWithRetry,
    isRetrying,
    retryCount,
    lastError,
    reset
  };
}

