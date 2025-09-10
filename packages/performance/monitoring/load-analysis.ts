import { EventEmitter } from 'events';

/**
 * Load Test Analysis and Performance Validation
 * Analyzes load test results and provides optimization recommendations
 */

export interface LoadTestResult {
  testId: string;
  testName: string;
  startTime: number;
  endTime: number;
  duration: number;
  configuration: LoadTestConfiguration;
  metrics: LoadTestMetrics;
  phases: LoadTestPhase[];
  errors: LoadTestError[];
  recommendations: string[];
  grade: string;
  passed: boolean;
}

export interface LoadTestConfiguration {
  target: string;
  maxUsers: number;
  duration: number;
  rampUpTime: number;
  scenarios: TestScenario[];
  expectations: TestExpectation[];
}

export interface TestScenario {
  name: string;
  weight: number;
  flow: TestStep[];
}

export interface TestStep {
  action: string;
  endpoint?: string;
  method?: string;
  payload?: any;
  think?: number;
  capture?: any[];
}

export interface TestExpectation {
  metric: string;
  threshold: number;
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
}

export interface LoadTestPhase {
  name: string;
  startTime: number;
  endTime: number;
  targetUsers: number;
  actualUsers: number;
  metrics: PhaseMetrics;
}

export interface PhaseMetrics {
  requests: RequestMetrics;
  responses: ResponseMetrics;
  errors: ErrorMetrics;
  websockets: WebSocketMetrics;
  resources: ResourceMetrics;
}

export interface RequestMetrics {
  total: number;
  successful: number;
  failed: number;
  rate: number;
  peakRate: number;
  averageRate: number;
}

export interface ResponseMetrics {
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  p999: number;
  stdDev: number;
}

export interface ErrorMetrics {
  count: number;
  rate: number;
  byType: Record<string, number>;
  byEndpoint: Record<string, number>;
  byStatusCode: Record<string, number>;
}

export interface WebSocketMetrics {
  connections: number;
  messagesExchanged: number;
  averageLatency: number;
  connectionFailures: number;
}

export interface ResourceMetrics {
  cpu: ResourceUtilization;
  memory: ResourceUtilization;
  network: NetworkUtilization;
}

export interface ResourceUtilization {
  average: number;
  peak: number;
  minimum: number;
}

export interface NetworkUtilization {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
}

export interface LoadTestMetrics {
  overall: OverallMetrics;
  phases: Record<string, PhaseMetrics>;
  timeSeries: TimeSeriesMetric[];
  customMetrics: Record<string, any>;
}

export interface OverallMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  responseTimeP95: number;
  responseTimeP99: number;
  requestRate: number;
  errorRate: number;
  throughput: number;
  concurrentUsers: number;
  peakConcurrentUsers: number;
}

export interface TimeSeriesMetric {
  timestamp: number;
  requests: number;
  responses: number;
  errors: number;
  responseTime: number;
  activeUsers: number;
  cpu: number;
  memory: number;
}

export interface LoadTestError {
  timestamp: number;
  type: string;
  message: string;
  endpoint?: string;
  statusCode?: number;
  responseTime?: number;
  count: number;
}

export interface PerformanceBottleneck {
  type: 'cpu' | 'memory' | 'database' | 'network' | 'application' | 'external';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: any;
  recommendations: string[];
  impact: string;
}

/**
 * Load Test Analyzer
 * Processes load test results and generates comprehensive analysis
 */
export class LoadTestAnalyzer extends EventEmitter {
  private results: Map<string, LoadTestResult> = new Map();
  private baselineResults: Map<string, LoadTestResult> = new Map();
  private performanceThresholds: Map<string, TestExpectation> = new Map();

  constructor() {
    super();
    this.setupDefaultThresholds();
  }

  /**
   * Setup default performance thresholds
   */
  private setupDefaultThresholds(): void {
    const defaultThresholds: TestExpectation[] = [
      { metric: 'response_time_p95', threshold: 3000, operator: 'lt' },
      { metric: 'response_time_p99', threshold: 5000, operator: 'lt' },
      { metric: 'error_rate', threshold: 0.01, operator: 'lt' },
      { metric: 'request_rate', threshold: 800, operator: 'gte' },
      { metric: 'concurrent_users', threshold: 1000, operator: 'gte' },
      { metric: 'websocket_connections', threshold: 500, operator: 'gte' },
      { metric: 'cpu_utilization', threshold: 85, operator: 'lt' },
      { metric: 'memory_utilization', threshold: 90, operator: 'lt' }
    ];

    defaultThresholds.forEach(threshold => {
      this.performanceThresholds.set(threshold.metric, threshold);
    });
  }

