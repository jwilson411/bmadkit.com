import { EventEmitter } from 'events';
import winston from 'winston';
import Redis from 'ioredis';

/**
 * User Experience Monitoring Service
 * Comprehensive UX tracking with session success rates and completion analytics
 */

export interface UserSession {
  sessionId: string;
  userId?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'active' | 'completed' | 'abandoned' | 'failed';
  type: 'planning' | 'analysis' | 'review' | 'export';
  methodology?: string;
  completionRate: number;
  satisfactionScore?: number;
  context: SessionContext;
  journey: UserJourney;
  metrics: SessionMetrics;
  feedback?: UserFeedback;
}

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
  device: DeviceInfo;
  browser: BrowserInfo;
  location: LocationInfo;
  referrer?: string;
  utm: UTMParameters;
  experiment?: ExperimentContext;
}

export interface DeviceInfo {
  type: 'desktop' | 'mobile' | 'tablet';
  os: string;
  osVersion: string;
  screenResolution: string;
  viewport: string;
  touchSupport: boolean;
}

export interface BrowserInfo {
  name: string;
  version: string;
  language: string;
  timezone: string;
  cookiesEnabled: boolean;
  javaScriptEnabled: boolean;
}

export interface LocationInfo {
  country?: string;
  region?: string;
  city?: string;
  timezone: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface UTMParameters {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface ExperimentContext {
  experiments: Record<string, string>;
  cohort?: string;
  featureFlags: Record<string, boolean>;
}

export interface UserJourney {
  steps: JourneyStep[];
  currentStep: number;
  totalSteps: number;
  completionFunnel: FunnelStep[];
  dropOffPoints: DropOffPoint[];
  conversionEvents: ConversionEvent[];
}

export interface JourneyStep {
  stepId: string;
  name: string;
  timestamp: number;
  duration?: number;
  status: 'started' | 'completed' | 'skipped' | 'failed';
  data?: Record<string, any>;
  errors?: string[];
}

export interface FunnelStep {
  step: string;
  users: number;
  completionRate: number;
  averageTime: number;
  dropOffRate: number;
}

export interface DropOffPoint {
  step: string;
  reason: string;
  frequency: number;
  impact: number;
  userSegments: string[];
}

export interface ConversionEvent {
  eventName: string;
  timestamp: number;
  value?: number;
  properties: Record<string, any>;
}

export interface SessionMetrics {
  pageViews: number;
  uniquePages: number;
  bounceRate: number;
  engagementScore: number;
  taskCompletionRate: number;
  errorCount: number;
  performanceScore: number;
  usabilityScore: number;
}

export interface UserFeedback {
  npsScore?: number;
  satisfactionRating?: number;
  usabilityRating?: number;
  comments?: string;
  suggestedImprovements?: string[];
  wouldRecommend?: boolean;
  timestamp: number;
}

export interface BusinessMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  dimensions: Record<string, string>;
  metadata: Record<string, any>;
}

export interface ConversionFunnel {
  name: string;
  steps: string[];
  conversions: FunnelConversion[];
  overallConversionRate: number;
  dropOffAnalysis: DropOffAnalysis[];
}

export interface FunnelConversion {
  fromStep: string;
  toStep: string;
  users: number;
  conversions: number;
  conversionRate: number;
  averageTime: number;
}

export interface DropOffAnalysis {
  step: string;
  dropOffRate: number;
  reasons: DropOffReason[];
  recommendations: string[];
}

export interface DropOffReason {
  reason: string;
  frequency: number;
  userSegments: string[];
  impact: 'low' | 'medium' | 'high';
}

/**
 * User Experience Monitor
 * Tracks user sessions, journey analytics, and business conversion metrics
 */
export class UserExperienceMonitor extends EventEmitter {
  private redis: Redis;
  private logger: winston.Logger;
  private activeSessions: Map<string, UserSession> = new Map();
  private conversionFunnels: Map<string, ConversionFunnel> = new Map();
  private businessMetrics: Map<string, BusinessMetric[]> = new Map();

