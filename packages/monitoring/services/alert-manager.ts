import { EventEmitter } from 'events';
import winston from 'winston';
import Redis from 'ioredis';
import * as Sentry from '@sentry/node';

/**
 * Alert Management Service
 * Automated alerting with escalation procedures and multi-channel notifications
 */

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: string;
  condition: AlertCondition;
  threshold: number;
  duration: number; // seconds
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  enabled: boolean;
  tags: string[];
  channels: AlertChannel[];
  escalation?: EscalationRule;
  suppressions?: SuppressionRule[];
  createdAt: number;
  updatedAt: number;
}

export interface AlertCondition {
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';
  aggregation: 'avg' | 'sum' | 'min' | 'max' | 'count' | 'p95' | 'p99';
  window: number; // seconds
  groupBy?: string[];
}

export interface AlertChannel {
  type: 'email' | 'slack' | 'webhook' | 'pagerduty' | 'sms';
  config: Record<string, any>;
  enabled: boolean;
}

export interface EscalationRule {
  levels: EscalationLevel[];
  enabled: boolean;
}

export interface EscalationLevel {
  level: number;
  delay: number; // seconds
  channels: AlertChannel[];
  recipients: string[];
}

export interface SuppressionRule {
  condition: string;
  duration: number; // seconds
  reason: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  status: 'firing' | 'resolved';
  severity: string;
  message: string;
  description?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  value: number;
  threshold: number;
  startsAt: number;
  endsAt?: number;
  updatedAt: number;
  fingerprint: string;
  correlationId?: string;
  escalationLevel: number;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolvedBy?: string;
  resolvedAt?: number;
}

export interface AlertNotification {
  id: string;
  alertId: string;
  channel: AlertChannel;
  status: 'pending' | 'sent' | 'failed' | 'acknowledged';
  sentAt?: number;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
}

export interface AlertManagerConfig {
  redis: {
    url: string;
    keyPrefix: string;
  };
  sentry: {
    dsn: string;
    environment: string;
  };
  channels: {
    email?: EmailChannelConfig;
    slack?: SlackChannelConfig;
    webhook?: WebhookChannelConfig;
    pagerduty?: PagerDutyChannelConfig;
    sms?: SMSChannelConfig;
  };
  processing: {
    evaluationInterval: number;
    batchSize: number;
    retentionPeriod: number;
  };
}

export interface EmailChannelConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  from: string;
  templates: {
    subject: string;
    body: string;
  };
}

export interface SlackChannelConfig {
  webhookUrl: string;
  channel: string;
  username: string;
  iconEmoji: string;
}

export interface WebhookChannelConfig {
  url: string;
  headers: Record<string, string>;
  timeout: number;
}

export interface PagerDutyChannelConfig {
  integrationKey: string;
  apiUrl: string;
}

export interface SMSChannelConfig {
  provider: 'twilio' | 'aws-sns';
  config: Record<string, any>;
}

/**
 * Alert Manager
 * Processes alert rules, manages alert lifecycle, and handles notifications
 */
export class AlertManager extends EventEmitter {
  private redis: Redis;
  private logger: winston.Logger;
  private config: AlertManagerConfig;
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private notifications: Map<string, AlertNotification> = new Map();
  private evaluationTimer: NodeJS.Timer | null = null;
  private channelHandlers: Map<string, ChannelHandler> = new Map();

  constructor(config: AlertManagerConfig) {
    super();
    this.config = config;
    
    this.initializeRedis();
    this.initializeLogger();
    this.initializeSentry();
    this.initializeChannelHandlers();
    this.startEvaluation();
    this.loadAlertRules();
  }