  /**
   * Analyze load test results
   */
  async analyzeLoadTest(rawResults: any): Promise<LoadTestResult> {
    console.log('Analyzing load test results...');

    const testResult: LoadTestResult = {
      testId: this.generateTestId(),
      testName: rawResults.testName || 'Load Test',
      startTime: rawResults.startTime || Date.now(),
      endTime: rawResults.endTime || Date.now(),
      duration: rawResults.duration || 0,
      configuration: rawResults.configuration,
      metrics: await this.processMetrics(rawResults.metrics),
      phases: await this.analyzePhases(rawResults.phases),
      errors: await this.categorizeErrors(rawResults.errors),
      recommendations: [],
      grade: '',
      passed: false
    };

    // Perform detailed analysis
    testResult.recommendations = await this.generateRecommendations(testResult);
    testResult.grade = this.calculatePerformanceGrade(testResult);
    testResult.passed = this.validateExpectations(testResult);

    // Store result
    this.results.set(testResult.testId, testResult);

    // Compare with baseline if available
    await this.performBaselineComparison(testResult);

    // Identify bottlenecks
    const bottlenecks = await this.identifyBottlenecks(testResult);
    this.emit('bottlenecksIdentified', { testId: testResult.testId, bottlenecks });

    console.log(`Load test analysis completed: ${testResult.grade} grade`);
    this.emit('analysisCompleted', testResult);

    return testResult;
  }

  /**
   * Process and normalize metrics data
   */
  private async processMetrics(rawMetrics: any): Promise<LoadTestMetrics> {
    const overall: OverallMetrics = {
      totalRequests: rawMetrics.totalRequests || 0,
      successfulRequests: rawMetrics.successfulRequests || 0,
      failedRequests: rawMetrics.failedRequests || 0,
      averageResponseTime: rawMetrics.averageResponseTime || 0,
      responseTimeP95: rawMetrics.responseTimeP95 || 0,
      responseTimeP99: rawMetrics.responseTimeP99 || 0,
      requestRate: rawMetrics.requestRate || 0,
      errorRate: rawMetrics.errorRate || 0,
      throughput: rawMetrics.throughput || 0,
      concurrentUsers: rawMetrics.concurrentUsers || 0,
      peakConcurrentUsers: rawMetrics.peakConcurrentUsers || 0
    };

    return {
      overall,
      phases: rawMetrics.phases || {},
      timeSeries: rawMetrics.timeSeries || [],
      customMetrics: rawMetrics.customMetrics || {}
    };
  }

  /**
   * Analyze individual test phases
   */
  private async analyzePhases(rawPhases: any[]): Promise<LoadTestPhase[]> {
    const phases: LoadTestPhase[] = [];

    for (const rawPhase of rawPhases || []) {
      const phase: LoadTestPhase = {
        name: rawPhase.name,
        startTime: rawPhase.startTime,
        endTime: rawPhase.endTime,
        targetUsers: rawPhase.targetUsers,
        actualUsers: rawPhase.actualUsers,
        metrics: {
          requests: {
            total: rawPhase.requests?.total || 0,
            successful: rawPhase.requests?.successful || 0,
            failed: rawPhase.requests?.failed || 0,
            rate: rawPhase.requests?.rate || 0,
            peakRate: rawPhase.requests?.peakRate || 0,
            averageRate: rawPhase.requests?.averageRate || 0
          },
          responses: {
            min: rawPhase.responses?.min || 0,
            max: rawPhase.responses?.max || 0,
            mean: rawPhase.responses?.mean || 0,
            median: rawPhase.responses?.median || 0,
            p95: rawPhase.responses?.p95 || 0,
            p99: rawPhase.responses?.p99 || 0,
            p999: rawPhase.responses?.p999 || 0,
            stdDev: rawPhase.responses?.stdDev || 0
          },
          errors: {
            count: rawPhase.errors?.count || 0,
            rate: rawPhase.errors?.rate || 0,
            byType: rawPhase.errors?.byType || {},
            byEndpoint: rawPhase.errors?.byEndpoint || {},
            byStatusCode: rawPhase.errors?.byStatusCode || {}
          },
          websockets: {
            connections: rawPhase.websockets?.connections || 0,
            messagesExchanged: rawPhase.websockets?.messagesExchanged || 0,
            averageLatency: rawPhase.websockets?.averageLatency || 0,
            connectionFailures: rawPhase.websockets?.connectionFailures || 0
          },
          resources: {
            cpu: {
              average: rawPhase.resources?.cpu?.average || 0,
              peak: rawPhase.resources?.cpu?.peak || 0,
              minimum: rawPhase.resources?.cpu?.minimum || 0
            },
            memory: {
              average: rawPhase.resources?.memory?.average || 0,
              peak: rawPhase.resources?.memory?.peak || 0,
              minimum: rawPhase.resources?.memory?.minimum || 0
            },
            network: {
              bytesIn: rawPhase.resources?.network?.bytesIn || 0,
              bytesOut: rawPhase.resources?.network?.bytesOut || 0,
              packetsIn: rawPhase.resources?.network?.packetsIn || 0,
              packetsOut: rawPhase.resources?.network?.packetsOut || 0
            }
          }
        }
      };

      phases.push(phase);
    }

    return phases;
  }