  constructor(
    private config: {
      redis: {
        url: string;
        keyPrefix: string;
      };
      tracking: {
        sessionTimeout: number;
        trackingEnabled: boolean;
        samplingRate: number;
      };
      conversion: {
        funnels: string[];
        goals: string[];
        attribution: {
          windowDays: number;
          models: string[];
        };
      };
      feedback: {
        collectNPS: boolean;
        collectSatisfaction: boolean;
        collectUsability: boolean;
      };
    }
  ) {
    super();
    
    this.initializeRedis();
    this.initializeLogger();
    this.initializeConversionFunnels();
    this.startSessionMonitoring();
    this.startMetricsAggregation();
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
      this.logger.error('UX Monitor Redis error', { error: error.message });
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
      defaultMeta: { service: 'ux-monitor' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/ux-monitor.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Initialize conversion funnels
   */
  private initializeConversionFunnels(): void {
    // Planning session funnel
    this.conversionFunnels.set('planning_session', {
      name: 'Planning Session Completion',
      steps: [
        'session_created',
        'methodology_selected',
        'stakeholders_identified',
        'requirements_defined',
        'session_completed'
      ],
      conversions: [],
      overallConversionRate: 0,
      dropOffAnalysis: []
    });

    // User onboarding funnel
    this.conversionFunnels.set('user_onboarding', {
      name: 'User Onboarding',
      steps: [
        'signup_started',
        'email_verified',
        'profile_completed',
        'first_session_created',
        'first_session_completed'
      ],
      conversions: [],
      overallConversionRate: 0,
      dropOffAnalysis: []
    });

    // Subscription conversion funnel
    this.conversionFunnels.set('subscription_conversion', {
      name: 'Subscription Conversion',
      steps: [
        'trial_started',
        'feature_explored',
        'value_realized',
        'upgrade_initiated',
        'subscription_completed'
      ],
      conversions: [],
      overallConversionRate: 0,
      dropOffAnalysis: []
    });
  }

  /**
   * Start session monitoring
   */
  private startSessionMonitoring(): void {
    // Clean up abandoned sessions
    setInterval(() => {
      this.cleanupAbandonedSessions();
    }, 300000); // Every 5 minutes

    // Generate session reports
    setInterval(() => {
      this.generateSessionReports();
    }, 3600000); // Every hour
  }

  /**
   * Start metrics aggregation
   */
  private startMetricsAggregation(): void {
    setInterval(() => {
      this.aggregateMetrics();
    }, 600000); // Every 10 minutes

    setInterval(() => {
      this.analyzeConversionFunnels();
    }, 1800000); // Every 30 minutes
  }

  /**
   * Start user session tracking
   */
  async startSession(sessionData: {
    sessionId: string;
    userId?: string;
    type: 'planning' | 'analysis' | 'review' | 'export';
    methodology?: string;
    context: Partial<SessionContext>;
  }): Promise<void> {
    // Apply sampling
    if (Math.random() > this.config.tracking.samplingRate) {
      return;
    }

    const session: UserSession = {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId,
      startTime: Date.now(),
      status: 'active',
      type: sessionData.type,
      methodology: sessionData.methodology,
      completionRate: 0,
      context: {
        device: this.getDeviceInfo(sessionData.context),
        browser: this.getBrowserInfo(sessionData.context),
        location: this.getLocationInfo(sessionData.context),
        utm: this.getUTMParameters(sessionData.context),
        ...sessionData.context
      } as SessionContext,
      journey: {
        steps: [],
        currentStep: 0,
        totalSteps: this.getExpectedSteps(sessionData.type),
        completionFunnel: [],
        dropOffPoints: [],
        conversionEvents: []
      },
      metrics: {
        pageViews: 0,
        uniquePages: 0,
        bounceRate: 0,
        engagementScore: 0,
        taskCompletionRate: 0,
        errorCount: 0,
        performanceScore: 100,
        usabilityScore: 100
      }
    };

    this.activeSessions.set(sessionData.sessionId, session);
    await this.storeSession(session);

    // Track session start event
    await this.trackConversionEvent(sessionData.sessionId, 'session_started', {
      sessionType: sessionData.type,
      methodology: sessionData.methodology
    });

    this.logger.info('User session started', {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId,
      type: sessionData.type,
      device: session.context.device.type
    });

    this.emit('sessionStarted', session);
  }

  /**
   * Track journey step
   */
  async trackJourneyStep(
    sessionId: string,
    stepId: string,
    stepName: string,
    stepData?: Record<string, any>
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const step: JourneyStep = {
      stepId,
      name: stepName,
      timestamp: Date.now(),
      status: 'started',
      data: stepData
    };

    session.journey.steps.push(step);
    session.journey.currentStep++;

    // Update completion rate
    session.completionRate = (session.journey.currentStep / session.journey.totalSteps) * 100;

    await this.storeSession(session);

    this.logger.debug('Journey step tracked', {
      sessionId,
      stepId,
      stepName,
      currentStep: session.journey.currentStep,
      totalSteps: session.journey.totalSteps
    });

    this.emit('stepTracked', { session, step });
  }

  /**
   * Complete journey step
   */
  async completeJourneyStep(
    sessionId: string,
    stepId: string,
    stepData?: Record<string, any>
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const step = session.journey.steps.find(s => s.stepId === stepId);
    if (step) {
      step.status = 'completed';
      step.duration = Date.now() - step.timestamp;
      step.data = { ...step.data, ...stepData };

      // Update metrics
      session.metrics.taskCompletionRate = 
        session.journey.steps.filter(s => s.status === 'completed').length / 
        session.journey.steps.length * 100;

      await this.storeSession(session);

      this.emit('stepCompleted', { session, step });
    }
  }

  /**
   * Track user error
   */
  async trackError(sessionId: string, error: {
    type: string;
    message: string;
    step?: string;
    severity: 'low' | 'medium' | 'high';
  }): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.metrics.errorCount++;

    // Add error to current step if available
    const currentStep = session.journey.steps[session.journey.steps.length - 1];
    if (currentStep) {
      if (!currentStep.errors) currentStep.errors = [];
      currentStep.errors.push(`${error.type}: ${error.message}`);
    }

    // Decrease usability score based on error severity
    const scoreDeduction = { low: 5, medium: 10, high: 20 }[error.severity];
    session.metrics.usabilityScore = Math.max(0, session.metrics.usabilityScore - scoreDeduction);

    await this.storeSession(session);

    this.logger.warn('User error tracked', {
      sessionId,
      errorType: error.type,
      errorMessage: error.message,
      step: error.step,
      severity: error.severity
    });

    this.emit('errorTracked', { session, error });
  }

  /**
   * Track conversion event
   */
  async trackConversionEvent(
    sessionId: string,
    eventName: string,
    properties?: Record<string, any>,
    value?: number
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      // Create temporary session for conversion tracking
      await this.createConversionOnlySession(sessionId, eventName, properties, value);
      return;
    }

    const conversionEvent: ConversionEvent = {
      eventName,
      timestamp: Date.now(),
      value,
      properties: properties || {}
    };

    session.journey.conversionEvents.push(conversionEvent);
    await this.storeSession(session);

    // Update conversion funnels
    await this.updateConversionFunnels(session, conversionEvent);

    this.logger.info('Conversion event tracked', {
      sessionId,
      eventName,
      value,
      properties
    });

    this.emit('conversionTracked', { session, event: conversionEvent });
  }

