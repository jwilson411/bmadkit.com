import { EventEmitter } from 'events';
import { logger } from './logger.ts';
import { LLMProvider, CircuitBreakerState } from '../models/llm-request.ts';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  timeout: number; // milliseconds
  monitoringPeriod: number; // milliseconds
  expectedDuration: number; // milliseconds for operations
  volumeThreshold: number; // minimum number of requests before considering error rate
  errorThresholdPercentage: number; // percentage of errors to trigger open state
}

export interface CircuitBreakerStats {
  totalRequests: number;
  failedRequests: number;
  successfulRequests: number;
  errorRate: number;
  averageResponseTime: number;
  state: 'closed' | 'open' | 'half_open';
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
}

export class CircuitBreaker extends EventEmitter {
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private lastFailureTime?: Date;
  private nextAttemptTime?: Date;
  private responseTimes: number[] = [];
  private readonly options: CircuitBreakerOptions;
  private readonly name: string;

  constructor(name: string, options: Partial<CircuitBreakerOptions> = {}) {
    super();
    this.name = name;
    this.options = {
      failureThreshold: 5,
      timeout: 60000, // 1 minute
      monitoringPeriod: 120000, // 2 minutes
      expectedDuration: 5000, // 5 seconds
      volumeThreshold: 10,
      errorThresholdPercentage: 50,
      ...options
    };

    // Clean up old response times periodically
    setInterval(() => {
      const cutoff = Date.now() - this.options.monitoringPeriod;
      this.responseTimes = this.responseTimes.filter(time => time > cutoff);
    }, this.options.monitoringPeriod);
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      const error = new CircuitBreakerError(
        `Circuit breaker is OPEN for ${this.name}. Next attempt at: ${this.nextAttemptTime?.toISOString()}`
      );
      this.emit('reject', error);
      throw error;
    }

    if (this.isHalfOpen()) {
      // In half-open state, allow one request to test if service is back
      logger.debug('Circuit breaker half-open, testing service', { name: this.name });
    }

    const startTime = Date.now();
    this.totalRequests++;

    try {
      const result = await operation();
      const responseTime = Date.now() - startTime;
      
      this.onSuccess(responseTime);
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.onFailure(error as Error, responseTime);
      throw error;
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    const errorRate = this.totalRequests > 0 ? this.failureCount / this.totalRequests : 0;
    const averageResponseTime = this.responseTimes.length > 0 
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
      : 0;

    return {
      totalRequests: this.totalRequests,
      failedRequests: this.failureCount,
      successfulRequests: this.successCount,
      errorRate: errorRate * 100, // as percentage
      averageResponseTime,
      state: this.state,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return {
      provider: this.name as LLMProvider,
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.options.failureThreshold,
      timeout: this.options.timeout,
      lastFailureAt: this.lastFailureTime,
      nextAttemptAt: this.nextAttemptTime,
      successCount: this.state === 'half_open' ? this.successCount : undefined,
    };
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
    
    logger.info('Circuit breaker reset', { name: this.name });
    this.emit('reset');
  }

  /**
   * Force circuit breaker to open state
   */
  forceOpen(): void {
    this.state = 'open';
    this.nextAttemptTime = new Date(Date.now() + this.options.timeout);
    
    logger.warn('Circuit breaker forced open', { 
      name: this.name,
      nextAttempt: this.nextAttemptTime
    });
    this.emit('open', { forced: true });
  }

  /**
   * Force circuit breaker to closed state
   */
  forceClosed(): void {
    this.reset();
    logger.info('Circuit breaker forced closed', { name: this.name });
  }

  // Private methods

  private isOpen(): boolean {
    if (this.state === 'open') {
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime.getTime()) {
        this.toHalfOpen();
        return false;
      }
      return true;
    }
    return false;
  }

  private isHalfOpen(): boolean {
    return this.state === 'half_open';
  }

  private isClosed(): boolean {
    return this.state === 'closed';
  }

  private onSuccess(responseTime: number): void {
    this.responseTimes.push(responseTime);
    this.successCount++;

    if (this.isHalfOpen()) {
      // Success in half-open state means we can close the circuit
      this.toClosed();
    } else if (this.isClosed()) {
      // Reset failure count on successful request
      this.failureCount = Math.max(0, this.failureCount - 1);
    }

    this.emit('success', { responseTime, state: this.state });
  }

  private onFailure(error: Error, responseTime: number): void {
    this.responseTimes.push(responseTime);
    this.failureCount++;
    this.lastFailureTime = new Date();

    logger.warn('Circuit breaker recorded failure', {
      name: this.name,
      error: error.message,
      failureCount: this.failureCount,
      state: this.state,
      responseTime
    });

    if (this.isHalfOpen()) {
      // Failure in half-open state means we go back to open
      this.toOpen();
    } else if (this.isClosed() && this.shouldOpen()) {
      this.toOpen();
    }

    this.emit('failure', { 
      error, 
      responseTime, 
      failureCount: this.failureCount,
      state: this.state 
    });
  }

  private shouldOpen(): boolean {
    // Check if we have enough volume to make a decision
    if (this.totalRequests < this.options.volumeThreshold) {
      return false;
    }

    // Check if failure threshold is exceeded
    if (this.failureCount >= this.options.failureThreshold) {
      return true;
    }

    // Check error rate
    const errorRate = (this.failureCount / this.totalRequests) * 100;
    return errorRate >= this.options.errorThresholdPercentage;
  }

  private toOpen(): void {
    this.state = 'open';
    this.nextAttemptTime = new Date(Date.now() + this.options.timeout);
    
    logger.error('Circuit breaker opened', {
      name: this.name,
      failureCount: this.failureCount,
      totalRequests: this.totalRequests,
      nextAttempt: this.nextAttemptTime
    });

    this.emit('open', {
      failureCount: this.failureCount,
      totalRequests: this.totalRequests,
      nextAttemptTime: this.nextAttemptTime
    });
  }

  private toHalfOpen(): void {
    this.state = 'half_open';
    this.successCount = 0; // Reset success count for half-open state
    
    logger.info('Circuit breaker half-open', { 
      name: this.name,
      failureCount: this.failureCount 
    });

    this.emit('half_open');
  }

  private toClosed(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = undefined;
    
    logger.info('Circuit breaker closed', { 
      name: this.name,
      totalRequests: this.totalRequests
    });

    this.emit('close', { totalRequests: this.totalRequests });
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit breaker registry for managing multiple circuit breakers
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker for a given name
   */
  getOrCreate(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, options);
      this.breakers.set(name, breaker);
      
      // Log circuit breaker events
      breaker.on('open', (data) => {
        logger.error('Circuit breaker opened', { name, ...data });
      });
      
      breaker.on('close', (data) => {
        logger.info('Circuit breaker closed', { name, ...data });
      });
      
      breaker.on('half_open', () => {
        logger.info('Circuit breaker half-open', { name });
      });
    }
    
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    
    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = breaker.getStats();
    }
    
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    logger.info('All circuit breakers reset');
  }

  /**
   * Get circuit breaker by name
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Remove circuit breaker
   */
  remove(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.removeAllListeners();
      this.breakers.delete(name);
      logger.info('Circuit breaker removed', { name });
      return true;
    }
    return false;
  }
}

// Export singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();