  /**
   * Categorize and analyze errors
   */
  private async categorizeErrors(rawErrors: any[]): Promise<LoadTestError[]> {
    const errorMap = new Map<string, LoadTestError>();

    for (const rawError of rawErrors || []) {
      const errorKey = `${rawError.type}:${rawError.message}:${rawError.endpoint}:${rawError.statusCode}`;
      
      if (errorMap.has(errorKey)) {
        errorMap.get(errorKey)!.count++;
      } else {
        errorMap.set(errorKey, {
          timestamp: rawError.timestamp,
          type: rawError.type,
          message: rawError.message,
          endpoint: rawError.endpoint,
          statusCode: rawError.statusCode,
          responseTime: rawError.responseTime,
          count: 1
        });
      }
    }

    return Array.from(errorMap.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Generate performance recommendations
   */
  private async generateRecommendations(testResult: LoadTestResult): Promise<string[]> {
    const recommendations: string[] = [];
    const metrics = testResult.metrics.overall;

    // Response time analysis
    if (metrics.responseTimeP95 > 3000) {
      recommendations.push(
        'High P95 response time detected. Consider optimizing database queries and implementing caching.'
      );
    }

    if (metrics.responseTimeP99 > 5000) {
      recommendations.push(
        'Very high P99 response time indicates performance outliers. Investigate slow query logs and optimize worst-case scenarios.'
      );
    }

    // Error rate analysis
    if (metrics.errorRate > 0.01) {
      recommendations.push(
        'Error rate exceeds 1%. Review error logs and implement proper error handling and retry mechanisms.'
      );
    }

    // Throughput analysis
    if (metrics.requestRate < 500) {
      recommendations.push(
        'Low request rate indicates potential bottlenecks. Consider horizontal scaling or performance optimization.'
      );
    }

    // Concurrent user analysis
    if (metrics.peakConcurrentUsers < 1000) {
      recommendations.push(
        'Unable to reach target concurrent user count. Investigate connection limits and server capacity.'
      );
    }

    // Phase-specific analysis
    for (const phase of testResult.phases) {
      if (phase.metrics.resources.cpu.peak > 85) {
        recommendations.push(
          `High CPU usage in ${phase.name} phase (${phase.metrics.resources.cpu.peak}%). Consider CPU optimization or scaling.`
        );
      }

      if (phase.metrics.resources.memory.peak > 90) {
        recommendations.push(
          `High memory usage in ${phase.name} phase (${phase.metrics.resources.memory.peak}%). Investigate memory leaks or increase memory allocation.`
        );
      }

      if (phase.metrics.websockets.connectionFailures > phase.metrics.websockets.connections * 0.05) {
        recommendations.push(
          `High WebSocket connection failure rate in ${phase.name} phase. Review WebSocket configuration and connection handling.`
        );
      }
    }

    // Error-specific recommendations
    const criticalErrors = testResult.errors.filter(e => e.count > 10);
    for (const error of criticalErrors) {
      if (error.type === 'timeout') {
        recommendations.push(
          `Frequent timeout errors on ${error.endpoint}. Increase timeout values or optimize endpoint performance.`
        );
      }

      if (error.statusCode === 500) {
        recommendations.push(
          `Server errors detected on ${error.endpoint}. Review application logs and fix underlying issues.`
        );
      }

      if (error.statusCode === 429) {
        recommendations.push(
          `Rate limiting triggered on ${error.endpoint}. Adjust rate limits or implement request queuing.`
        );
      }
    }

    return recommendations;
  }

  /**
   * Calculate overall performance grade
   */
  private calculatePerformanceGrade(testResult: LoadTestResult): string {
    let score = 100;
    const metrics = testResult.metrics.overall;

    // Response time scoring (40 points)
    if (metrics.responseTimeP95 > 5000) score -= 20;
    else if (metrics.responseTimeP95 > 3000) score -= 10;
    else if (metrics.responseTimeP95 > 2000) score -= 5;

    if (metrics.responseTimeP99 > 8000) score -= 20;
    else if (metrics.responseTimeP99 > 5000) score -= 10;
    else if (metrics.responseTimeP99 > 3000) score -= 5;

    // Error rate scoring (25 points)
    if (metrics.errorRate > 0.05) score -= 25;
    else if (metrics.errorRate > 0.02) score -= 15;
    else if (metrics.errorRate > 0.01) score -= 10;
    else if (metrics.errorRate > 0.005) score -= 5;

    // Throughput scoring (20 points)
    if (metrics.requestRate < 200) score -= 20;
    else if (metrics.requestRate < 500) score -= 15;
    else if (metrics.requestRate < 800) score -= 10;
    else if (metrics.requestRate < 1000) score -= 5;

    // Concurrent users scoring (15 points)
    if (metrics.peakConcurrentUsers < 500) score -= 15;
    else if (metrics.peakConcurrentUsers < 750) score -= 10;
    else if (metrics.peakConcurrentUsers < 1000) score -= 5;

    // Convert score to letter grade
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 75) return 'C+';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Validate performance expectations
   */
  private validateExpectations(testResult: LoadTestResult): boolean {
    const expectations = testResult.configuration?.expectations || 
                        Array.from(this.performanceThresholds.values());
    
    for (const expectation of expectations) {
      const actualValue = this.getMetricValue(testResult, expectation.metric);
      
      if (!this.evaluateExpectation(actualValue, expectation)) {
        return false;
      }
    }

    return true;
  }

  private getMetricValue(testResult: LoadTestResult, metricName: string): number {
    const metrics = testResult.metrics.overall;
    
    switch (metricName) {
      case 'response_time_p95': return metrics.responseTimeP95;
      case 'response_time_p99': return metrics.responseTimeP99;
      case 'error_rate': return metrics.errorRate;
      case 'request_rate': return metrics.requestRate;
      case 'concurrent_users': return metrics.peakConcurrentUsers;
      case 'websocket_connections': return testResult.phases
        .reduce((max, phase) => Math.max(max, phase.metrics.websockets.connections), 0);
      case 'cpu_utilization': return testResult.phases
        .reduce((max, phase) => Math.max(max, phase.metrics.resources.cpu.peak), 0);
      case 'memory_utilization': return testResult.phases
        .reduce((max, phase) => Math.max(max, phase.metrics.resources.memory.peak), 0);
      default: return 0;
    }
  }

  private evaluateExpectation(actualValue: number, expectation: TestExpectation): boolean {
    switch (expectation.operator) {
      case 'lt': return actualValue < expectation.threshold;
      case 'lte': return actualValue <= expectation.threshold;
      case 'gt': return actualValue > expectation.threshold;
      case 'gte': return actualValue >= expectation.threshold;
      case 'eq': return actualValue === expectation.threshold;
      default: return false;
    }
  }

  /**
   * Perform baseline comparison
   */
  private async performBaselineComparison(testResult: LoadTestResult): Promise<void> {
    const baselineKey = testResult.configuration?.target || 'default';
    const baseline = this.baselineResults.get(baselineKey);

    if (!baseline) {
      console.log('No baseline found, setting current result as baseline');
      this.baselineResults.set(baselineKey, testResult);
      return;
    }

    const comparison = {
      testId: testResult.testId,
      baselineTestId: baseline.testId,
      improvements: [] as string[],
      regressions: [] as string[],
      overall: 'stable' as 'improved' | 'degraded' | 'stable'
    };

    // Compare key metrics
    const currentMetrics = testResult.metrics.overall;
    const baselineMetrics = baseline.metrics.overall;

    // Response time comparison
    const p95Change = ((currentMetrics.responseTimeP95 - baselineMetrics.responseTimeP95) / baselineMetrics.responseTimeP95) * 100;
    if (p95Change < -10) {
      comparison.improvements.push(`P95 response time improved by ${Math.abs(p95Change).toFixed(1)}%`);
    } else if (p95Change > 15) {
      comparison.regressions.push(`P95 response time degraded by ${p95Change.toFixed(1)}%`);
    }

    // Error rate comparison
    const errorRateChange = currentMetrics.errorRate - baselineMetrics.errorRate;
    if (errorRateChange < -0.005) {
      comparison.improvements.push(`Error rate improved by ${Math.abs(errorRateChange * 100).toFixed(2)}%`);
    } else if (errorRateChange > 0.01) {
      comparison.regressions.push(`Error rate increased by ${(errorRateChange * 100).toFixed(2)}%`);
    }

    // Throughput comparison
    const throughputChange = ((currentMetrics.requestRate - baselineMetrics.requestRate) / baselineMetrics.requestRate) * 100;
    if (throughputChange > 10) {
      comparison.improvements.push(`Request rate improved by ${throughputChange.toFixed(1)}%`);
    } else if (throughputChange < -15) {
      comparison.regressions.push(`Request rate degraded by ${Math.abs(throughputChange).toFixed(1)}%`);
    }

    // Determine overall status
    if (comparison.regressions.length > comparison.improvements.length) {
      comparison.overall = 'degraded';
    } else if (comparison.improvements.length > comparison.regressions.length) {
      comparison.overall = 'improved';
    }

    this.emit('baselineComparison', comparison);
  }

  /**
   * Identify performance bottlenecks
   */
  private async identifyBottlenecks(testResult: LoadTestResult): Promise<PerformanceBottleneck[]> {
    const bottlenecks: PerformanceBottleneck[] = [];
    const metrics = testResult.metrics.overall;

    // CPU bottleneck detection
    const peakCPU = testResult.phases.reduce((max, phase) => 
      Math.max(max, phase.metrics.resources.cpu.peak), 0);
    
    if (peakCPU > 90) {
      bottlenecks.push({
        type: 'cpu',
        severity: 'critical',
        description: `CPU utilization reached ${peakCPU.toFixed(1)}%`,
        evidence: { peakCPU, averageCPU: testResult.phases.reduce((sum, phase) => 
          sum + phase.metrics.resources.cpu.average, 0) / testResult.phases.length },
        recommendations: [
          'Scale up CPU resources',
          'Optimize CPU-intensive operations',
          'Implement request queuing to reduce peak load'
        ],
        impact: 'High response times and potential request timeouts'
      });
    }

    // Memory bottleneck detection
    const peakMemory = testResult.phases.reduce((max, phase) => 
      Math.max(max, phase.metrics.resources.memory.peak), 0);
    
    if (peakMemory > 95) {
      bottlenecks.push({
        type: 'memory',
        severity: 'critical',
        description: `Memory utilization reached ${peakMemory.toFixed(1)}%`,
        evidence: { peakMemory },
        recommendations: [
          'Increase available memory',
          'Investigate memory leaks',
          'Optimize memory-intensive operations'
        ],
        impact: 'Application instability and potential crashes'
      });
    }

    // Database bottleneck detection
    if (metrics.responseTimeP95 > 3000 && metrics.errorRate < 0.01) {
      bottlenecks.push({
        type: 'database',
        severity: 'high',
        description: 'High response times with low error rate suggest database bottleneck',
        evidence: { p95ResponseTime: metrics.responseTimeP95, errorRate: metrics.errorRate },
        recommendations: [
          'Optimize database queries',
          'Add database indexes',
          'Implement connection pooling',
          'Consider read replicas'
        ],
        impact: 'Slow application performance and poor user experience'
      });
    }

    // Network bottleneck detection
    const totalNetworkBytes = testResult.phases.reduce((sum, phase) => 
      sum + phase.metrics.resources.network.bytesIn + phase.metrics.resources.network.bytesOut, 0);
    
    if (totalNetworkBytes > 10 * 1024 * 1024 * 1024) { // 10GB
      bottlenecks.push({
        type: 'network',
        severity: 'medium',
        description: 'High network utilization detected',
        evidence: { totalNetworkBytes },
        recommendations: [
          'Implement response compression',
          'Optimize payload sizes',
          'Use CDN for static assets'
        ],
        impact: 'Increased bandwidth costs and potential network congestion'
      });
    }

    // Application bottleneck detection
    if (metrics.errorRate > 0.05) {
      bottlenecks.push({
        type: 'application',
        severity: 'high',
        description: `High error rate of ${(metrics.errorRate * 100).toFixed(2)}%`,
        evidence: { errorRate: metrics.errorRate, totalErrors: metrics.failedRequests },
        recommendations: [
          'Review application logs',
          'Implement proper error handling',
          'Add circuit breakers',
          'Improve application resilience'
        ],
        impact: 'Poor user experience and potential data loss'
      });
    }

    return bottlenecks;
  }

  /**
   * Generate comprehensive test report
   */
  generateReport(testId: string): any {
    const testResult = this.results.get(testId);
    if (!testResult) {
      throw new Error(`Test result not found: ${testId}`);
    }

    return {
      summary: {
        testId: testResult.testId,
        testName: testResult.testName,
        grade: testResult.grade,
        passed: testResult.passed,
        duration: testResult.duration,
        startTime: new Date(testResult.startTime).toISOString(),
        endTime: new Date(testResult.endTime).toISOString()
      },
      metrics: testResult.metrics,
      phases: testResult.phases,
      errors: testResult.errors,
      recommendations: testResult.recommendations,
      bottlenecks: [],
      trends: this.generateTrendAnalysis(testResult),
      comparison: this.getBaselineComparison(testResult)
    };
  }

  private generateTrendAnalysis(testResult: LoadTestResult): any {
    // Analyze trends across time series data
    const timeSeries = testResult.metrics.timeSeries;
    if (timeSeries.length < 2) return null;

    const responseTimeTrend = this.calculateTrend(timeSeries.map(t => t.responseTime));
    const errorTrend = this.calculateTrend(timeSeries.map(t => t.errors));
    const throughputTrend = this.calculateTrend(timeSeries.map(t => t.requests));

    return {
      responseTime: {
        trend: responseTimeTrend > 0 ? 'increasing' : responseTimeTrend < 0 ? 'decreasing' : 'stable',
        slope: responseTimeTrend
      },
      errors: {
        trend: errorTrend > 0 ? 'increasing' : errorTrend < 0 ? 'decreasing' : 'stable',
        slope: errorTrend
      },
      throughput: {
        trend: throughputTrend > 0 ? 'increasing' : throughputTrend < 0 ? 'decreasing' : 'stable',
        slope: throughputTrend
      }
    };
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum, value) => sum + value, 0);
    const sumXY = values.reduce((sum, value, index) => sum + (index * value), 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  private getBaselineComparison(testResult: LoadTestResult): any {
    const baselineKey = testResult.configuration?.target || 'default';
    const baseline = this.baselineResults.get(baselineKey);
    
    if (!baseline) return null;
    
    return {
      baseline: {
        testId: baseline.testId,
        testName: baseline.testName,
        date: new Date(baseline.startTime).toISOString()
      },
      changes: {
        responseTimeP95: this.calculatePercentageChange(
          baseline.metrics.overall.responseTimeP95,
          testResult.metrics.overall.responseTimeP95
        ),
        errorRate: this.calculatePercentageChange(
          baseline.metrics.overall.errorRate,
          testResult.metrics.overall.errorRate
        ),
        requestRate: this.calculatePercentageChange(
          baseline.metrics.overall.requestRate,
          testResult.metrics.overall.requestRate
        )
      }
    };
  }

  private calculatePercentageChange(baseline: number, current: number): number {
    if (baseline === 0) return current === 0 ? 0 : 100;
    return ((current - baseline) / baseline) * 100;
  }

  // Utility methods
  private generateTestId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API methods
  getTestResults(): LoadTestResult[] {
    return Array.from(this.results.values());
  }

  getTestResult(testId: string): LoadTestResult | undefined {
    return this.results.get(testId);
  }

  setBaseline(testId: string, target?: string): void {
    const testResult = this.results.get(testId);
    if (!testResult) {
      throw new Error(`Test result not found: ${testId}`);
    }

    const baselineKey = target || testResult.configuration?.target || 'default';
    this.baselineResults.set(baselineKey, testResult);
    console.log(`Baseline set for ${baselineKey}: ${testId}`);
  }

  clearBaseline(target?: string): void {
    const baselineKey = target || 'default';
    this.baselineResults.delete(baselineKey);
    console.log(`Baseline cleared for ${baselineKey}`);
  }

  addPerformanceThreshold(metric: string, threshold: TestExpectation): void {
    this.performanceThresholds.set(metric, threshold);
  }

  removePerformanceThreshold(metric: string): void {
    this.performanceThresholds.delete(metric);
  }

  getPerformanceThresholds(): TestExpectation[] {
    return Array.from(this.performanceThresholds.values());
  }
}

export default LoadTestAnalyzer;