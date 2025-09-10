import { EventEmitter } from 'events';
import { logger as baseLogger } from '../utils/logger.ts';
import { LLMRequest, LLMResponse, LLMError, LLMProvider } from '../models/llm-request.ts';

export interface LoggingConfig {
  enableRequestLogging: boolean;
  enableResponseLogging: boolean;
  enableErrorLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maskSensitiveData: boolean;
  maxContentLength: number; // Max length of content to log
  retentionDays: number; // How long to keep logs
  enableStructuredLogging: boolean;
  enablePerformanceMetrics: boolean;
  enablePrivacyCompliantLogging: boolean;
}

export interface RequestLogEntry {
  id: string;
  timestamp: Date;
  provider: LLMProvider;
  model: string;
  userId?: string;
  sessionId?: string;
  correlationId: string;
  messageCount: number;
  estimatedTokens: number;
  parameters: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
  metadata: Record<string, any>;
  maskedContent?: string; // Partially masked content for privacy
}

export interface ResponseLogEntry {
  id: string;
  requestId: string;
  timestamp: Date;
  provider: LLMProvider;
  model: string;
  success: boolean;
  latency: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: {
    totalCost: number;
    currency: string;
  };
  finishReason: string;
  contentLength: number;
  maskedContent?: string;
  metadata: Record<string, any>;
}

export interface ErrorLogEntry {
  id: string;
  requestId: string;
  timestamp: Date;
  provider: LLMProvider;
  errorType: string;
  message: string;
  statusCode?: number;
  retryable: boolean;
  retryAfter?: number;
  latency?: number;
  stackTrace?: string;
  metadata: Record<string, any>;
}

export interface PerformanceMetrics {
  provider: LLMProvider;
  period: 'hour' | 'day' | 'week';
  startTime: Date;
  endTime: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  totalTokens: number;
  totalCost: number;
  errorsByType: Record<string, number>;
  topModels: Array<{ model: string; count: number; avgLatency: number }>;
}

export class LLMRequestLogger extends EventEmitter {
  private config: LoggingConfig;
  private requestLogs: Map<string, RequestLogEntry> = new Map();
  private responseLogs: Map<string, ResponseLogEntry> = new Map();
  private errorLogs: Map<string, ErrorLogEntry> = new Map();
  private performanceBuffer: Array<{ timestamp: Date; data: any }> = [];

  constructor(config: Partial<LoggingConfig> = {}) {
    super();

    this.config = {
      enableRequestLogging: true,
      enableResponseLogging: true,
      enableErrorLogging: true,
      logLevel: 'info',
      maskSensitiveData: true,
      maxContentLength: 1000,
      retentionDays: 30,
      enableStructuredLogging: true,
      enablePerformanceMetrics: true,
      enablePrivacyCompliantLogging: true,
      ...config
    };

    // Start cleanup interval
    this.startCleanupInterval();

    baseLogger.info('LLM Request Logger initialized', {
      enableRequestLogging: this.config.enableRequestLogging,
      enableResponseLogging: this.config.enableResponseLogging,
      maskSensitiveData: this.config.maskSensitiveData,
      maxContentLength: this.config.maxContentLength
    });
  }

  /**
   * Log an LLM request
   */
  logRequest(request: LLMRequest): void {
    if (!this.config.enableRequestLogging) return;

    const logEntry: RequestLogEntry = {
      id: `log_req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      provider: request.provider,
      model: request.model,
      userId: request.userId,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      messageCount: request.messages.length,
      estimatedTokens: this.estimateTokens(request.messages.map(m => m.content).join(' ')),
      parameters: {
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        topP: request.topP,
      },
      metadata: {
        createdAt: request.createdAt,
        timeout: request.timeout,
        hasStopSequences: !!request.stopSequences?.length,
      },
    };

    // Add masked content if privacy compliance is enabled
    if (this.config.enablePrivacyCompliantLogging) {
      logEntry.maskedContent = this.maskSensitiveContent(
        request.messages.map(m => `${m.role}: ${m.content}`).join('\n')
      );
    }

    this.requestLogs.set(request.id, logEntry);

    if (this.config.enableStructuredLogging) {
      baseLogger.info('LLM request logged', {
        requestId: request.id,
        provider: request.provider,
        model: request.model,
        messageCount: logEntry.messageCount,
        estimatedTokens: logEntry.estimatedTokens,
        userId: this.maskUserId(request.userId),
        correlationId: request.correlationId
      });
    }

    this.emit('requestLogged', logEntry);
    this.bufferPerformanceData('request', logEntry);
  }

  /**
   * Log an LLM response
   */
  logResponse(response: LLMResponse): void {
    if (!this.config.enableResponseLogging) return;

    const logEntry: ResponseLogEntry = {
      id: `log_resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: response.requestId,
      timestamp: new Date(),
      provider: response.provider,
      model: response.model,
      success: true,
      latency: response.latency,
      usage: response.usage,
      cost: {
        totalCost: response.cost.totalCost,
        currency: response.cost.currency,
      },
      finishReason: response.finishReason,
      contentLength: response.content.length,
      metadata: {
        createdAt: response.createdAt,
        ...response.metadata,
      },
    };

    // Add masked content if privacy compliance is enabled
    if (this.config.enablePrivacyCompliantLogging) {
      logEntry.maskedContent = this.maskSensitiveContent(response.content);
    }

    this.responseLogs.set(response.id, logEntry);

    if (this.config.enableStructuredLogging) {
      baseLogger.info('LLM response logged', {
        requestId: response.requestId,
        provider: response.provider,
        model: response.model,
        success: true,
        latency: response.latency,
        totalTokens: response.usage.totalTokens,
        totalCost: response.cost.totalCost,
        finishReason: response.finishReason,
        contentLength: response.content.length
      });
    }

    this.emit('responseLogged', logEntry);
    this.bufferPerformanceData('response', logEntry);
  }

