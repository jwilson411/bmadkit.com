import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringWindow: number;
  expectedErrors?: string[];
}

interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  successes: number;
  nextAttempt: number;
  lastFailureTime: number;
  recentCalls: Array<{ timestamp: number; success: boolean }>;
}

class CircuitBreakerService {
  private breakers = new Map<string, CircuitBreakerState>();
  private defaultOptions: CircuitBreakerOptions = {
    name: 'default',
    failureThreshold: 5,
    recoveryTimeout: 30000, // 30 seconds
    monitoringWindow: 60000, // 1 minute
    expectedErrors: ['ECONNRESET', 'ENOTFOUND', 'TIMEOUT', 'ECONNREFUSED']
  };

  createBreaker(options: Partial<CircuitBreakerOptions>): CircuitBreakerOptions {
    const config = { ...this.defaultOptions, ...options };
    
    if (!this.breakers.has(config.name)) {
      this.breakers.set(config.name, {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        nextAttempt: 0,
        lastFailureTime: 0,
        recentCalls: []
      });
    }
    
    return config;
  }

  async execute<T>(
    breakerName: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const state = this.breakers.get(breakerName);
    if (!state) {
      throw new Error(`Circuit breaker '${breakerName}' not found`);
    }

    // Check if circuit is open
    if (state.state === 'OPEN') {
      if (Date.now() < state.nextAttempt) {
        logger.warn(`Circuit breaker '${breakerName}' is OPEN, using fallback`);
        if (fallback) {
          return fallback();
        }
        throw new Error(`Circuit breaker '${breakerName}' is OPEN`);
      } else {
        // Try to move to half-open
        state.state = 'HALF_OPEN';
        logger.info(`Circuit breaker '${breakerName}' moving to HALF_OPEN`);
      }
    }

    try {
      const result = await operation();
      this.recordSuccess(breakerName);
      return result;
    } catch (error) {
      this.recordFailure(breakerName, error as Error);
      
      // Use fallback if circuit is now open
      if (state.state === 'OPEN' && fallback) {
        logger.warn(`Circuit breaker '${breakerName}' opened, using fallback`);
        return fallback();
      }
      
      throw error;
    }
  }

  private recordSuccess(breakerName: string) {
    const state = this.breakers.get(breakerName)!;
    state.successes++;
    
    this.addRecentCall(breakerName, true);

    if (state.state === 'HALF_OPEN') {
      // Reset and close circuit after successful call
      state.state = 'CLOSED';
      state.failures = 0;
      logger.info(`Circuit breaker '${breakerName}' reset to CLOSED after successful call`);
    }
  }

  private recordFailure(breakerName: string, error: Error) {
    const state = this.breakers.get(breakerName)!;
    const config = Array.from(this.breakers.keys()).find(name => name === breakerName);
    
    state.failures++;
    state.lastFailureTime = Date.now();
    
    this.addRecentCall(breakerName, false);

    logger.warn(`Circuit breaker '${breakerName}' recorded failure:`, {
      error: error.message,
      failures: state.failures,
      state: state.state
    });

    // Check if we should open the circuit
    if (state.failures >= 5 && state.state !== 'OPEN') { // Using default threshold
      state.state = 'OPEN';
      state.nextAttempt = Date.now() + 30000; // 30 seconds
      
      logger.error(`Circuit breaker '${breakerName}' OPENED due to ${state.failures} failures`);
    } else if (state.state === 'HALF_OPEN') {
      // Go back to open if half-open call fails
      state.state = 'OPEN';
      state.nextAttempt = Date.now() + 30000;
      
      logger.warn(`Circuit breaker '${breakerName}' returned to OPEN from HALF_OPEN`);
    }
  }

  private addRecentCall(breakerName: string, success: boolean) {
    const state = this.breakers.get(breakerName)!;
    const now = Date.now();
    
    state.recentCalls.push({ timestamp: now, success });
    
    // Clean up old calls (older than monitoring window)
    state.recentCalls = state.recentCalls.filter(
      call => now - call.timestamp < 60000 // 1 minute
    );
  }

  getState(breakerName: string): CircuitBreakerState | undefined {
    return this.breakers.get(breakerName);
  }

  getHealthStatus(breakerName: string) {
    const state = this.breakers.get(breakerName);
    if (!state) return null;

    const recentCalls = state.recentCalls.length;
    const recentSuccesses = state.recentCalls.filter(call => call.success).length;
    const successRate = recentCalls > 0 ? (recentSuccesses / recentCalls) * 100 : 100;

    return {
      name: breakerName,
      state: state.state,
      failures: state.failures,
      successes: state.successes,
      recentCalls,
      successRate,
      nextAttempt: state.state === 'OPEN' ? new Date(state.nextAttempt) : null,
      lastFailure: state.lastFailureTime > 0 ? new Date(state.lastFailureTime) : null
    };
  }

  reset(breakerName: string) {
    const state = this.breakers.get(breakerName);
    if (state) {
      state.state = 'CLOSED';
      state.failures = 0;
      state.successes = 0;
      state.nextAttempt = 0;
      state.lastFailureTime = 0;
      state.recentCalls = [];
      
      logger.info(`Circuit breaker '${breakerName}' manually reset`);
    }
  }
}

export const circuitBreakerService = new CircuitBreakerService();

// Middleware factory for Express
export function createCircuitBreakerMiddleware(options: Partial<CircuitBreakerOptions>) {
  const config = circuitBreakerService.createBreaker(options);
  
  return (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;
    
    let responseIntercepted = false;
    
    // Intercept response to record success/failure
    const interceptResponse = (statusCode: number) => {
      if (responseIntercepted) return;
      responseIntercepted = true;
      
      if (statusCode >= 500) {
        const error = new Error(`HTTP ${statusCode} Server Error`);
        circuitBreakerService['recordFailure'](config.name, error);
      } else if (statusCode < 400) {
        circuitBreakerService['recordSuccess'](config.name);
      }
    };

    res.send = function(body?: any) {
      interceptResponse(this.statusCode);
      return originalSend.call(this, body);
    };

    res.json = function(obj?: any) {
      interceptResponse(this.statusCode);
      return originalJson.call(this, obj);
    };

    res.end = function(chunk?: any, encoding?: any) {
      interceptResponse(this.statusCode);
      return originalEnd.call(this, chunk, encoding);
    };

    // Check circuit state before processing
    const state = circuitBreakerService.getState(config.name);
    if (state && state.state === 'OPEN' && Date.now() < state.nextAttempt) {
      return res.status(503).json({
        error: 'Service Temporarily Unavailable',
        message: 'Circuit breaker is open',
        circuitBreaker: config.name,
        retryAfter: Math.ceil((state.nextAttempt - Date.now()) / 1000)
      });
    }

    next();
  };
}

// Utility for wrapping external service calls
export function withCircuitBreaker<T>(
  breakerName: string,
  operation: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  return circuitBreakerService.execute(breakerName, operation, fallback);
}

// Express route for circuit breaker health check
export function circuitBreakerHealthRoute(req: Request, res: Response) {
  const breakerNames = Array.from(circuitBreakerService['breakers'].keys());
  const health = breakerNames.map(name => circuitBreakerService.getHealthStatus(name));
  
  const hasOpenBreakers = health.some(status => status?.state === 'OPEN');
  
  res.status(hasOpenBreakers ? 503 : 200).json({
    status: hasOpenBreakers ? 'degraded' : 'healthy',
    circuitBreakers: health,
    timestamp: new Date().toISOString()
  });
}