  /**
   * Initialize Redis for alert state storage
   */
  private initializeRedis(): void {
    this.redis = new Redis(this.config.redis.url, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.redis.on('error', (error) => {
      this.logger.error('Alert Manager Redis error', { error: error.message });
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
      defaultMeta: { service: 'alert-manager' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: 'logs/alert-manager.log',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Initialize Sentry for error tracking
   */
  private initializeSentry(): void {
    if (this.config.sentry?.dsn) {
      Sentry.init({
        dsn: this.config.sentry.dsn,
        environment: this.config.sentry.environment || 'production',
        integrations: [
          new Sentry.Integrations.Http({ tracing: true })
        ],
        tracesSampleRate: 1.0
      });
    }
  }

  /**
   * Initialize notification channel handlers
   */
  private initializeChannelHandlers(): void {
    if (this.config.channels.email) {
      this.channelHandlers.set('email', new EmailChannelHandler(this.config.channels.email));
    }
    if (this.config.channels.slack) {
      this.channelHandlers.set('slack', new SlackChannelHandler(this.config.channels.slack));
    }
    if (this.config.channels.webhook) {
      this.channelHandlers.set('webhook', new WebhookChannelHandler(this.config.channels.webhook));
    }
    if (this.config.channels.pagerduty) {
      this.channelHandlers.set('pagerduty', new PagerDutyChannelHandler(this.config.channels.pagerduty));
    }
    if (this.config.channels.sms) {
      this.channelHandlers.set('sms', new SMSChannelHandler(this.config.channels.sms));
    }
  }

  /**
   * Start alert rule evaluation
   */
  private startEvaluation(): void {
    const interval = this.config.processing.evaluationInterval || 30000; // 30 seconds default
    
    this.evaluationTimer = setInterval(async () => {
      try {
        await this.evaluateAlertRules();
      } catch (error) {
        this.logger.error('Alert evaluation failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (this.config.sentry?.dsn) {
          Sentry.captureException(error);
        }
      }
    }, interval);

    this.logger.info('Alert evaluation started', { interval });
  }

  /**
   * Load alert rules from storage
   */
  private async loadAlertRules(): Promise<void> {
    try {
      const ruleKeys = await this.redis.keys(`${this.config.redis.keyPrefix}:rules:*`);
      
      for (const key of ruleKeys) {
        const ruleData = await this.redis.hgetall(key);
        if (ruleData.id) {
          const rule: AlertRule = {
            id: ruleData.id,
            name: ruleData.name,
            description: ruleData.description || '',
            metric: ruleData.metric,
            condition: JSON.parse(ruleData.condition),
            threshold: parseFloat(ruleData.threshold),
            duration: parseInt(ruleData.duration),
            severity: ruleData.severity as any,
            enabled: ruleData.enabled === 'true',
            tags: JSON.parse(ruleData.tags || '[]'),
            channels: JSON.parse(ruleData.channels || '[]'),
            escalation: ruleData.escalation ? JSON.parse(ruleData.escalation) : undefined,
            suppressions: ruleData.suppressions ? JSON.parse(ruleData.suppressions) : undefined,
            createdAt: parseInt(ruleData.createdAt),
            updatedAt: parseInt(ruleData.updatedAt)
          };
          
          this.alertRules.set(rule.id, rule);
        }
      }

      this.logger.info('Alert rules loaded', { count: this.alertRules.size });
      
    } catch (error) {
      this.logger.error('Failed to load alert rules', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Add or update alert rule
   */
  async addAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const ruleId = this.generateRuleId();
    const now = Date.now();
    
    const alertRule: AlertRule = {
      id: ruleId,
      createdAt: now,
      updatedAt: now,
      ...rule
    };

    // Store in Redis
    const key = `${this.config.redis.keyPrefix}:rules:${ruleId}`;
    await this.redis.hset(key, {
      id: alertRule.id,
      name: alertRule.name,
      description: alertRule.description,
      metric: alertRule.metric,
      condition: JSON.stringify(alertRule.condition),
      threshold: alertRule.threshold.toString(),
      duration: alertRule.duration.toString(),
      severity: alertRule.severity,
      enabled: alertRule.enabled.toString(),
      tags: JSON.stringify(alertRule.tags),
      channels: JSON.stringify(alertRule.channels),
      escalation: alertRule.escalation ? JSON.stringify(alertRule.escalation) : '',
      suppressions: alertRule.suppressions ? JSON.stringify(alertRule.suppressions) : '',
      createdAt: alertRule.createdAt.toString(),
      updatedAt: alertRule.updatedAt.toString()
    });

    // Store in memory
    this.alertRules.set(ruleId, alertRule);

    this.logger.info('Alert rule added', {
      ruleId,
      name: alertRule.name,
      metric: alertRule.metric,
      severity: alertRule.severity
    });

    this.emit('ruleAdded', alertRule);
    return ruleId;
  }

  /**
   * Remove alert rule
   */
  async removeAlertRule(ruleId: string): Promise<void> {
    // Remove from Redis
    const key = `${this.config.redis.keyPrefix}:rules:${ruleId}`;
    await this.redis.del(key);

    // Remove from memory
    const rule = this.alertRules.get(ruleId);
    this.alertRules.delete(ruleId);

    // Resolve any active alerts for this rule
    const activeAlertsForRule = Array.from(this.activeAlerts.values())
      .filter(alert => alert.ruleId === ruleId);
    
    for (const alert of activeAlertsForRule) {
      await this.resolveAlert(alert.id, 'system');
    }

    this.logger.info('Alert rule removed', {
      ruleId,
      name: rule?.name
    });

    this.emit('ruleRemoved', { ruleId, rule });
  }

  /**
   * Evaluate all alert rules
   */
  private async evaluateAlertRules(): Promise<void> {
    const enabledRules = Array.from(this.alertRules.values())
      .filter(rule => rule.enabled);

    this.logger.debug('Evaluating alert rules', { count: enabledRules.length });

    for (const rule of enabledRules) {
      try {
        await this.evaluateRule(rule);
      } catch (error) {
        this.logger.error('Rule evaluation failed', {
          ruleId: rule.id,
          ruleName: rule.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Evaluate individual alert rule
   */
  private async evaluateRule(rule: AlertRule): Promise<void> {
    // Get metric value
    const metricValue = await this.getMetricValue(rule.metric, rule.condition);
    
    // Check if suppression rules apply
    if (await this.isSuppressed(rule, metricValue)) {
      return;
    }

    // Evaluate condition
    const conditionMet = this.evaluateCondition(metricValue, rule.threshold, rule.condition.operator);
    const fingerprint = this.generateFingerprint(rule, metricValue);
    
    // Check if alert already exists
    const existingAlert = Array.from(this.activeAlerts.values())
      .find(alert => alert.fingerprint === fingerprint);

    if (conditionMet) {
      if (!existingAlert) {
        // Create new alert
        await this.createAlert(rule, metricValue, fingerprint);
      } else {
        // Update existing alert
        await this.updateAlert(existingAlert, metricValue);
      }
    } else {
      if (existingAlert && existingAlert.status === 'firing') {
        // Resolve alert
        await this.resolveAlert(existingAlert.id, 'system');
      }
    }
  }

  /**
   * Get metric value for evaluation
   */
  private async getMetricValue(metric: string, condition: AlertCondition): Promise<number> {
    // This would integrate with the metrics collector
    // For now, return a mock value
    return Math.random() * 100;
  }

  /**
   * Check if alert is suppressed
   */
  private async isSuppressed(rule: AlertRule, value: number): Promise<boolean> {
    if (!rule.suppressions) return false;

    for (const suppression of rule.suppressions) {
      // Evaluate suppression condition
      // This is a simplified implementation
      if (suppression.condition === 'maintenance_window') {
        // Check if in maintenance window
        return this.isInMaintenanceWindow();
      }
    }

    return false;
  }

  private isInMaintenanceWindow(): boolean {
    // Implementation would check against maintenance schedules
    return false;
  }

  /**
   * Evaluate alert condition
   */
  private evaluateCondition(value: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      case 'ne': return value !== threshold;
      default: return false;
    }
  }

  /**
   * Create new alert
   */
  private async createAlert(rule: AlertRule, value: number, fingerprint: string): Promise<void> {
    const alertId = this.generateAlertId();
    const now = Date.now();

    const alert: Alert = {
      id: alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      status: 'firing',
      severity: rule.severity,
      message: this.generateAlertMessage(rule, value),
      description: rule.description,
      labels: {
        severity: rule.severity,
        metric: rule.metric,
        rule: rule.name
      },
      annotations: {
        description: rule.description || '',
        runbook: '', // Would contain runbook URL
        summary: this.generateAlertSummary(rule, value)
      },
      value,
      threshold: rule.threshold,
      startsAt: now,
      updatedAt: now,
      fingerprint,
      escalationLevel: 0
    };

    // Store alert
    this.activeAlerts.set(alertId, alert);
    await this.persistAlert(alert);

    // Send notifications
    await this.sendAlertNotifications(alert, rule);

    this.logger.warn('Alert fired', {
      alertId,
      ruleName: rule.name,
      severity: rule.severity,
      value,
      threshold: rule.threshold
    });

    this.emit('alertFired', alert);
  }

  /**
   * Update existing alert
   */
  private async updateAlert(alert: Alert, value: number): Promise<void> {
    alert.value = value;
    alert.updatedAt = Date.now();

    await this.persistAlert(alert);
    this.emit('alertUpdated', alert);
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.status = 'resolved';
    alert.endsAt = Date.now();
    alert.resolvedBy = resolvedBy;
    alert.resolvedAt = Date.now();
    alert.updatedAt = Date.now();

    await this.persistAlert(alert);
    
    // Send resolution notifications
    const rule = this.alertRules.get(alert.ruleId);
    if (rule) {
      await this.sendResolutionNotifications(alert, rule);
    }

    // Remove from active alerts
    this.activeAlerts.delete(alertId);

    this.logger.info('Alert resolved', {
      alertId,
      ruleName: alert.ruleName,
      resolvedBy,
      duration: alert.endsAt! - alert.startsAt
    });

    this.emit('alertResolved', alert);
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = Date.now();
    alert.updatedAt = Date.now();

    await this.persistAlert(alert);

    this.logger.info('Alert acknowledged', {
      alertId,
      ruleName: alert.ruleName,
      acknowledgedBy
    });

    this.emit('alertAcknowledged', alert);
  }

  /**
   * Send alert notifications
   */
  private async sendAlertNotifications(alert: Alert, rule: AlertRule): Promise<void> {
    for (const channel of rule.channels.filter(c => c.enabled)) {
      const notification: AlertNotification = {
        id: this.generateNotificationId(),
        alertId: alert.id,
        channel,
        status: 'pending',
        retryCount: 0,
        maxRetries: 3
      };

      this.notifications.set(notification.id, notification);

      try {
        await this.sendNotification(notification, alert);
        notification.status = 'sent';
        notification.sentAt = Date.now();
        
        this.logger.info('Alert notification sent', {
          notificationId: notification.id,
          alertId: alert.id,
          channel: channel.type
        });
        
      } catch (error) {
        notification.status = 'failed';
        notification.failureReason = error instanceof Error ? error.message : 'Unknown error';
        
        this.logger.error('Alert notification failed', {
          notificationId: notification.id,
          alertId: alert.id,
          channel: channel.type,
          error: notification.failureReason
        });

        // Schedule retry
        if (notification.retryCount < notification.maxRetries) {
          setTimeout(() => {
            this.retryNotification(notification.id);
          }, Math.pow(2, notification.retryCount) * 1000);
        }
      }
    }
  }

  /**
   * Send resolution notifications
   */
  private async sendResolutionNotifications(alert: Alert, rule: AlertRule): Promise<void> {
    for (const channel of rule.channels.filter(c => c.enabled)) {
      try {
        await this.sendResolutionNotification(channel, alert);
        
        this.logger.info('Resolution notification sent', {
          alertId: alert.id,
          channel: channel.type
        });
        
      } catch (error) {
        this.logger.error('Resolution notification failed', {
          alertId: alert.id,
          channel: channel.type,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Send notification through channel
   */
  private async sendNotification(notification: AlertNotification, alert: Alert): Promise<void> {
    const handler = this.channelHandlers.get(notification.channel.type);
    if (!handler) {
      throw new Error(`No handler for channel type: ${notification.channel.type}`);
    }

    await handler.sendAlert(notification.channel, alert);
  }

  /**
   * Send resolution notification
   */
  private async sendResolutionNotification(channel: AlertChannel, alert: Alert): Promise<void> {
    const handler = this.channelHandlers.get(channel.type);
    if (!handler) {
      throw new Error(`No handler for channel type: ${channel.type}`);
    }

    await handler.sendResolution(channel, alert);
  }

  /**
   * Retry failed notification
   */
  private async retryNotification(notificationId: string): Promise<void> {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.retryCount >= notification.maxRetries) {
      return;
    }

    notification.retryCount++;
    notification.status = 'pending';

    const alert = this.activeAlerts.get(notification.alertId);
    if (alert) {
      try {
        await this.sendNotification(notification, alert);
        notification.status = 'sent';
        notification.sentAt = Date.now();
      } catch (error) {
        notification.status = 'failed';
        notification.failureReason = error instanceof Error ? error.message : 'Unknown error';
        
        // Schedule another retry if retries remain
        if (notification.retryCount < notification.maxRetries) {
          setTimeout(() => {
            this.retryNotification(notificationId);
          }, Math.pow(2, notification.retryCount) * 1000);
        }
      }
    }
  }

  /**
   * Persist alert to Redis
   */
  private async persistAlert(alert: Alert): Promise<void> {
    const key = `${this.config.redis.keyPrefix}:alerts:${alert.id}`;
    await this.redis.hset(key, {
      id: alert.id,
      ruleId: alert.ruleId,
      status: alert.status,
      data: JSON.stringify(alert)
    });

    // Set expiration for resolved alerts
    if (alert.status === 'resolved') {
      await this.redis.expire(key, this.config.processing.retentionPeriod || 86400); // 24 hours
    }
  }

  // Utility methods
  private generateRuleId(): string {
    return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateNotificationId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFingerprint(rule: AlertRule, value: number): string {
    const crypto = require('crypto');
    const data = `${rule.id}:${rule.metric}:${Math.floor(Date.now() / 60000)}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private generateAlertMessage(rule: AlertRule, value: number): string {
    return `${rule.name}: ${rule.metric} is ${value} (threshold: ${rule.threshold})`;
  }

  private generateAlertSummary(rule: AlertRule, value: number): string {
    return `Alert ${rule.name} has been triggered. Current value: ${value}, Threshold: ${rule.threshold}`;
  }

  // Public API methods
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  getAlertRule(ruleId: string): AlertRule | undefined {
    return this.alertRules.get(ruleId);
  }

  async getAlertHistory(limit: number = 100): Promise<Alert[]> {
    const keys = await this.redis.keys(`${this.config.redis.keyPrefix}:alerts:*`);
    const alerts: Alert[] = [];

    for (const key of keys.slice(0, limit)) {
      const data = await this.redis.hget(key, 'data');
      if (data) {
        alerts.push(JSON.parse(data));
      }
    }

    return alerts.sort((a, b) => b.startsAt - a.startsAt);
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down alert manager...');

    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
    }

    await this.redis.disconnect();
    this.logger.info('Alert manager shutdown complete');
  }
}

// Channel handler interfaces and implementations
interface ChannelHandler {
  sendAlert(channel: AlertChannel, alert: Alert): Promise<void>;
  sendResolution(channel: AlertChannel, alert: Alert): Promise<void>;
}

class EmailChannelHandler implements ChannelHandler {
  constructor(private config: EmailChannelConfig) {}

  async sendAlert(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock email implementation
    console.log(`Email alert sent: ${alert.message}`);
  }

  async sendResolution(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock email implementation
    console.log(`Email resolution sent: ${alert.message}`);
  }
}

class SlackChannelHandler implements ChannelHandler {
  constructor(private config: SlackChannelConfig) {}

  async sendAlert(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock Slack implementation
    console.log(`Slack alert sent: ${alert.message}`);
  }

  async sendResolution(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock Slack implementation
    console.log(`Slack resolution sent: ${alert.message}`);
  }
}

class WebhookChannelHandler implements ChannelHandler {
  constructor(private config: WebhookChannelConfig) {}

  async sendAlert(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock webhook implementation
    console.log(`Webhook alert sent: ${alert.message}`);
  }

  async sendResolution(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock webhook implementation
    console.log(`Webhook resolution sent: ${alert.message}`);
  }
}

class PagerDutyChannelHandler implements ChannelHandler {
  constructor(private config: PagerDutyChannelConfig) {}

  async sendAlert(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock PagerDuty implementation
    console.log(`PagerDuty alert sent: ${alert.message}`);
  }

  async sendResolution(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock PagerDuty implementation
    console.log(`PagerDuty resolution sent: ${alert.message}`);
  }
}

class SMSChannelHandler implements ChannelHandler {
  constructor(private config: SMSChannelConfig) {}

  async sendAlert(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock SMS implementation
    console.log(`SMS alert sent: ${alert.message}`);
  }

  async sendResolution(channel: AlertChannel, alert: Alert): Promise<void> {
    // Mock SMS implementation
    console.log(`SMS resolution sent: ${alert.message}`);
  }
}

export default AlertManager;