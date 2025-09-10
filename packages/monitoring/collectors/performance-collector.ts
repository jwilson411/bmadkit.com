import { EventEmitter } from 'events';
import * as Sentry from '@sentry/node';
import winston from 'winston';
import Redis from 'ioredis';

/**
 * Error Tracking and Performance Collection Service
 * Comprehensive error monitoring with automated classification and Sentry integration
 */

export interface ErrorEvent {
  id: string;
  timestamp: number;
  correlationId?: string;
  level: 'error' | 'warning' | 'fatal' | 'info';
  message: string;
  stack?: string;
  fingerprint?: string;
  context: ErrorContext;
  tags: Record<string, string>;
  extra: Record<string, any>;
  user?: UserContext;
  request?: RequestContext;
  environment: string;
  release?: string;
  classification: ErrorClassification;
  resolution?: ErrorResolution;
}

export interface ErrorContext {
  service: string;
  module: string;
  function?: string;
  line?: number;
  column?: number;
  file?: string;
  component?: string;
}

export interface UserContext {
  id: string;
  email?: string;
  username?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface RequestContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, any>;
  body?: any;
  statusCode?: number;
  responseTime?: number;
}

export interface ErrorClassification {
  category: 'application' | 'system' | 'network' | 'database' | 'external' | 'user';
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  priority: number;
  automated: boolean;
  confidence: number;
}

export interface ErrorResolution {
  status: 'new' | 'acknowledged' | 'resolved' | 'ignored';
  assignedTo?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  resolution?: string;
  timeToResolve?: number;
}

export interface ErrorPattern {
  id: string;
  fingerprint: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  frequency: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  impact: ErrorImpact;
  affectedUsers: string[];
  relatedErrors: string[];
}

export interface ErrorImpact {
  userCount: number;
  sessionCount: number;
  requestCount: number;
  revenue?: number;
  businessMetric?: string;
}

export interface PerformanceEvent {
  id: string;
  timestamp: number;
  correlationId: string;
  type: 'web_vital' | 'api_call' | 'database_query' | 'external_call';
  metric: string;
  value: number;
  unit: string;
  context: PerformanceContext;
  thresholds: PerformanceThreshold;
  anomaly?: AnomalyDetection;
}

export interface PerformanceContext {
  service: string;
  endpoint?: string;
  method?: string;
  userId?: string;
  sessionId?: string;
  browser?: string;
  device?: string;
  connection?: string;
  region?: string;
}

export interface PerformanceThreshold {
  warning: number;
  critical: number;
  target: number;
}

export interface AnomalyDetection {
  detected: boolean;
  confidence: number;
  baseline: number;
  deviation: number;
  reason: string;
}

/**
 * Error Tracking and Performance Collector
 * Integrates with Sentry for comprehensive error monitoring and performance tracking
 */
export class PerformanceCollector extends EventEmitter {
  private redis: Redis;
  private logger: winston.Logger;
  private sentryInitialized: boolean = false;
  private errorPatterns: Map<string, ErrorPattern> = new Map();
  private errorClassifier: ErrorClassifier;
  private anomalyDetector: AnomalyDetector;

  constructor(
    private config: {
      sentry: {
        dsn: string;
        environment: string;
        release?: string;
        sampleRate: number;
        tracesSampleRate: number;
      };
      redis: {
        url: string;
        keyPrefix: string;
      };
      classification: {
        autoClassify: boolean;
        confidenceThreshold: number;
      };
      anomalyDetection: {
        enabled: boolean;
        sensitivity: number;
        windowSize: number;
      };
    }
  ) {
    super();
    
    this.initializeRedis();
    this.initializeLogger();
    this.initializeSentry();
    this.errorClassifier = new ErrorClassifier();
    this.anomalyDetector = new AnomalyDetector(config.anomalyDetection);
    
    this.startErrorPatternAnalysis();
    this.startPerformanceMonitoring();
  }