  /**
   * Log an LLM error
   */
  logError(error: LLMError): void {
    if (!this.config.enableErrorLogging) return;

    const logEntry: ErrorLogEntry = {
      id: `log_err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: error.requestId,
      timestamp: new Date(),
      provider: error.provider,
      errorType: error.errorType,
      message: error.message,
      statusCode: error.statusCode,
      retryable: error.retryable,
      retryAfter: error.retryAfter,
      metadata: {
        createdAt: error.createdAt,
        ...error.metadata,
      },
    };

    this.errorLogs.set(error.id, logEntry);

    const logLevel = error.retryable ? 'warn' : 'error';
    
    if (this.config.enableStructuredLogging) {
      baseLogger[logLevel]('LLM error logged', {
        requestId: error.requestId,
        provider: error.provider,
        errorType: error.errorType,
        message: error.message,
        statusCode: error.statusCode,
        retryable: error.retryable,
        retryAfter: error.retryAfter
      });
    }

    this.emit('errorLogged', logEntry);
    this.bufferPerformanceData('error', logEntry);
  }

  /**
   * Get request logs for a specific time period
   */
  getRequestLogs(startTime: Date, endTime: Date, provider?: LLMProvider): RequestLogEntry[] {
    return Array.from(this.requestLogs.values()).filter(log => {
      const matchesTime = log.timestamp >= startTime && log.timestamp <= endTime;
      const matchesProvider = !provider || log.provider === provider;
      return matchesTime && matchesProvider;
    });
  }

  /**
   * Get response logs for a specific time period
   */
  getResponseLogs(startTime: Date, endTime: Date, provider?: LLMProvider): ResponseLogEntry[] {
    return Array.from(this.responseLogs.values()).filter(log => {
      const matchesTime = log.timestamp >= startTime && log.timestamp <= endTime;
      const matchesProvider = !provider || log.provider === provider;
      return matchesTime && matchesProvider;
    });
  }

  /**
   * Get error logs for a specific time period
   */
  getErrorLogs(startTime: Date, endTime: Date, provider?: LLMProvider): ErrorLogEntry[] {
    return Array.from(this.errorLogs.values()).filter(log => {
      const matchesTime = log.timestamp >= startTime && log.timestamp <= endTime;
      const matchesProvider = !provider || log.provider === provider;
      return matchesTime && matchesProvider;
    });
  }

  /**
   * Get performance metrics for a time period
   */
  getPerformanceMetrics(
    provider: LLMProvider,
    period: 'hour' | 'day' | 'week',
    startTime?: Date
  ): PerformanceMetrics | null {
    if (!this.config.enablePerformanceMetrics) return null;

    const endTime = new Date();
    const actualStartTime = startTime || this.calculateStartTime(period, endTime);

    const requestLogs = this.getRequestLogs(actualStartTime, endTime, provider);
    const responseLogs = this.getResponseLogs(actualStartTime, endTime, provider);
    const errorLogs = this.getErrorLogs(actualStartTime, endTime, provider);

    if (requestLogs.length === 0) return null;

    const latencies = responseLogs.map(log => log.latency).sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);

    const modelStats = new Map<string, { count: number; totalLatency: number }>();
    responseLogs.forEach(log => {
      const existing = modelStats.get(log.model) || { count: 0, totalLatency: 0 };
      existing.count++;
      existing.totalLatency += log.latency;
      modelStats.set(log.model, existing);
    });

    const topModels = Array.from(modelStats.entries())
      .map(([model, stats]) => ({
        model,
        count: stats.count,
        avgLatency: stats.totalLatency / stats.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const errorsByType = errorLogs.reduce((acc, log) => {
      acc[log.errorType] = (acc[log.errorType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      provider,
      period,
      startTime: actualStartTime,
      endTime,
      totalRequests: requestLogs.length,
      successfulRequests: responseLogs.length,
      failedRequests: errorLogs.length,
      averageLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p95Latency: latencies[p95Index] || 0,
      p99Latency: latencies[p99Index] || 0,
      totalTokens: responseLogs.reduce((total, log) => total + log.usage.totalTokens, 0),
      totalCost: responseLogs.reduce((total, log) => total + log.cost.totalCost, 0),
      errorsByType,
      topModels
    };
  }

  /**
   * Search logs by correlation ID
   */
  searchByCorrelationId(correlationId: string): {
    request?: RequestLogEntry;
    response?: ResponseLogEntry;
    errors: ErrorLogEntry[];
  } {
    const request = Array.from(this.requestLogs.values()).find(log => log.correlationId === correlationId);
    const response = Array.from(this.responseLogs.values()).find(log => log.requestId === request?.id);
    const errors = Array.from(this.errorLogs.values()).filter(log => log.requestId === request?.id);

    return { request, response, errors };
  }

  /**
   * Export logs in various formats
   */
  exportLogs(format: 'json' | 'csv', startTime: Date, endTime: Date, provider?: LLMProvider): string {
    const requests = this.getRequestLogs(startTime, endTime, provider);
    const responses = this.getResponseLogs(startTime, endTime, provider);
    const errors = this.getErrorLogs(startTime, endTime, provider);

    if (format === 'json') {
      return JSON.stringify({ requests, responses, errors }, null, 2);
    } else if (format === 'csv') {
      // Simple CSV export (you might want to use a proper CSV library)
      const csvData = [
        'timestamp,type,provider,model,latency,tokens,cost,success,error_type',
        ...requests.map(r => `${r.timestamp.toISOString()},request,${r.provider},${r.model},0,${r.estimatedTokens},0,true,`),
        ...responses.map(r => `${r.timestamp.toISOString()},response,${r.provider},${r.model},${r.latency},${r.usage.totalTokens},${r.cost.totalCost},true,`),
        ...errors.map(e => `${e.timestamp.toISOString()},error,${e.provider},,${e.latency || 0},0,0,false,${e.errorType}`)
      ];
      return csvData.join('\n');
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.requestLogs.clear();
    this.responseLogs.clear();
    this.errorLogs.clear();
    this.performanceBuffer = [];
    
    baseLogger.info('All LLM logs cleared');
    this.emit('logsCleared');
  }

  /**
   * Shutdown the logger
   */
  shutdown(): void {
    this.clearLogs();
    this.removeAllListeners();
    baseLogger.info('LLM Request Logger shutdown complete');
  }

  // Private methods

  private maskSensitiveContent(content: string): string {
    if (!this.config.maskSensitiveData) return content;

    // Truncate content if too long
    let maskedContent = content.length > this.config.maxContentLength 
      ? content.substring(0, this.config.maxContentLength) + '...[truncated]'
      : content;

    // Mask potential PII patterns
    maskedContent = maskedContent
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]')
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
      .replace(/\b\d{1,5}\s\w+\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/gi, '[ADDRESS]');

    return maskedContent;
  }

  private maskUserId(userId?: string): string | undefined {
    if (!userId || !this.config.maskSensitiveData) return userId;
    
    // Show only first 3 and last 3 characters
    if (userId.length <= 6) return '[MASKED]';
    return `${userId.substring(0, 3)}***${userId.substring(userId.length - 3)}`;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  private calculateStartTime(period: 'hour' | 'day' | 'week', endTime: Date): Date {
    const start = new Date(endTime);
    switch (period) {
      case 'hour':
        start.setHours(start.getHours() - 1);
        break;
      case 'day':
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
    }
    return start;
  }

  private bufferPerformanceData(type: string, data: any): void {
    if (!this.config.enablePerformanceMetrics) return;

    this.performanceBuffer.push({
      timestamp: new Date(),
      data: { type, ...data }
    });

    // Keep buffer size manageable
    if (this.performanceBuffer.length > 10000) {
      this.performanceBuffer = this.performanceBuffer.slice(-5000);
    }
  }

  private startCleanupInterval(): void {
    // Clean up old logs every hour
    setInterval(() => {
      this.cleanupOldLogs();
    }, 3600000); // 1 hour
  }

  private cleanupOldLogs(): void {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - this.config.retentionDays);

    let removedCount = 0;

    // Clean request logs
    for (const [id, log] of this.requestLogs.entries()) {
      if (log.timestamp < cutoffTime) {
        this.requestLogs.delete(id);
        removedCount++;
      }
    }

    // Clean response logs
    for (const [id, log] of this.responseLogs.entries()) {
      if (log.timestamp < cutoffTime) {
        this.responseLogs.delete(id);
        removedCount++;
      }
    }

    // Clean error logs
    for (const [id, log] of this.errorLogs.entries()) {
      if (log.timestamp < cutoffTime) {
        this.errorLogs.delete(id);
        removedCount++;
      }
    }

    // Clean performance buffer
    this.performanceBuffer = this.performanceBuffer.filter(
      item => item.timestamp >= cutoffTime
    );

    if (removedCount > 0) {
      baseLogger.info('Cleaned up old LLM logs', {
        removedCount,
        cutoffTime,
        retentionDays: this.config.retentionDays
      });
    }
  }
}

// Export singleton instance
export const llmRequestLogger = new LLMRequestLogger();