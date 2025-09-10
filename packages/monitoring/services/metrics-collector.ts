import { EventEmitter } from 'events';
import winston from 'winston';
import Redis from 'ioredis';

/**
 * Comprehensive Metrics Collection Service
 * Real-time performance monitoring with structured logging and correlation tracking
 */

export interface MetricData {
  id: string;
  timestamp: number;
  correlationId?: string;
  service: string;
  metric: string;
  value: number;
  unit: string;
  labels: Record<string, string>;
  context: MetricContext;
}

export interface MetricContext {
  userId?: string;
  sessionId?: string;
  requestId?: string;
  userAgent?: string;
  ipAddress?: string;
  route?: string;
  method?: string;
}

export interface PerformanceMetric {
  requestDuration: number;
  responseSize: number;
  statusCode: number;
  endpoint: string;
  method: string;
  timestamp: number;
  correlationId: string;
  userId?: string;
  sessionId?: string;
}

export interface SystemMetric {
  cpu: number;
  memory: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  timestamp: number;
  hostname: string;
  service: string;
}

export interface DatabaseMetric {
  queryDuration: number;
  queryType: string;
  table?: string;
  rowsAffected?: number;
  cacheHit: boolean;
  connectionPoolSize: number;
  timestamp: number;
  correlationId: string;
}

export interface CustomMetric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
  labels: Record<string, string>;
  timestamp: number;
}

export interface MetricCollectorConfig {
  redis: {
    url: string;
    keyPrefix: string;
    retention: number;
  };
  logging: {
    level: string;
    format: string;
  };
  sampling: {
    performanceMetrics: number;
    systemMetrics: number;
    databaseMetrics: number;
  };
  aggregation: {
    windowSize: number;
    bufferSize: number;
    flushInterval: number;
  };
}

/**
 * Application Performance Metrics Collector
 * Collects, aggregates, and stores performance metrics with real-time processing
 */
export class MetricsCollector extends EventEmitter {
  private redis: Redis;
  private logger: winston.Logger;
  private config: MetricCollectorConfig;
  private metricsBuffer: Map<string, MetricData[]>;
  private aggregationBuffer: Map<string, AggregatedMetric>;
  private flushTimer: NodeJS.Timer | null = null;

  constructor(config: MetricCollectorConfig) {
    super();
    this.config = config;
    this.metricsBuffer = new Map();
    this.aggregationBuffer = new Map();
    
    this.initializeRedis();
    this.initializeLogger();
    this.startAggregation();
  }

  /**
   * Initialize Redis connection for metrics storage
   */
  private initializeRedis(): void {
    this.redis = new Redis(this.config.redis.url, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error', { error: error.message });
      this.emit('error', error);
    });