  /**
   * Complete user session
   */
  async completeSession(sessionId: string, outcome: {
    status: 'completed' | 'abandoned' | 'failed';
    satisfactionScore?: number;
    feedback?: Partial<UserFeedback>;
  }): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.status = outcome.status;
    session.endTime = Date.now();
    session.duration = session.endTime - session.startTime;
    session.satisfactionScore = outcome.satisfactionScore;

    if (outcome.feedback) {
      session.feedback = {
        timestamp: Date.now(),
        ...outcome.feedback
      };
    }

    // Calculate final metrics
    await this.calculateFinalMetrics(session);

    // Store completed session
    await this.storeSession(session);
    this.activeSessions.delete(sessionId);

    // Record business metrics
    await this.recordBusinessMetrics(session);

    this.logger.info('User session completed', {
      sessionId,
      userId: session.userId,
      status: outcome.status,
      duration: session.duration,
      completionRate: session.completionRate,
      satisfactionScore: outcome.satisfactionScore
    });

    this.emit('sessionCompleted', session);
  }

  /**
   * Record business metric
   */
  async recordBusinessMetric(
    name: string,
    value: number,
    unit: string,
    dimensions?: Record<string, string>,
    metadata?: Record<string, any>
  ): Promise<void> {
    const metric: BusinessMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      dimensions: dimensions || {},
      metadata: metadata || {}
    };

    if (!this.businessMetrics.has(name)) {
      this.businessMetrics.set(name, []);
    }

    const metrics = this.businessMetrics.get(name)!;
    metrics.push(metric);

