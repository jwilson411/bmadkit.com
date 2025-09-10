import { EventEmitter } from 'events';

/**
 * Performance Monitoring System with Real-time Metrics
 * Comprehensive monitoring for maintaining sub-3-second page load times under peak load
 */

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  source: string;
  labels: Record<string, string>;
  threshold?: PerformanceThreshold;
}

export interface PerformanceThreshold {
  warning: number;
  critical: number;
  direction: 'above' | 'below';
}

export interface WebVitalsMetric {
  sessionId: string;
  userId?: string;
  url: string;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  firstInputDelay: number;
  cumulativeLayoutShift: number;
  timeToFirstByte: number;
  timeToInteractive: number;
  totalBlockingTime: number;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  connection: string;
  timestamp: number;
}

export interface SystemMetric {
  cpu: ResourceMetric;
  memory: ResourceMetric;
  disk: ResourceMetric;
  network: NetworkMetric;
  timestamp: number;
}

export interface ResourceMetric {
  usage: number;
  available: number;
  utilization: number;
}

export interface NetworkMetric {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
  errors: number;
  latency: number;
}

export interface DatabaseMetric {
  connections: ConnectionMetric;
  queries: QueryMetric;
  performance: DatabasePerformanceMetric;
  timestamp: number;
}

export interface ConnectionMetric {
  active: number;
  idle: number;
  total: number;
  maxConnections: number;
}

export interface QueryMetric {
  totalQueries: number;
  slowQueries: number;
  failedQueries: number;
  averageResponseTime: number;
  qps: number;
}

export interface DatabasePerformanceMetric {
  cacheHitRatio: number;
  indexUsage: number;
  lockWaitTime: number;
  replicationLag: number;
}

export interface ApplicationMetric {
  requests: RequestMetric;
  responses: ResponseMetric;
  errors: ErrorMetric;
  sessions: SessionMetric;
  timestamp: number;
}

export interface RequestMetric {
  total: number;
  rps: number;
  concurrent: number;
  queueDepth: number;
}

export interface ResponseMetric {
  averageTime: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
}

export interface ErrorMetric {
  total: number;
  rate: number;
  byStatus: Record<string, number>;
  byEndpoint: Record<string, number>;
}

export interface SessionMetric {
  active: number;
  created: number;
  expired: number;
  averageDuration: number;
}

export interface AlertRule {
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  duration: number;
  severity: 'info' | 'warning' | 'critical';
  channels: string[];
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  rule: string;
  severity: string;
  message: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  metadata: Record<string, any>;
}

/**
 * Real-time Performance Monitor
 * Collects, analyzes, and alerts on system performance metrics
 */
export class PerformanceMonitor extends EventEmitter {
  private metricsBuffer: Map<string, PerformanceMetric[]>;
  private webVitalsBuffer: WebVitalsMetric[];
  private systemMetrics: SystemMetric[];
  private databaseMetrics: DatabaseMetric[];
  private applicationMetrics: ApplicationMetric[];
  private alertRules: Map<string, AlertRule>;
  private activeAlerts: Map<string, AlertEvent>;
  private collectors: Map<string, MetricsCollector>;
  private analyzers: Map<string, MetricsAnalyzer>;

  constructor() {
    super();
    
    this.metricsBuffer = new Map();
    this.webVitalsBuffer = [];
    this.systemMetrics = [];
    this.databaseMetrics = [];
    this.applicationMetrics = [];
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.collectors = new Map();
    this.analyzers = new Map();

    this.initializeCollectors();
    this.initializeAnalyzers();
    this.setupDefaultAlerts();
  }

  /**
   * Initialize performance monitoring system
   */
  async initialize(): Promise<void> {
    console.log('Initializing performance monitoring system...');

    // Start metrics collection
    this.startSystemMetricsCollection();
    this.startWebVitalsCollection();
    this.startDatabaseMetricsCollection();
    this.startApplicationMetricsCollection();

    // Start analysis and alerting
    this.startMetricsAnalysis();
    this.startAlertProcessing();
    this.startPerformanceBudgetMonitoring();

    // Start data retention cleanup
    this.startDataRetentionCleanup();

    console.log('Performance monitoring system initialized');
    this.emit('monitoringStarted');
  }