  /**
   * Initialize Redis connection
   */
  private initializeRedis(): void {
    this.redis = new Redis(this.config.redis.url, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.redis.on('error', (error) => {
      console.error('Performance Collector Redis error:', error);
    });
  }

  /**
   * Initialize structured logging
   */
  private initializeLogger(): void {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'performance-collector' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({
          filename: 'logs/performance-collector.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Initialize Sentry integration
   */
  private initializeSentry(): void {
    try {
      Sentry.init({
        dsn: this.config.sentry.dsn,
        environment: this.config.sentry.environment,
        release: this.config.sentry.release,
        sampleRate: this.config.sentry.sampleRate,
        tracesSampleRate: this.config.sentry.tracesSampleRate,
        integrations: [
          new Sentry.Integrations.Http({ tracing: true }),
          new Sentry.Integrations.Console(),
          new Sentry.Integrations.OnUncaughtException(),
          new Sentry.Integrations.OnUnhandledRejection()
        ],
        beforeSend: (event, hint) => {
          return this.processSentryEvent(event, hint);
        }
      });

      this.sentryInitialized = true;
      this.logger.info('Sentry initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize Sentry', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process Sentry events before sending
   */
  private processSentryEvent(event: any, hint?: any): any {
    // Add custom context and filtering
    if (event.exception) {
      // Classify error automatically
      const classification = this.errorClassifier.classifyError(event);
      event.tags = { ...event.tags, ...classification.tags };
      event.level = this.mapSeverityToSentryLevel(classification.severity);
    }

    // Filter out noise
    if (this.shouldFilterError(event)) {
      return null;
    }

    return event;
  }

  /**
   * Record error event
   */
  async recordError(error: Error | string, context?: Partial<ErrorContext>): Promise<string> {
    const errorId = this.generateErrorId();
    const timestamp = Date.now();

    // Create error event
    const errorEvent: ErrorEvent = {
      id: errorId,
      timestamp,
      level: 'error',
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      context: {
        service: 'unknown',
        module: 'unknown',
        ...context
      },
      tags: {},
      extra: {},
      environment: this.config.sentry.environment,
      release: this.config.sentry.release,
      classification: {
        category: 'application',
        type: 'unknown',
        severity: 'medium',
        priority: 5,
        automated: false,
        confidence: 0
      }
    };

    // Auto-classify error if enabled
    if (this.config.classification.autoClassify) {
      errorEvent.classification = await this.errorClassifier.classify(errorEvent);
    }

    // Generate fingerprint for grouping
    errorEvent.fingerprint = this.generateErrorFingerprint(errorEvent);

    // Update error patterns
    await this.updateErrorPattern(errorEvent);

    // Store error
    await this.storeError(errorEvent);

    // Send to Sentry
    if (this.sentryInitialized) {
      Sentry.captureException(error instanceof Error ? error : new Error(error), {
        tags: errorEvent.tags,
        extra: errorEvent.extra,
        contexts: {
          performance: errorEvent.context
        }
      });
    }

    // Log error
    this.logger.error('Error recorded', {
      errorId,
      message: errorEvent.message,
      classification: errorEvent.classification,
      fingerprint: errorEvent.fingerprint
    });

    // Emit for real-time processing
    this.emit('errorRecorded', errorEvent);

    // Check if critical error requires immediate alerting
    if (errorEvent.classification.severity === 'critical') {
      this.emit('criticalError', errorEvent);
    }

    return errorId;
  }

  /**
   * Record performance event
   */
  async recordPerformance(event: Omit<PerformanceEvent, 'id' | 'timestamp'>): Promise<string> {
    const performanceId = this.generatePerformanceId();
    const timestamp = Date.now();

    const performanceEvent: PerformanceEvent = {
      id: performanceId,
      timestamp,
      ...event
    };

    // Detect anomalies
    if (this.config.anomalyDetection.enabled) {
      performanceEvent.anomaly = await this.anomalyDetector.detect(performanceEvent);
      
      if (performanceEvent.anomaly.detected) {
        this.logger.warn('Performance anomaly detected', {
          performanceId,
          metric: event.metric,
          value: event.value,
          baseline: performanceEvent.anomaly.baseline,
          deviation: performanceEvent.anomaly.deviation
        });

        this.emit('performanceAnomaly', performanceEvent);
      }
    }

    // Store performance event
    await this.storePerformanceEvent(performanceEvent);

    // Check thresholds
    if (event.value > event.thresholds.critical) {
      this.emit('performanceCritical', performanceEvent);
    } else if (event.value > event.thresholds.warning) {
      this.emit('performanceWarning', performanceEvent);
    }

    // Send to Sentry as performance monitoring
    if (this.sentryInitialized && event.type === 'web_vital') {
      Sentry.addBreadcrumb({
        category: 'performance',
        message: `${event.metric}: ${event.value}${event.unit}`,
        level: 'info',
        data: {
          metric: event.metric,
          value: event.value,
          unit: event.unit,
          thresholds: event.thresholds
        }
      });
    }

    this.emit('performanceRecorded', performanceEvent);
    return performanceId;
  }

  /**
   * Record Web Vitals
   */
  async recordWebVital(
    metric: 'FCP' | 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'TTI',
    value: number,
    context: PerformanceContext
  ): Promise<string> {
    const thresholds = this.getWebVitalThresholds(metric);
    
    return this.recordPerformance({
      correlationId: context.sessionId || this.generateCorrelationId(),
      type: 'web_vital',
      metric,
      value,
      unit: this.getWebVitalUnit(metric),
      context,
      thresholds
    });
  }

  /**
   * Start error pattern analysis
   */
  private startErrorPatternAnalysis(): void {
    setInterval(async () => {
      try {
        await this.analyzeErrorPatterns();
      } catch (error) {
        this.logger.error('Error pattern analysis failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Analyze error patterns for trends and impacts
   */
  private async analyzeErrorPatterns(): Promise<void> {
    for (const [fingerprint, pattern] of this.errorPatterns.entries()) {
      // Calculate frequency and trend
      const timeWindow = 3600000; // 1 hour
      const now = Date.now();
      
      if (now - pattern.lastSeen > timeWindow * 24) {
        // Remove old patterns
        this.errorPatterns.delete(fingerprint);
        continue;
      }

      // Update trend analysis
      const previousFrequency = pattern.frequency;
      pattern.frequency = pattern.count / ((now - pattern.firstSeen) / 3600000); // errors per hour
      
      if (pattern.frequency > previousFrequency * 1.5) {
        pattern.trend = 'increasing';
        
        // Emit pattern alert if significant increase
        if (pattern.frequency > 10) { // More than 10 errors per hour
          this.emit('errorPatternAlert', {
            pattern,
            alert: 'Error frequency increasing rapidly'
          });
        }
      } else if (pattern.frequency < previousFrequency * 0.5) {
        pattern.trend = 'decreasing';
      } else {
        pattern.trend = 'stable';
      }

      // Calculate business impact
      await this.calculateErrorImpact(pattern);
    }
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    // Monitor for performance regressions
    setInterval(async () => {
      try {
        await this.analyzePerformanceTrends();
      } catch (error) {
        this.logger.error('Performance trend analysis failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 600000); // Every 10 minutes
  }

  /**
   * Analyze performance trends
   */
  private async analyzePerformanceTrends(): Promise<void> {
    // Get recent performance data
    const metrics = ['FCP', 'LCP', 'FID', 'CLS', 'TTFB', 'TTI'];
    
    for (const metric of metrics) {
      const trend = await this.calculatePerformanceTrend(metric);
      
      if (trend.regression) {
        this.emit('performanceRegression', {
          metric,
          trend,
          alert: `${metric} performance regression detected`
        });
      }
    }
  }

  /**
   * Update error pattern tracking
   */
  private async updateErrorPattern(errorEvent: ErrorEvent): Promise<void> {
    const fingerprint = errorEvent.fingerprint!;
    
    if (!this.errorPatterns.has(fingerprint)) {
      this.errorPatterns.set(fingerprint, {
        id: this.generatePatternId(),
        fingerprint,
        count: 0,
        firstSeen: errorEvent.timestamp,
        lastSeen: errorEvent.timestamp,
        frequency: 0,
        trend: 'stable',
        impact: {
          userCount: 0,
          sessionCount: 0,
          requestCount: 0
        },
        affectedUsers: [],
        relatedErrors: []
      });
    }

    const pattern = this.errorPatterns.get(fingerprint)!;
    pattern.count++;
    pattern.lastSeen = errorEvent.timestamp;
    
    // Track affected users
    if (errorEvent.user?.id && !pattern.affectedUsers.includes(errorEvent.user.id)) {
      pattern.affectedUsers.push(errorEvent.user.id);
      pattern.impact.userCount = pattern.affectedUsers.length;
    }

    // Store pattern update in Redis
    await this.storeErrorPattern(pattern);
  }

  /**
   * Calculate error business impact
   */
  private async calculateErrorImpact(pattern: ErrorPattern): Promise<void> {
    // This would integrate with business metrics to calculate revenue impact
    // For now, use simplified impact calculation
    
    if (pattern.affectedUsers.length > 100) {
      pattern.impact.revenue = pattern.affectedUsers.length * 10; // $10 per affected user estimate
    }

    pattern.impact.sessionCount = Math.floor(pattern.count * 1.2); // Estimate sessions affected
    pattern.impact.requestCount = pattern.count;
  }

  /**
   * Calculate performance trend
   */
  private async calculatePerformanceTrend(metric: string): Promise<any> {
    // Get historical performance data for the metric
    const timeWindow = 7 * 24 * 3600 * 1000; // 7 days
    const now = Date.now();
    const startTime = now - timeWindow;

    // This would query actual performance data from Redis
    const historicalData = await this.getPerformanceHistory(metric, startTime, now);
    
    // Calculate trend (simplified implementation)
    if (historicalData.length < 10) {
      return { regression: false, trend: 'insufficient_data' };
    }

    const recent = historicalData.slice(-24); // Last 24 hours
    const baseline = historicalData.slice(0, 24); // First 24 hours

    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const baselineAvg = baseline.reduce((sum, val) => sum + val, 0) / baseline.length;

    const regression = recentAvg > baselineAvg * 1.2; // 20% regression threshold

    return {
      regression,
      recentAvg,
      baselineAvg,
      change: ((recentAvg - baselineAvg) / baselineAvg) * 100
    };
  }

  // Storage methods
  private async storeError(errorEvent: ErrorEvent): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:errors:${errorEvent.id}`;
    await this.redis.setex(key, 86400 * 7, JSON.stringify(errorEvent)); // 7 days retention
  }

  private async storePerformanceEvent(event: PerformanceEvent): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:performance:${event.id}`;
    await this.redis.setex(key, 86400 * 30, JSON.stringify(event)); // 30 days retention
    
    // Also store in time series for trend analysis
    const timeseriesKey = `${this.config.redis.keyPrefix}:metrics:${event.metric}:${Math.floor(event.timestamp / 60000)}`;
    await this.redis.setex(timeseriesKey, 86400 * 30, event.value);
  }

  private async storeErrorPattern(pattern: ErrorPattern): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:patterns:${pattern.fingerprint}`;
    await this.redis.setex(key, 86400 * 30, JSON.stringify(pattern)); // 30 days retention
  }

  // Utility methods
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePerformanceId(): string {
    return `perf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePatternId(): string {
    return `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateErrorFingerprint(errorEvent: ErrorEvent): string {
    const crypto = require('crypto');
    const fingerprintData = `${errorEvent.message}:${errorEvent.context.service}:${errorEvent.context.module}`;
    return crypto.createHash('md5').update(fingerprintData).digest('hex');
  }

  private shouldFilterError(event: any): boolean {
    // Filter out common noise
    const noisyMessages = [
      'Script error',
      'Network request failed',
      'ChunkLoadError',
      'Loading chunk'
    ];

    return noisyMessages.some(noise => 
      event.exception?.values?.[0]?.value?.includes(noise)
    );
  }

  private mapSeverityToSentryLevel(severity: string): any {
    switch (severity) {
      case 'critical': return 'fatal';
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'error';
    }
  }

  private getWebVitalThresholds(metric: string): PerformanceThreshold {
    const thresholds: Record<string, PerformanceThreshold> = {
      'FCP': { target: 1800, warning: 3000, critical: 4000 },
      'LCP': { target: 2500, warning: 4000, critical: 5000 },
      'FID': { target: 100, warning: 300, critical: 500 },
      'CLS': { target: 0.1, warning: 0.25, critical: 0.4 },
      'TTFB': { target: 600, warning: 1000, critical: 1500 },
      'TTI': { target: 3800, warning: 7300, critical: 10000 }
    };

    return thresholds[metric] || { target: 0, warning: 0, critical: 0 };
  }

  private getWebVitalUnit(metric: string): string {
    return ['FCP', 'LCP', 'FID', 'TTFB', 'TTI'].includes(metric) ? 'ms' : 'score';
  }

  private async getPerformanceHistory(metric: string, startTime: number, endTime: number): Promise<number[]> {
    // Mock implementation - would query actual Redis time series data
    const data = [];
    for (let i = 0; i < 48; i++) { // 48 hours of hourly data
      data.push(Math.random() * 1000 + 500); // Random values between 500-1500
    }
    return data;
  }

  // Public API methods
  async getErrorsByPattern(limit: number = 50): Promise<ErrorPattern[]> {
    return Array.from(this.errorPatterns.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getErrorStats(timeWindow: number = 3600000): Promise<any> {
    const now = Date.now();
    const cutoff = now - timeWindow;
    
    let totalErrors = 0;
    let criticalErrors = 0;
    let affectedUsers = new Set<string>();

    for (const pattern of this.errorPatterns.values()) {
      if (pattern.lastSeen > cutoff) {
        totalErrors += pattern.count;
        pattern.affectedUsers.forEach(userId => affectedUsers.add(userId));
        
        // Assuming critical patterns have high frequency
        if (pattern.frequency > 10) {
          criticalErrors += pattern.count;
        }
      }
    }

    return {
      totalErrors,
      criticalErrors,
      affectedUsers: affectedUsers.size,
      errorRate: totalErrors / (timeWindow / 3600000), // errors per hour
      patterns: this.errorPatterns.size
    };
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down performance collector...');
    
    if (this.sentryInitialized) {
      await Sentry.flush();
    }
    
    await this.redis.disconnect();
    this.logger.info('Performance collector shutdown complete');
  }
}

/**
 * Error Classification Service
 * Automatically classifies errors for prioritization and routing
 */
class ErrorClassifier {
  private classificationRules: Map<string, any> = new Map();

  constructor() {
    this.initializeRules();
  }

  private initializeRules(): void {
    // Database errors
    this.classificationRules.set('database', {
      patterns: [
        /connection.*timeout/i,
        /query.*timeout/i,
        /deadlock/i,
        /constraint.*violation/i
      ],
      category: 'database',
      severity: 'high',
      priority: 8
    });

    // Network errors
    this.classificationRules.set('network', {
      patterns: [
        /network.*error/i,
        /timeout/i,
        /connection.*refused/i,
        /dns.*error/i
      ],
      category: 'network',
      severity: 'medium',
      priority: 6
    });

    // Authentication errors
    this.classificationRules.set('auth', {
      patterns: [
        /unauthorized/i,
        /forbidden/i,
        /authentication.*failed/i,
        /invalid.*token/i
      ],
      category: 'application',
      severity: 'high',
      priority: 7
    });

    // Validation errors
    this.classificationRules.set('validation', {
      patterns: [
        /validation.*error/i,
        /invalid.*input/i,
        /missing.*required/i
      ],
      category: 'user',
      severity: 'low',
      priority: 3
    });
  }

  async classify(errorEvent: ErrorEvent): Promise<ErrorClassification> {
    const message = errorEvent.message.toLowerCase();
    
    for (const [type, rule] of this.classificationRules.entries()) {
      for (const pattern of rule.patterns) {
        if (pattern.test(message)) {
          return {
            category: rule.category,
            type,
            severity: rule.severity,
            priority: rule.priority,
            automated: true,
            confidence: 0.8
          };
        }
      }
    }

    // Default classification for unmatched errors
    return {
      category: 'application',
      type: 'unknown',
      severity: 'medium',
      priority: 5,
      automated: true,
      confidence: 0.3
    };
  }

  classifyError(event: any): { tags: Record<string, string>; severity: string } {
    const errorValue = event.exception?.values?.[0]?.value || '';
    const classification = this.getQuickClassification(errorValue);
    
    return {
      tags: {
        error_category: classification.category,
        error_type: classification.type
      },
      severity: classification.severity
    };
  }

  private getQuickClassification(errorValue: string): any {
    const lowerValue = errorValue.toLowerCase();
    
    if (lowerValue.includes('database') || lowerValue.includes('sql')) {
      return { category: 'database', type: 'database_error', severity: 'high' };
    }
    
    if (lowerValue.includes('network') || lowerValue.includes('timeout')) {
      return { category: 'network', type: 'network_error', severity: 'medium' };
    }
    
    if (lowerValue.includes('unauthorized') || lowerValue.includes('forbidden')) {
      return { category: 'auth', type: 'auth_error', severity: 'high' };
    }
    
    return { category: 'application', type: 'unknown', severity: 'medium' };
  }
}

/**
 * Anomaly Detection Service
 * Detects performance anomalies using statistical analysis
 */
class AnomalyDetector {
  private baselines: Map<string, number[]> = new Map();

  constructor(private config: { sensitivity: number; windowSize: number }) {}

  async detect(event: PerformanceEvent): Promise<AnomalyDetection> {
    const key = `${event.metric}:${event.context.service}`;
    
    if (!this.baselines.has(key)) {
      this.baselines.set(key, []);
    }

    const baseline = this.baselines.get(key)!;
    baseline.push(event.value);

    // Keep only recent values for baseline
    if (baseline.length > this.config.windowSize) {
      baseline.splice(0, baseline.length - this.config.windowSize);
    }

    // Need at least 10 values for anomaly detection
    if (baseline.length < 10) {
      return {
        detected: false,
        confidence: 0,
        baseline: 0,
        deviation: 0,
        reason: 'Insufficient baseline data'
      };
    }

    // Calculate statistics
    const mean = baseline.reduce((sum, val) => sum + val, 0) / baseline.length;
    const variance = baseline.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / baseline.length;
    const stdDev = Math.sqrt(variance);

    // Z-score based anomaly detection
    const zScore = Math.abs((event.value - mean) / stdDev);
    const threshold = 2 + (this.config.sensitivity / 10); // Configurable threshold

    const detected = zScore > threshold;
    const confidence = Math.min(zScore / threshold, 1);

    return {
      detected,
      confidence,
      baseline: mean,
      deviation: event.value - mean,
      reason: detected ? `Value deviates ${zScore.toFixed(2)} standard deviations from baseline` : 'Within normal range'
    };
  }
}

export default PerformanceCollector;