    // Keep only recent metrics (last 24 hours)
    const cutoff = Date.now() - 86400000;
    this.businessMetrics.set(name, metrics.filter(m => m.timestamp > cutoff));

    // Store in Redis
    await this.storeBusinessMetric(metric);

    this.logger.debug('Business metric recorded', {
      name,
      value,
      unit,
      dimensions
    });

    this.emit('businessMetricRecorded', metric);
  }

  /**
   * Collect user feedback
   */
  async collectFeedback(sessionId: string, feedback: UserFeedback): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.feedback = feedback;
      await this.storeSession(session);
    }

    // Store feedback separately for analysis
    await this.storeFeedback(sessionId, feedback);

    this.logger.info('User feedback collected', {
      sessionId,
      npsScore: feedback.npsScore,
      satisfactionRating: feedback.satisfactionRating,
      usabilityRating: feedback.usabilityRating
    });

    this.emit('feedbackCollected', { sessionId, feedback });
  }

  /**
   * Clean up abandoned sessions
   */
  private async cleanupAbandonedSessions(): Promise<void> {
    const timeout = this.config.tracking.sessionTimeout;
    const cutoff = Date.now() - timeout;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.startTime < cutoff && session.status === 'active') {
        // Mark as abandoned
        session.status = 'abandoned';
        session.endTime = Date.now();
        session.duration = session.endTime - session.startTime;

        await this.completeSession(sessionId, { status: 'abandoned' });

        this.logger.info('Session marked as abandoned', {
          sessionId,
          duration: session.duration,
          completionRate: session.completionRate
        });
      }
    }
  }

  /**
   * Generate session reports
   */
  private async generateSessionReports(): Promise<void> {
    const now = Date.now();
    const hourStart = now - 3600000; // Last hour

    // Get completed sessions from last hour
    const sessions = await this.getCompletedSessions(hourStart, now);

    if (sessions.length === 0) return;

    // Calculate hourly metrics
    const metrics = {
      totalSessions: sessions.length,
      completedSessions: sessions.filter(s => s.status === 'completed').length,
      abandonedSessions: sessions.filter(s => s.status === 'abandoned').length,
      averageDuration: sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / sessions.length,
      averageCompletionRate: sessions.reduce((sum, s) => sum + s.completionRate, 0) / sessions.length,
      averageSatisfaction: this.calculateAverageSatisfaction(sessions),
      deviceBreakdown: this.calculateDeviceBreakdown(sessions),
      errorRate: sessions.reduce((sum, s) => sum + s.metrics.errorCount, 0) / sessions.length
    };

    // Store hourly report
    await this.storeHourlyReport(hourStart, metrics);

    this.emit('hourlyReport', metrics);
  }

  /**
   * Aggregate metrics for dashboards
   */
  private async aggregateMetrics(): Promise<void> {
    // Aggregate conversion rates
    const conversionRates = await this.calculateConversionRates();
    
    // Aggregate user satisfaction
    const satisfactionScores = await this.calculateSatisfactionTrends();
    
    // Aggregate performance scores
    const performanceScores = await this.calculatePerformanceScores();

    const aggregatedMetrics = {
      timestamp: Date.now(),
      conversions: conversionRates,
      satisfaction: satisfactionScores,
      performance: performanceScores
    };

    await this.storeAggregatedMetrics(aggregatedMetrics);
    this.emit('metricsAggregated', aggregatedMetrics);
  }

  /**
   * Analyze conversion funnels
   */
  private async analyzeConversionFunnels(): Promise<void> {
    for (const [funnelName, funnel] of this.conversionFunnels.entries()) {
      const analysis = await this.analyzeFunnel(funnel);
      
      // Update funnel with analysis
      funnel.conversions = analysis.conversions;
      funnel.overallConversionRate = analysis.overallConversionRate;
      funnel.dropOffAnalysis = analysis.dropOffAnalysis;

      // Store updated funnel
      await this.storeFunnelAnalysis(funnelName, funnel);

      // Emit alerts for significant drop-offs
      const significantDropOffs = analysis.dropOffAnalysis.filter(d => d.dropOffRate > 0.5);
      if (significantDropOffs.length > 0) {
        this.emit('funnelAlert', {
          funnel: funnelName,
          dropOffs: significantDropOffs
        });
      }
    }
  }

  // Utility and calculation methods
  private calculateFinalMetrics(session: UserSession): Promise<void> {
    // Calculate engagement score
    const engagementFactors = [
      session.journey.steps.length / session.journey.totalSteps, // Step completion
      Math.min(session.duration || 0, 1800000) / 1800000, // Time engagement (max 30 min)
      (session.journey.conversionEvents.length || 0) / 5, // Conversion events
      1 - (session.metrics.errorCount / 10) // Error penalty
    ];

    session.metrics.engagementScore = 
      engagementFactors.reduce((sum, factor) => sum + Math.max(0, Math.min(1, factor)), 0) / 
      engagementFactors.length * 100;

    // Calculate bounce rate (single step sessions)
    session.metrics.bounceRate = session.journey.steps.length <= 1 ? 100 : 0;

    return Promise.resolve();
  }

  private async recordBusinessMetrics(session: UserSession): Promise<void> {
    // Record session completion metric
    await this.recordBusinessMetric(
      'session_completion_rate',
      session.status === 'completed' ? 1 : 0,
      'boolean',
      {
        session_type: session.type,
        methodology: session.methodology || 'unknown',
        device_type: session.context.device.type
      }
    );

    // Record session duration
    if (session.duration) {
      await this.recordBusinessMetric(
        'session_duration',
        session.duration,
        'milliseconds',
        {
          session_type: session.type,
          status: session.status
        }
      );
    }

    // Record satisfaction score if available
    if (session.satisfactionScore) {
      await this.recordBusinessMetric(
        'user_satisfaction',
        session.satisfactionScore,
        'score',
        {
          session_type: session.type
        }
      );
    }
  }

  private async updateConversionFunnels(session: UserSession, event: ConversionEvent): Promise<void> {
    // Update relevant funnels based on event
    for (const [funnelName, funnel] of this.conversionFunnels.entries()) {
      if (funnel.steps.includes(event.eventName)) {
        // Track user progress in funnel
        await this.trackFunnelProgress(session, funnel, event.eventName);
      }
    }
  }

  private async trackFunnelProgress(session: UserSession, funnel: ConversionFunnel, eventName: string): Promise<void> {
    const stepIndex = funnel.steps.indexOf(eventName);
    if (stepIndex === -1) return;

    // Store funnel progress in Redis for analysis
    const key = `${this.config.redis.keyPrefix}:funnel:${funnel.name}:${session.userId || session.sessionId}`;
    await this.redis.hset(key, eventName, Date.now());
    await this.redis.expire(key, 86400 * 30); // 30 days retention
  }

  // Storage methods
  private async storeSession(session: UserSession): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:sessions:${session.sessionId}`;
    await this.redis.setex(key, 86400 * 7, JSON.stringify(session)); // 7 days retention
  }

  private async storeBusinessMetric(metric: BusinessMetric): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:business:${metric.name}:${Math.floor(metric.timestamp / 60000)}`;
    await this.redis.setex(key, 86400 * 30, JSON.stringify(metric)); // 30 days retention
  }

  private async storeFeedback(sessionId: string, feedback: UserFeedback): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:feedback:${sessionId}`;
    await this.redis.setex(key, 86400 * 90, JSON.stringify(feedback)); // 90 days retention
  }

  private async storeHourlyReport(timestamp: number, metrics: any): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:reports:hourly:${Math.floor(timestamp / 3600000)}`;
    await this.redis.setex(key, 86400 * 7, JSON.stringify(metrics)); // 7 days retention
  }

  private async storeAggregatedMetrics(metrics: any): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:aggregated:${Math.floor(metrics.timestamp / 600000)}`;
    await this.redis.setex(key, 86400 * 30, JSON.stringify(metrics)); // 30 days retention
  }

  private async storeFunnelAnalysis(funnelName: string, funnel: ConversionFunnel): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:funnel_analysis:${funnelName}`;
    await this.redis.setex(key, 86400 * 7, JSON.stringify(funnel)); // 7 days retention
  }

  // Helper methods for context extraction
  private getDeviceInfo(context: any): DeviceInfo {
    return {
      type: context.deviceType || 'desktop',
      os: context.os || 'unknown',
      osVersion: context.osVersion || 'unknown',
      screenResolution: context.screenResolution || 'unknown',
      viewport: context.viewport || 'unknown',
      touchSupport: context.touchSupport || false
    };
  }

  private getBrowserInfo(context: any): BrowserInfo {
    return {
      name: context.browserName || 'unknown',
      version: context.browserVersion || 'unknown',
      language: context.language || 'en',
      timezone: context.timezone || 'UTC',
      cookiesEnabled: context.cookiesEnabled !== false,
      javaScriptEnabled: true
    };
  }

  private getLocationInfo(context: any): LocationInfo {
    return {
      country: context.country,
      region: context.region,
      city: context.city,
      timezone: context.timezone || 'UTC',
      coordinates: context.coordinates
    };
  }

  private getUTMParameters(context: any): UTMParameters {
    return {
      source: context.utm_source,
      medium: context.utm_medium,
      campaign: context.utm_campaign,
      term: context.utm_term,
      content: context.utm_content
    };
  }

  private getExpectedSteps(sessionType: string): number {
    const stepCounts: Record<string, number> = {
      planning: 5,
      analysis: 4,
      review: 3,
      export: 2
    };
    return stepCounts[sessionType] || 3;
  }

  // Analysis methods (simplified implementations)
  private async getCompletedSessions(startTime: number, endTime: number): Promise<UserSession[]> {
    // Mock implementation - would query Redis for actual session data
    return [];
  }

  private calculateAverageSatisfaction(sessions: UserSession[]): number {
    const withSatisfaction = sessions.filter(s => s.satisfactionScore);
    return withSatisfaction.length > 0 
      ? withSatisfaction.reduce((sum, s) => sum + s.satisfactionScore!, 0) / withSatisfaction.length
      : 0;
  }

  private calculateDeviceBreakdown(sessions: UserSession[]): Record<string, number> {
    const breakdown: Record<string, number> = {};
    sessions.forEach(session => {
      const deviceType = session.context.device.type;
      breakdown[deviceType] = (breakdown[deviceType] || 0) + 1;
    });
    return breakdown;
  }

  private async calculateConversionRates(): Promise<Record<string, number>> {
    // Mock implementation
    return {
      trial_to_paid: 0.15,
      signup_to_active: 0.75,
      session_completion: 0.85
    };
  }

  private async calculateSatisfactionTrends(): Promise<Record<string, number>> {
    // Mock implementation
    return {
      nps: 42,
      satisfaction: 4.2,
      usability: 4.5
    };
  }

  private async calculatePerformanceScores(): Promise<Record<string, number>> {
    // Mock implementation
    return {
      overall: 85,
      engagement: 78,
      completion: 82
    };
  }

  private async analyzeFunnel(funnel: ConversionFunnel): Promise<any> {
    // Mock implementation - would analyze actual funnel data
    return {
      conversions: [],
      overallConversionRate: 0.65,
      dropOffAnalysis: []
    };
  }

  private async createConversionOnlySession(
    sessionId: string,
    eventName: string,
    properties?: Record<string, any>,
    value?: number
  ): Promise<void> {
    // Create minimal session for conversion tracking
    const conversionEvent: ConversionEvent = {
      eventName,
      timestamp: Date.now(),
      value,
      properties: properties || {}
    };

    const key = `${this.config.redis.keyPrefix}:conversions:${sessionId}:${eventName}`;
    await this.redis.setex(key, 86400 * 30, JSON.stringify(conversionEvent));
  }

  // Public API methods
  getActiveSessions(): UserSession[] {
    return Array.from(this.activeSessions.values());
  }

  async getSessionMetrics(timeWindow: number = 3600000): Promise<any> {
    const now = Date.now();
    const startTime = now - timeWindow;
    
    // This would query actual session data
    return {
      totalSessions: this.activeSessions.size,
      completionRate: 0.85,
      averageDuration: 1200000, // 20 minutes
      satisfactionScore: 4.2,
      errorRate: 0.05
    };
  }

  async getFunnelAnalysis(funnelName: string): Promise<ConversionFunnel | undefined> {
    return this.conversionFunnels.get(funnelName);
  }

  async getBusinessMetrics(metricName: string, timeWindow: number = 3600000): Promise<BusinessMetric[]> {
    const metrics = this.businessMetrics.get(metricName) || [];
    const cutoff = Date.now() - timeWindow;
    return metrics.filter(m => m.timestamp > cutoff);
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down user experience monitor...');
    
    // Complete any active sessions
    for (const [sessionId, session] of this.activeSessions.entries()) {
      await this.completeSession(sessionId, { status: 'abandoned' });
    }
    
    await this.redis.disconnect();
    this.logger.info('User experience monitor shutdown complete');
  }
}

export default UserExperienceMonitor;