  /**
   * Initialize metrics collectors
   */
  private initializeCollectors(): void {
    this.collectors.set('system', new SystemMetricsCollector());
    this.collectors.set('database', new DatabaseMetricsCollector());
    this.collectors.set('application', new ApplicationMetricsCollector());
    this.collectors.set('webvitals', new WebVitalsCollector());
    this.collectors.set('redis', new RedisMetricsCollector());
    this.collectors.set('cdn', new CDNMetricsCollector());
  }

  /**
   * Initialize metrics analyzers
   */
  private initializeAnalyzers(): void {
    this.analyzers.set('performance', new PerformanceAnalyzer());
    this.analyzers.set('anomaly', new AnomalyDetector());
    this.analyzers.set('trend', new TrendAnalyzer());
    this.analyzers.set('capacity', new CapacityPlanner());
  }

  /**
   * Set up default alert rules
   */
  private setupDefaultAlerts(): void {
    const defaultAlerts: AlertRule[] = [
      {
        name: 'High Response Time',
        metric: 'response_time_p95',
        condition: 'above',
        threshold: 3000,
        duration: 300,
        severity: 'critical',
        channels: ['slack', 'email', 'pagerduty'],
        enabled: true
      },
      {
        name: 'High Error Rate',
        metric: 'error_rate',
        condition: 'above',
        threshold: 0.05,
        duration: 120,
        severity: 'critical',
        channels: ['slack', 'pagerduty'],
        enabled: true
      },
      {
        name: 'Low Cache Hit Rate',
        metric: 'cache_hit_rate',
        condition: 'below',
        threshold: 0.8,
        duration: 600,
        severity: 'warning',
        channels: ['slack'],
        enabled: true
      },
      {
        name: 'High CPU Usage',
        metric: 'cpu_utilization',
        condition: 'above',
        threshold: 80,
        duration: 300,
        severity: 'warning',
        channels: ['slack', 'email'],
        enabled: true
      },
      {
        name: 'High Memory Usage',
        metric: 'memory_utilization',
        condition: 'above',
        threshold: 85,
        duration: 300,
        severity: 'warning',
        channels: ['slack', 'email'],
        enabled: true
      },
      {
        name: 'Database Connection Pool Exhaustion',
        metric: 'db_connections_utilization',
        condition: 'above',
        threshold: 90,
        duration: 60,
        severity: 'critical',
        channels: ['slack', 'pagerduty'],
        enabled: true
      },
      {
        name: 'Large Contentful Paint Degradation',
        metric: 'lcp_p95',
        condition: 'above',
        threshold: 2500,
        duration: 600,
        severity: 'warning',
        channels: ['slack'],
        enabled: true
      },
      {
        name: 'Session Creation Rate Spike',
        metric: 'session_creation_rate',
        condition: 'above',
        threshold: 100,
        duration: 120,
        severity: 'info',
        channels: ['slack'],
        enabled: true
      }
    ];

    defaultAlerts.forEach(alert => {
      this.alertRules.set(alert.name, alert);
    });
  }

