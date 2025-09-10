import { logger } from './logger.ts';
import { LLMError, isRetryableError } from '../models/llm-request.ts';

export interface RetryOptions {
  attempts: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffFactor: number;
  jitter: boolean;
  retryCondition?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number) => void;
  abortSignal?: AbortSignal;
}

export interface RetryResult<T> {
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
  success: boolean;
}

/**
 * Execute operation with exponential backoff retry logic
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const config: RetryOptions = {
    attempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true,
    retryCondition: (error) => {
      if (error.name === 'LLMError') {
        const llmError = error as any as LLMError;
        return isRetryableError(llmError.errorType);
      }
      // Default retry condition for network/timeout errors
      return error.message.includes('timeout') ||
             error.message.includes('network') ||
             error.message.includes('ECONNRESET') ||
             error.message.includes('ENOTFOUND');
    },
    ...options
  };

  const startTime = Date.now();
  let lastError: Error;

  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try {
      // Check for abort signal
      if (config.abortSignal?.aborted) {
        throw new Error('Operation aborted');
      }

      const result = await operation();
      
      if (attempt > 1) {
        logger.info('Operation succeeded after retry', {
          attempt,
          totalDuration: Date.now() - startTime
        });
      }
      
      return result;

    } catch (error) {
      lastError = error as Error;
      
      // Check if we should retry this error
      if (!config.retryCondition?.(lastError)) {
        logger.debug('Error not retryable, failing immediately', {
          error: lastError.message,
          attempt
        });
        break;
      }

      // Don't retry on last attempt
      if (attempt === config.attempts) {
        logger.error('All retry attempts exhausted', {
          attempts: config.attempts,
          totalDuration: Date.now() - startTime,
          lastError: lastError.message
        });
        break;
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt - 1, config);
      
      logger.warn('Operation failed, retrying', {
        attempt,
        maxAttempts: config.attempts,
        error: lastError.message,
        retryDelay: delay
      });

      // Call retry callback if provided
      config.onRetry?.(lastError, attempt);

      // Wait before retry
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Execute operation with detailed retry result
 */
export async function executeWithRetryResult<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const result = await executeWithRetry(operation, {
      ...options,
      onRetry: (error, attempt) => {
        attempts = attempt;
        options.onRetry?.(error, attempt);
      }
    });

    return {
      result,
      attempts: attempts + 1,
      totalDuration: Date.now() - startTime,
      success: true
    };

  } catch (error) {
    return {
      error: error as Error,
      attempts: attempts + 1,
      totalDuration: Date.now() - startTime,
      success: false
    };
  }
}

/**
 * Create a retry wrapper for a function
 */
export function createRetryWrapper<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: Partial<RetryOptions> = {}
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    return executeWithRetry(() => fn(...args), options);
  };
}

/**
 * Retry specifically for LLM operations with appropriate error handling
 */
export async function retryLLMOperation<T>(
  operation: () => Promise<T>,
  provider: string,
  operationType: string = 'request'
): Promise<T> {
  return executeWithRetry(operation, {
    attempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    jitter: true,
    retryCondition: (error) => {
      // Handle LLM-specific errors
      if (error.name === 'LLMError') {
        const llmError = error as any as LLMError;
        return isRetryableError(llmError.errorType);
      }
      
      // Handle common network errors
      const message = error.message.toLowerCase();
      return message.includes('timeout') ||
             message.includes('network') ||
             message.includes('econnreset') ||
             message.includes('enotfound') ||
             message.includes('502') ||
             message.includes('503') ||
             message.includes('504');
    },
    onRetry: (error, attempt) => {
      logger.warn('Retrying LLM operation', {
        provider,
        operationType,
        attempt,
        error: error.message
      });
    }
  });
}

/**
 * Batch retry operations with concurrency control
 */
export async function retryBatch<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  options: Partial<RetryOptions & { concurrency?: number }> = {}
): Promise<Array<{ item: T; result?: R; error?: Error; success: boolean }>> {
  const concurrency = options.concurrency || 5;
  const results: Array<{ item: T; result?: R; error?: Error; success: boolean }> = [];

  // Process items in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (item) => {
      try {
        const result = await executeWithRetry(() => operation(item), options);
        return { item, result, success: true };
      } catch (error) {
        return { item, error: error as Error, success: false };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Conditional retry - only retry if condition is met after each attempt
 */
export async function conditionalRetry<T>(
  operation: () => Promise<T>,
  condition: (attempt: number, error?: Error) => Promise<boolean> | boolean,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const config: RetryOptions = {
    attempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    jitter: true,
    ...options
  };

  let lastError: Error;

  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === config.attempts) {
        break;
      }

      const shouldRetry = await condition(attempt, lastError);
      if (!shouldRetry) {
        logger.debug('Condition failed, stopping retry', {
          attempt,
          error: lastError.message
        });
        break;
      }

      const delay = calculateDelay(attempt - 1, config);
      await sleep(delay);
    }
  }

  throw lastError!;
}

// Helper functions

function calculateDelay(attempt: number, options: RetryOptions): number {
  const exponentialDelay = Math.min(
    options.baseDelay * Math.pow(options.backoffFactor, attempt),
    options.maxDelay
  );

  if (!options.jitter) {
    return exponentialDelay;
  }

  // Add jitter to prevent thundering herd problem
  const jitter = exponentialDelay * 0.1 * Math.random();
  return Math.floor(exponentialDelay + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create abort controller with timeout
 */
export function createTimeoutAbortController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // Clear timeout if manually aborted
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
  });

  return controller;
}

/**
 * Retry with circuit breaker integration
 */
export async function retryWithCircuitBreaker<T>(
  operation: () => Promise<T>,
  circuitBreaker: { execute: <U>(op: () => Promise<U>) => Promise<U> },
  options: Partial<RetryOptions> = {}
): Promise<T> {
  return executeWithRetry(
    () => circuitBreaker.execute(operation),
    {
      ...options,
      retryCondition: (error) => {
        // Don't retry circuit breaker errors
        if (error.name === 'CircuitBreakerError') {
          return false;
        }
        return options.retryCondition?.(error) ?? isRetryableError(error as any);
      }
    }
  );
}