    this.redis.on('connect', () => {
      this.logger.info('Connected to Redis for metrics storage');
    });
  }

  /**
   * Initialize structured logging with correlation ID tracking
   */
  private initializeLogger(): void {
    this.logger = winston.createLogger({
      level: this.config.logging.level || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf((info) => {
          return JSON.stringify({
            timestamp: info.timestamp,
            level: info.level,
            message: info.message,
            service: 'metrics-collector',
            correlationId: info.correlationId,
            ...info
          });
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/metrics-collector.log',
          maxsize: 10485760, // 10MB
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Start metrics aggregation and flushing
   */
  private startAggregation(): void {
    this.flushTimer = setInterval(() => {
      this.flushMetrics();
    }, this.config.aggregation.flushInterval || 30000); // Default 30 seconds

    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      this.shutdown();
    });

    process.on('SIGINT', () => {
      this.shutdown();
    });
  }

  /**
   * Record performance metric with correlation tracking
   */
  async recordPerformanceMetric(metric: PerformanceMetric): Promise<void> {
    try {
      // Apply sampling
      if (Math.random() > this.config.sampling.performanceMetrics) {
        return;
      }

      const metricData: MetricData = {
        id: this.generateMetricId(),
        timestamp: metric.timestamp || Date.now(),
        correlationId: metric.correlationId,
        service: 'application',
        metric: 'request_duration',
        value: metric.requestDuration,
        unit: 'milliseconds',
        labels: {
          endpoint: metric.endpoint,
          method: metric.method,
          status_code: metric.statusCode.toString()
        },
        context: {
          userId: metric.userId,
          sessionId: metric.sessionId,
          requestId: metric.correlationId,
          route: metric.endpoint,
          method: metric.method
        }
      };

      await this.bufferMetric(metricData);
      
      // Log performance metric
      this.logger.info('Performance metric recorded', {
        correlationId: metric.correlationId,
        duration: metric.requestDuration,
        endpoint: metric.endpoint,
        statusCode: metric.statusCode,
        userId: metric.userId
      });

      // Emit for real-time processing
      this.emit('performanceMetric', metricData);

      // Record additional derived metrics
      await this.recordDerivedMetrics(metric);

    } catch (error) {
      this.logger.error('Failed to record performance metric', {
        error: error instanceof Error ? error.message : 'Unknown error',
        metric: JSON.stringify(metric)
      });
    }
  }

  /**
   * Record system resource metric
   */
  async recordSystemMetric(metric: SystemMetric): Promise<void> {
    try {
      // Apply sampling
      if (Math.random() > this.config.sampling.systemMetrics) {
        return;
      }

      const metrics: MetricData[] = [
        {
          id: this.generateMetricId(),
          timestamp: metric.timestamp,
          service: metric.service,
          metric: 'cpu_utilization',
          value: metric.cpu,
          unit: 'percent',
          labels: { hostname: metric.hostname },
          context: {}
        },
        {
          id: this.generateMetricId(),
          timestamp: metric.timestamp,
          service: metric.service,
          metric: 'memory_utilization',
          value: metric.memory,
          unit: 'percent',
          labels: { hostname: metric.hostname },
          context: {}
        },
        {
          id: this.generateMetricId(),
          timestamp: metric.timestamp,
          service: metric.service,
          metric: 'disk_utilization',
          value: metric.disk,
          unit: 'percent',
          labels: { hostname: metric.hostname },
          context: {}
        }
      ];

      for (const metricData of metrics) {
        await this.bufferMetric(metricData);
      }

      this.logger.debug('System metrics recorded', {
        hostname: metric.hostname,
        cpu: metric.cpu,
        memory: metric.memory,
        disk: metric.disk
      });

      this.emit('systemMetric', metric);

    } catch (error) {
      this.logger.error('Failed to record system metric', {
        error: error instanceof Error ? error.message : 'Unknown error',
        hostname: metric.hostname
      });
    }
  }

  /**
   * Record database performance metric
   */
  async recordDatabaseMetric(metric: DatabaseMetric): Promise<void> {
    try {
      // Apply sampling
      if (Math.random() > this.config.sampling.databaseMetrics) {
        return;
      }

      const metricData: MetricData = {
        id: this.generateMetricId(),
        timestamp: metric.timestamp,
        correlationId: metric.correlationId,
        service: 'database',
        metric: 'query_duration',
        value: metric.queryDuration,
        unit: 'milliseconds',
        labels: {
          query_type: metric.queryType,
          table: metric.table || 'unknown',
          cache_hit: metric.cacheHit.toString()
        },
        context: {}
      };

      await this.bufferMetric(metricData);

      // Log slow queries
      if (metric.queryDuration > 1000) { // Log queries over 1 second
        this.logger.warn('Slow database query detected', {
          correlationId: metric.correlationId,
          duration: metric.queryDuration,
          queryType: metric.queryType,
          table: metric.table,
          cacheHit: metric.cacheHit
        });
      }

      this.emit('databaseMetric', metricData);

    } catch (error) {
      this.logger.error('Failed to record database metric', {
        error: error instanceof Error ? error.message : 'Unknown error',
        correlationId: metric.correlationId
      });
    }
  }

  /**
   * Record custom application metric
   */
  async recordCustomMetric(metric: CustomMetric): Promise<void> {
    try {
      const metricData: MetricData = {
        id: this.generateMetricId(),
        timestamp: metric.timestamp,
        service: 'application',
        metric: metric.name,
        value: metric.value,
        unit: this.getUnitForType(metric.type),
        labels: metric.labels,
        context: {}
      };

      await this.bufferMetric(metricData);

      this.logger.debug('Custom metric recorded', {
        name: metric.name,
        value: metric.value,
        type: metric.type,
        labels: metric.labels
      });

      this.emit('customMetric', metricData);

    } catch (error) {
      this.logger.error('Failed to record custom metric', {
        error: error instanceof Error ? error.message : 'Unknown error',
        metricName: metric.name
      });
    }
  }

  /**
   * Buffer metric for aggregation
   */
  private async bufferMetric(metric: MetricData): Promise<void> {
    const key = `${metric.service}:${metric.metric}`;
    
    if (!this.metricsBuffer.has(key)) {
      this.metricsBuffer.set(key, []);
    }

    const buffer = this.metricsBuffer.get(key)!;
    buffer.push(metric);

    // Limit buffer size
    if (buffer.length > this.config.aggregation.bufferSize) {
      buffer.splice(0, buffer.length - this.config.aggregation.bufferSize);
    }

    // Update aggregation
    await this.updateAggregation(key, metric);
  }

  /**
   * Update real-time aggregation
   */
  private async updateAggregation(key: string, metric: MetricData): Promise<void> {
    if (!this.aggregationBuffer.has(key)) {
      this.aggregationBuffer.set(key, {
        key,
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        avg: 0,
        p95: 0,
        p99: 0,
        lastUpdated: Date.now(),
        values: []
      });
    }

    const aggregation = this.aggregationBuffer.get(key)!;
    
    aggregation.count++;
    aggregation.sum += metric.value;
    aggregation.min = Math.min(aggregation.min, metric.value);
    aggregation.max = Math.max(aggregation.max, metric.value);
    aggregation.avg = aggregation.sum / aggregation.count;
    aggregation.lastUpdated = Date.now();

    // Keep track of values for percentile calculation
    aggregation.values.push(metric.value);
    if (aggregation.values.length > 1000) {
      aggregation.values = aggregation.values.slice(-500);
    }

    // Calculate percentiles
    if (aggregation.values.length > 10) {
      const sorted = [...aggregation.values].sort((a, b) => a - b);
      aggregation.p95 = sorted[Math.floor(sorted.length * 0.95)];
      aggregation.p99 = sorted[Math.floor(sorted.length * 0.99)];
    }
  }

  /**
   * Record derived metrics from performance data
   */
  private async recordDerivedMetrics(metric: PerformanceMetric): Promise<void> {
    // Request rate metric
    await this.recordCustomMetric({
      name: 'request_rate',
      value: 1,
      type: 'counter',
      labels: {
        endpoint: metric.endpoint,
        method: metric.method
      },
      timestamp: metric.timestamp
    });

    // Error rate metric
    if (metric.statusCode >= 400) {
      await this.recordCustomMetric({
        name: 'error_rate',
        value: 1,
        type: 'counter',
        labels: {
          endpoint: metric.endpoint,
          method: metric.method,
          status_code: metric.statusCode.toString()
        },
        timestamp: metric.timestamp
      });
    }

    // Response size metric
    if (metric.responseSize) {
      await this.recordCustomMetric({
        name: 'response_size',
        value: metric.responseSize,
        type: 'histogram',
        labels: {
          endpoint: metric.endpoint,
          method: metric.method
        },
        timestamp: metric.timestamp
      });
    }
  }

  /**
   * Flush metrics to Redis storage
   */
  private async flushMetrics(): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      const now = Date.now();

      for (const [key, aggregation] of this.aggregationBuffer.entries()) {
        const metricKey = `${this.config.redis.keyPrefix}:${key}:${Math.floor(now / 60000)}`;
        
        pipeline.hset(metricKey, {
          timestamp: now,
          count: aggregation.count,
          sum: aggregation.sum,
          min: aggregation.min,
          max: aggregation.max,
          avg: aggregation.avg,
          p95: aggregation.p95,
          p99: aggregation.p99
        });

        pipeline.expire(metricKey, this.config.redis.retention);
      }

      await pipeline.exec();

      // Clear aggregation buffer
      this.aggregationBuffer.clear();

      this.logger.debug('Metrics flushed to Redis', {
        metricsCount: this.aggregationBuffer.size,
        timestamp: now
      });

    } catch (error) {
      this.logger.error('Failed to flush metrics to Redis', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get real-time metrics summary
   */
  async getMetricsSummary(): Promise<Record<string, AggregatedMetric>> {
    const summary: Record<string, AggregatedMetric> = {};
    
    for (const [key, aggregation] of this.aggregationBuffer.entries()) {
      summary[key] = { ...aggregation };
    }

    return summary;
  }

  /**
   * Get historical metrics from Redis
   */
  async getHistoricalMetrics(
    metricKey: string,
    startTime: number,
    endTime: number
  ): Promise<AggregatedMetric[]> {
    try {
      const startMinute = Math.floor(startTime / 60000);
      const endMinute = Math.floor(endTime / 60000);
      const metrics: AggregatedMetric[] = [];

      for (let minute = startMinute; minute <= endMinute; minute++) {
        const key = `${this.config.redis.keyPrefix}:${metricKey}:${minute}`;
        const data = await this.redis.hgetall(key);
        
        if (Object.keys(data).length > 0) {
          metrics.push({
            key: metricKey,
            count: parseInt(data.count) || 0,
            sum: parseFloat(data.sum) || 0,
            min: parseFloat(data.min) || 0,
            max: parseFloat(data.max) || 0,
            avg: parseFloat(data.avg) || 0,
            p95: parseFloat(data.p95) || 0,
            p99: parseFloat(data.p99) || 0,
            lastUpdated: parseInt(data.timestamp) || 0,
            values: []
          });
        }
      }

      return metrics;

    } catch (error) {
      this.logger.error('Failed to get historical metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        metricKey,
        startTime,
        endTime
      });
      return [];
    }
  }

  /**
   * Generate correlation ID for request tracking
   */
  generateCorrelationId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create middleware for Express.js request tracking
   */
  createExpressMiddleware() {
    return (req: any, res: any, next: any) => {
      const startTime = Date.now();
      const correlationId = req.headers['x-correlation-id'] || this.generateCorrelationId();
      
      // Add correlation ID to request
      req.correlationId = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);

      // Override res.end to capture metrics
      const originalEnd = res.end;
      res.end = (...args: any[]) => {
        const duration = Date.now() - startTime;
        const responseSize = res.get('content-length') || 0;

        this.recordPerformanceMetric({
          requestDuration: duration,
          responseSize: parseInt(responseSize),
          statusCode: res.statusCode,
          endpoint: req.route?.path || req.path,
          method: req.method,
          timestamp: startTime,
          correlationId,
          userId: req.user?.id,
          sessionId: req.sessionID
        });

        originalEnd.apply(res, args);
      };

      next();
    };
  }

  // Utility methods
  private generateMetricId(): string {
    return `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getUnitForType(type: string): string {
    switch (type) {
      case 'counter': return 'count';
      case 'gauge': return 'value';
      case 'histogram': return 'distribution';
      case 'timer': return 'milliseconds';
      default: return 'value';
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down metrics collector...');

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Final flush
    await this.flushMetrics();

    // Close Redis connection
    await this.redis.disconnect();

    this.logger.info('Metrics collector shutdown complete');
  }
}

interface AggregatedMetric {
  key: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
  p99: number;
  lastUpdated: number;
  values: number[];
}

export default MetricsCollector;