  /**
   * Start system metrics collection
   */
  private startSystemMetricsCollection(): void {
    const collector = this.collectors.get('system')!;
    
    setInterval(async () => {
      try {
        const metrics = await collector.collect();
        this.systemMetrics.push(metrics as SystemMetric);
        
        // Keep only last 1000 entries
        if (this.systemMetrics.length > 1000) {
          this.systemMetrics = this.systemMetrics.slice(-500);
        }

        this.emit('systemMetricsCollected', metrics);
      } catch (error) {
        console.error('System metrics collection failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start Web Vitals collection
   */
  private startWebVitalsCollection(): void {
    const collector = this.collectors.get('webvitals')!;
    
    setInterval(async () => {
      try {
        const vitals = await collector.collect();
        if (Array.isArray(vitals)) {
          this.webVitalsBuffer.push(...vitals as WebVitalsMetric[]);
        }
        
        // Keep only last 10000 entries
        if (this.webVitalsBuffer.length > 10000) {
          this.webVitalsBuffer = this.webVitalsBuffer.slice(-5000);
        }

        this.emit('webVitalsCollected', vitals);
      } catch (error) {
        console.error('Web Vitals collection failed:', error);
      }
    }, 60000); // Every minute
  }

  /**
   * Start database metrics collection
   */
  private startDatabaseMetricsCollection(): void {
    const collector = this.collectors.get('database')!;
    
    setInterval(async () => {
      try {
        const metrics = await collector.collect();
        this.databaseMetrics.push(metrics as DatabaseMetric);
        
        // Keep only last 1000 entries
        if (this.databaseMetrics.length > 1000) {
          this.databaseMetrics = this.databaseMetrics.slice(-500);
        }

        this.emit('databaseMetricsCollected', metrics);
      } catch (error) {
        console.error('Database metrics collection failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start application metrics collection
   */
  private startApplicationMetricsCollection(): void {
    const collector = this.collectors.get('application')!;
    
    setInterval(async () => {
      try {
        const metrics = await collector.collect();
        this.applicationMetrics.push(metrics as ApplicationMetric);
        
        // Keep only last 1000 entries
        if (this.applicationMetrics.length > 1000) {
          this.applicationMetrics = this.applicationMetrics.slice(-500);
        }

        this.emit('applicationMetricsCollected', metrics);
      } catch (error) {
        console.error('Application metrics collection failed:', error);
      }
    }, 15000); // Every 15 seconds
  }

  /**
   * Start metrics analysis
   */
  private startMetricsAnalysis(): void {
    setInterval(async () => {
      try {
        await this.performMetricsAnalysis();
      } catch (error) {
        console.error('Metrics analysis failed:', error);
      }
    }, 60000); // Every minute
  }

  private async performMetricsAnalysis(): Promise<void> {
    // Performance analysis
    const performanceAnalyzer = this.analyzers.get('performance')!;
    const performanceAnalysis = await performanceAnalyzer.analyze({
      webVitals: this.webVitalsBuffer.slice(-100),
      system: this.systemMetrics.slice(-20),
      database: this.databaseMetrics.slice(-20),
      application: this.applicationMetrics.slice(-20)
    });

    this.emit('performanceAnalysis', performanceAnalysis);

    // Anomaly detection
    const anomalyDetector = this.analyzers.get('anomaly')!;
    const anomalies = await anomalyDetector.analyze({
      webVitals: this.webVitalsBuffer.slice(-100),
      system: this.systemMetrics.slice(-20)
    });

    if (anomalies.length > 0) {
      this.emit('anomaliesDetected', anomalies);
    }

    // Trend analysis
    const trendAnalyzer = this.analyzers.get('trend')!;
    const trends = await trendAnalyzer.analyze({
      webVitals: this.webVitalsBuffer.slice(-500),
      application: this.applicationMetrics.slice(-100)
    });

    this.emit('trendsAnalyzed', trends);
  }

  /**
   * Start alert processing
   */
  private startAlertProcessing(): void {
    setInterval(async () => {
      try {
        await this.processAlerts();
      } catch (error) {
        console.error('Alert processing failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  private async processAlerts(): Promise<void> {
    for (const [ruleName, rule] of this.alertRules.entries()) {
      if (!rule.enabled) continue;

      const currentValue = await this.getMetricValue(rule.metric);
      const shouldAlert = this.evaluateAlertCondition(rule, currentValue);

      if (shouldAlert && !this.activeAlerts.has(ruleName)) {
        // Trigger new alert
        const alertEvent: AlertEvent = {
          id: this.generateAlertId(),
          rule: ruleName,
          severity: rule.severity,
          message: `${rule.metric} is ${rule.condition} ${rule.threshold} (current: ${currentValue})`,
          timestamp: Date.now(),
          resolved: false,
          metadata: {
            metric: rule.metric,
            currentValue,
            threshold: rule.threshold,
            condition: rule.condition
          }
        };

        this.activeAlerts.set(ruleName, alertEvent);
        await this.sendAlert(alertEvent, rule.channels);
        this.emit('alertTriggered', alertEvent);

      } else if (!shouldAlert && this.activeAlerts.has(ruleName)) {
        // Resolve existing alert
        const alertEvent = this.activeAlerts.get(ruleName)!;
        alertEvent.resolved = true;
        alertEvent.resolvedAt = Date.now();

        this.activeAlerts.delete(ruleName);
        await this.sendAlertResolution(alertEvent, rule.channels);
        this.emit('alertResolved', alertEvent);
      }
    }
  }

  private evaluateAlertCondition(rule: AlertRule, currentValue: number): boolean {
    switch (rule.condition) {
      case 'above':
        return currentValue > rule.threshold;
      case 'below':
        return currentValue < rule.threshold;
      default:
        return false;
    }
  }

  private async getMetricValue(metricName: string): Promise<number> {
    // Mock implementation - in reality, query from metrics buffer
    switch (metricName) {
      case 'response_time_p95':
        return this.calculateP95ResponseTime();
      case 'error_rate':
        return this.calculateErrorRate();
      case 'cache_hit_rate':
        return this.calculateCacheHitRate();
      case 'cpu_utilization':
        return this.getLatestCPUUtilization();
      case 'memory_utilization':
        return this.getLatestMemoryUtilization();
      case 'db_connections_utilization':
        return this.getDBConnectionsUtilization();
      case 'lcp_p95':
        return this.calculateLCPP95();
      case 'session_creation_rate':
        return this.calculateSessionCreationRate();
      default:
        return 0;
    }
  }

  private calculateP95ResponseTime(): number {
    if (this.applicationMetrics.length === 0) return 0;
    const latest = this.applicationMetrics[this.applicationMetrics.length - 1];
    return latest.responses.p95;
  }

  private calculateErrorRate(): number {
    if (this.applicationMetrics.length === 0) return 0;
    const latest = this.applicationMetrics[this.applicationMetrics.length - 1];
    return latest.errors.rate;
  }

  private calculateCacheHitRate(): number {
    if (this.databaseMetrics.length === 0) return 0;
    const latest = this.databaseMetrics[this.databaseMetrics.length - 1];
    return latest.performance.cacheHitRatio;
  }

  private getLatestCPUUtilization(): number {
    if (this.systemMetrics.length === 0) return 0;
    const latest = this.systemMetrics[this.systemMetrics.length - 1];
    return latest.cpu.utilization;
  }

  private getLatestMemoryUtilization(): number {
    if (this.systemMetrics.length === 0) return 0;
    const latest = this.systemMetrics[this.systemMetrics.length - 1];
    return latest.memory.utilization;
  }

  private getDBConnectionsUtilization(): number {
    if (this.databaseMetrics.length === 0) return 0;
    const latest = this.databaseMetrics[this.databaseMetrics.length - 1];
    return (latest.connections.active / latest.connections.maxConnections) * 100;
  }

  private calculateLCPP95(): number {
    if (this.webVitalsBuffer.length === 0) return 0;
    const recent = this.webVitalsBuffer.slice(-100);
    const values = recent.map(v => v.largestContentfulPaint).sort((a, b) => a - b);
    const p95Index = Math.floor(values.length * 0.95);
    return values[p95Index] || 0;
  }

  private calculateSessionCreationRate(): number {
    if (this.applicationMetrics.length < 2) return 0;
    const latest = this.applicationMetrics[this.applicationMetrics.length - 1];
    const previous = this.applicationMetrics[this.applicationMetrics.length - 2];
    const timeDiff = (latest.timestamp - previous.timestamp) / 1000;
    return (latest.sessions.created - previous.sessions.created) / timeDiff;
  }

  /**
   * Send alert notifications
   */
  private async sendAlert(alert: AlertEvent, channels: string[]): Promise<void> {
    console.log(`🚨 ALERT: ${alert.message}`);
    
    for (const channel of channels) {
      try {
        await this.sendToChannel(channel, alert, 'alert');
      } catch (error) {
        console.error(`Failed to send alert to ${channel}:`, error);
      }
    }
  }

  private async sendAlertResolution(alert: AlertEvent, channels: string[]): Promise<void> {
    console.log(`✅ RESOLVED: ${alert.rule} alert resolved`);
    
    for (const channel of channels) {
      try {
        await this.sendToChannel(channel, alert, 'resolution');
      } catch (error) {
        console.error(`Failed to send resolution to ${channel}:`, error);
      }
    }
  }

  private async sendToChannel(channel: string, alert: AlertEvent, type: 'alert' | 'resolution'): Promise<void> {
    // Mock implementation - in reality, integrate with Slack, PagerDuty, email, etc.
    switch (channel) {
      case 'slack':
        await this.sendSlackNotification(alert, type);
        break;
      case 'email':
        await this.sendEmailNotification(alert, type);
        break;
      case 'pagerduty':
        await this.sendPagerDutyNotification(alert, type);
        break;
    }
  }

  private async sendSlackNotification(alert: AlertEvent, type: string): Promise<void> {
    // Mock Slack integration
    console.log(`Slack notification sent: ${type} for ${alert.rule}`);
  }

  private async sendEmailNotification(alert: AlertEvent, type: string): Promise<void> {
    // Mock email integration
    console.log(`Email notification sent: ${type} for ${alert.rule}`);
  }

  private async sendPagerDutyNotification(alert: AlertEvent, type: string): Promise<void> {
    // Mock PagerDuty integration
    console.log(`PagerDuty notification sent: ${type} for ${alert.rule}`);
  }

  /**
   * Start performance budget monitoring
   */
  private startPerformanceBudgetMonitoring(): void {
    setInterval(async () => {
      try {
        await this.checkPerformanceBudgets();
      } catch (error) {
        console.error('Performance budget monitoring failed:', error);
      }
    }, 300000); // Every 5 minutes
  }

  private async checkPerformanceBudgets(): Promise<void> {
    const budgets = [
      { metric: 'firstContentfulPaint', budget: 1500, name: 'First Contentful Paint' },
      { metric: 'largestContentfulPaint', budget: 2500, name: 'Largest Contentful Paint' },
      { metric: 'timeToInteractive', budget: 3000, name: 'Time to Interactive' },
      { metric: 'cumulativeLayoutShift', budget: 0.1, name: 'Cumulative Layout Shift' }
    ];

    for (const budget of budgets) {
      const currentValue = await this.calculateWebVitalMetric(budget.metric);
      
      if (currentValue > budget.budget) {
        this.emit('budgetExceeded', {
          metric: budget.name,
          budget: budget.budget,
          current: currentValue,
          overage: currentValue - budget.budget
        });
      }
    }
  }

  private async calculateWebVitalMetric(metric: string): Promise<number> {
    if (this.webVitalsBuffer.length === 0) return 0;
    
    const recent = this.webVitalsBuffer.slice(-100);
    const values = recent.map(v => (v as any)[metric]).filter(v => v != null);
    
    if (values.length === 0) return 0;
    
    // Calculate P95
    values.sort((a, b) => a - b);
    const p95Index = Math.floor(values.length * 0.95);
    return values[p95Index] || 0;
  }

  /**
   * Start data retention cleanup
   */
  private startDataRetentionCleanup(): void {
    setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Every hour
  }

  private cleanupOldData(): void {
    const retentionPeriod = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = Date.now() - retentionPeriod;

    // Clean web vitals
    this.webVitalsBuffer = this.webVitalsBuffer.filter(v => v.timestamp > cutoff);

    // Clean system metrics
    this.systemMetrics = this.systemMetrics.filter(m => m.timestamp > cutoff);

    // Clean database metrics
    this.databaseMetrics = this.databaseMetrics.filter(m => m.timestamp > cutoff);

    // Clean application metrics
    this.applicationMetrics = this.applicationMetrics.filter(m => m.timestamp > cutoff);

    console.log('Old metrics data cleaned up');
  }

  // Utility methods
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API methods
  recordWebVital(vital: WebVitalsMetric): void {
    this.webVitalsBuffer.push(vital);
    this.emit('webVitalRecorded', vital);
  }

  recordCustomMetric(metric: PerformanceMetric): void {
    const key = `${metric.source}:${metric.name}`;
    if (!this.metricsBuffer.has(key)) {
      this.metricsBuffer.set(key, []);
    }
    
    const buffer = this.metricsBuffer.get(key)!;
    buffer.push(metric);
    
    // Keep only last 1000 entries per metric
    if (buffer.length > 1000) {
      this.metricsBuffer.set(key, buffer.slice(-500));
    }

    this.emit('customMetricRecorded', metric);
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.name, rule);
    console.log(`Alert rule added: ${rule.name}`);
  }

  removeAlertRule(ruleName: string): void {
    this.alertRules.delete(ruleName);
    
    // Resolve any active alert for this rule
    if (this.activeAlerts.has(ruleName)) {
      const alert = this.activeAlerts.get(ruleName)!;
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      this.activeAlerts.delete(ruleName);
      this.emit('alertResolved', alert);
    }
    
    console.log(`Alert rule removed: ${ruleName}`);
  }

  getMetricsSummary(): any {
    return {
      webVitals: {
        count: this.webVitalsBuffer.length,
        latest: this.webVitalsBuffer[this.webVitalsBuffer.length - 1]
      },
      system: {
        count: this.systemMetrics.length,
        latest: this.systemMetrics[this.systemMetrics.length - 1]
      },
      database: {
        count: this.databaseMetrics.length,
        latest: this.databaseMetrics[this.databaseMetrics.length - 1]
      },
      application: {
        count: this.applicationMetrics.length,
        latest: this.applicationMetrics[this.applicationMetrics.length - 1]
      },
      alerts: {
        active: this.activeAlerts.size,
        rules: this.alertRules.size
      }
    };
  }

  getActiveAlerts(): AlertEvent[] {
    return Array.from(this.activeAlerts.values());
  }

  getPerformanceReport(): any {
    // Generate comprehensive performance report
    const webVitalsP95 = this.calculateWebVitalsP95();
    const systemUtilization = this.getAverageSystemUtilization();
    
    return {
      timestamp: Date.now(),
      webVitals: webVitalsP95,
      system: systemUtilization,
      recommendations: this.generateRecommendations(webVitalsP95, systemUtilization),
      grade: this.calculatePerformanceGrade(webVitalsP95)
    };
  }

  private calculateWebVitalsP95(): any {
    if (this.webVitalsBuffer.length === 0) return null;
    
    const recent = this.webVitalsBuffer.slice(-100);
    const metrics = ['firstContentfulPaint', 'largestContentfulPaint', 'timeToInteractive', 'cumulativeLayoutShift'];
    
    const result: any = {};
    for (const metric of metrics) {
      const values = recent.map(v => (v as any)[metric]).filter(v => v != null).sort((a, b) => a - b);
      if (values.length > 0) {
        const p95Index = Math.floor(values.length * 0.95);
        result[metric] = values[p95Index] || 0;
      }
    }
    
    return result;
  }

  private getAverageSystemUtilization(): any {
    if (this.systemMetrics.length === 0) return null;
    
    const recent = this.systemMetrics.slice(-10);
    const avgCPU = recent.reduce((sum, m) => sum + m.cpu.utilization, 0) / recent.length;
    const avgMemory = recent.reduce((sum, m) => sum + m.memory.utilization, 0) / recent.length;
    
    return { cpu: avgCPU, memory: avgMemory };
  }

  private generateRecommendations(webVitals: any, system: any): string[] {
    const recommendations = [];
    
    if (webVitals?.largestContentfulPaint > 2500) {
      recommendations.push('Optimize images and implement lazy loading to improve LCP');
    }
    
    if (webVitals?.firstContentfulPaint > 1800) {
      recommendations.push('Reduce server response times and optimize critical rendering path');
    }
    
    if (system?.cpu > 80) {
      recommendations.push('Consider scaling up CPU resources or optimizing CPU-intensive operations');
    }
    
    if (system?.memory > 85) {
      recommendations.push('Monitor memory usage and consider scaling memory resources');
    }
    
    return recommendations;
  }

  private calculatePerformanceGrade(webVitals: any): string {
    if (!webVitals) return 'N/A';
    
    let score = 100;
    
    // LCP scoring
    if (webVitals.largestContentfulPaint > 4000) score -= 30;
    else if (webVitals.largestContentfulPaint > 2500) score -= 15;
    
    // FCP scoring
    if (webVitals.firstContentfulPaint > 3000) score -= 20;
    else if (webVitals.firstContentfulPaint > 1800) score -= 10;
    
    // TTI scoring
    if (webVitals.timeToInteractive > 5000) score -= 25;
    else if (webVitals.timeToInteractive > 3800) score -= 12;
    
    // CLS scoring
    if (webVitals.cumulativeLayoutShift > 0.25) score -= 15;
    else if (webVitals.cumulativeLayoutShift > 0.1) score -= 8;
    
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down performance monitor...');
    this.removeAllListeners();
  }
}

// Supporting classes (mock implementations)
class MetricsCollector {
  async collect(): Promise<any> {
    return {};
  }
}

class SystemMetricsCollector extends MetricsCollector {
  async collect(): Promise<SystemMetric> {
    return {
      cpu: {
        usage: Math.random() * 100,
        available: 100,
        utilization: Math.random() * 100
      },
      memory: {
        usage: Math.random() * 16,
        available: 16,
        utilization: Math.random() * 100
      },
      disk: {
        usage: Math.random() * 100,
        available: 500,
        utilization: Math.random() * 100
      },
      network: {
        bytesIn: Math.random() * 1000000,
        bytesOut: Math.random() * 1000000,
        packetsIn: Math.random() * 10000,
        packetsOut: Math.random() * 10000,
        errors: Math.random() * 10,
        latency: Math.random() * 100
      },
      timestamp: Date.now()
    };
  }
}

class DatabaseMetricsCollector extends MetricsCollector {
  async collect(): Promise<DatabaseMetric> {
    return {
      connections: {
        active: Math.floor(Math.random() * 50) + 10,
        idle: Math.floor(Math.random() * 20) + 5,
        total: 100,
        maxConnections: 100
      },
      queries: {
        totalQueries: Math.floor(Math.random() * 1000) + 500,
        slowQueries: Math.floor(Math.random() * 10),
        failedQueries: Math.floor(Math.random() * 5),
        averageResponseTime: Math.random() * 200 + 50,
        qps: Math.random() * 100 + 50
      },
      performance: {
        cacheHitRatio: 0.8 + Math.random() * 0.15,
        indexUsage: 0.9 + Math.random() * 0.1,
        lockWaitTime: Math.random() * 50,
        replicationLag: Math.random() * 100
      },
      timestamp: Date.now()
    };
  }
}

class ApplicationMetricsCollector extends MetricsCollector {
  async collect(): Promise<ApplicationMetric> {
    return {
      requests: {
        total: Math.floor(Math.random() * 10000) + 5000,
        rps: Math.random() * 200 + 50,
        concurrent: Math.floor(Math.random() * 100) + 20,
        queueDepth: Math.floor(Math.random() * 10)
      },
      responses: {
        averageTime: Math.random() * 500 + 100,
        p50: Math.random() * 300 + 50,
        p95: Math.random() * 1000 + 200,
        p99: Math.random() * 2000 + 500,
        p999: Math.random() * 5000 + 1000
      },
      errors: {
        total: Math.floor(Math.random() * 100),
        rate: Math.random() * 0.05,
        byStatus: {
          '4xx': Math.floor(Math.random() * 50),
          '5xx': Math.floor(Math.random() * 20)
        },
        byEndpoint: {
          '/api/sessions': Math.floor(Math.random() * 30),
          '/api/llm': Math.floor(Math.random() * 10)
        }
      },
      sessions: {
        active: Math.floor(Math.random() * 500) + 100,
        created: Math.floor(Math.random() * 100) + 20,
        expired: Math.floor(Math.random() * 50) + 10,
        averageDuration: Math.random() * 1800 + 600
      },
      timestamp: Date.now()
    };
  }
}

class WebVitalsCollector extends MetricsCollector {
  async collect(): Promise<WebVitalsMetric[]> {
    const count = Math.floor(Math.random() * 5) + 1;
    const vitals = [];
    
    for (let i = 0; i < count; i++) {
      vitals.push({
        sessionId: `session_${Math.random().toString(36).substr(2, 9)}`,
        userId: Math.random() > 0.3 ? `user_${Math.random().toString(36).substr(2, 9)}` : undefined,
        url: '/',
        firstContentfulPaint: Math.random() * 3000 + 500,
        largestContentfulPaint: Math.random() * 4000 + 1000,
        firstInputDelay: Math.random() * 300 + 10,
        cumulativeLayoutShift: Math.random() * 0.3,
        timeToFirstByte: Math.random() * 1000 + 200,
        timeToInteractive: Math.random() * 5000 + 1500,
        totalBlockingTime: Math.random() * 600 + 100,
        deviceType: Math.random() > 0.7 ? 'mobile' : 'desktop' as any,
        connection: '4g',
        timestamp: Date.now() - Math.random() * 60000
      });
    }
    
    return vitals;
  }
}

class RedisMetricsCollector extends MetricsCollector {}
class CDNMetricsCollector extends MetricsCollector {}

class MetricsAnalyzer {
  async analyze(data: any): Promise<any> {
    return {};
  }
}

class PerformanceAnalyzer extends MetricsAnalyzer {}
class AnomalyDetector extends MetricsAnalyzer {}
class TrendAnalyzer extends MetricsAnalyzer {}
class CapacityPlanner extends MetricsAnalyzer {}

export default PerformanceMonitor;