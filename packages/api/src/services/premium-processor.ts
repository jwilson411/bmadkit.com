import { z } from 'zod';
import { EventEmitter } from 'events';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { featureFlagManager, FeatureFlag, UserTier } from './feature-flag-manager';
import { subscriptionValidator } from './subscription-validator';
import type { AgentPhase } from '../models/workflow-models';

// Processing priority levels
export enum ProcessingPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  PREMIUM = 3,
  ENTERPRISE = 4
}

// Advanced planning session configuration
export interface AdvancedPlanningConfig {
  maxDuration: number; // minutes
  maxQuestions: number;
  allowDeepDiving: boolean;
  enableExpertAnalysis: boolean;
  customPrompts: string[];
  specializedAgents: AgentPhase[];
  analysisDepth: 'basic' | 'detailed' | 'comprehensive';
  includeRiskAnalysis: boolean;
  includeCompetitiveAnalysis: boolean;
  includeImplementationRoadmap: boolean;
}

// Processing job types
export enum ProcessingJobType {
  PLANNING_SESSION = 'planning_session',
  DOCUMENT_GENERATION = 'document_generation',
  TEMPLATE_PROCESSING = 'template_processing',
  SEARCH_QUERY = 'search_query',
  EXPORT_GENERATION = 'export_generation',
  ANALYSIS_TASK = 'analysis_task'
}

// Job processing schemas
export const ProcessingJobSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(ProcessingJobType),
  userId: z.string(),
  userTier: z.nativeEnum(UserTier),
  priority: z.nativeEnum(ProcessingPriority),
  data: z.record(z.any()),
  config: z.record(z.any()).optional(),
  metadata: z.object({
    submittedAt: z.date(),
    estimatedDuration: z.number().optional(),
    requiredFeatures: z.array(z.nativeEnum(FeatureFlag)).optional(),
    sourceIP: z.string().optional(),
    userAgent: z.string().optional()
  }),
  createdAt: z.date(),
  scheduledAt: z.date().optional()
});

export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;

// Processing result
export interface ProcessingResult {
  jobId: string;
  success: boolean;
  result?: any;
  error?: string;
  processingTime: number;
  queueTime: number;
  priority: ProcessingPriority;
  metadata: {
    processedAt: Date;
    processingNode: string;
    resourcesUsed: {
      cpu: number;
      memory: number;
      llmTokens?: number;
    };
  };
}

// Queue performance metrics
interface QueueMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageProcessingTime: number;
  averageQueueTime: number;
  jobsByPriority: Record<ProcessingPriority, number>;
  jobsByType: Record<ProcessingJobType, number>;
}

// Advanced planning configurations by tier
const PLANNING_CONFIGS: Record<UserTier, AdvancedPlanningConfig> = {
  [UserTier.FREE]: {
    maxDuration: 15, // 15 minutes
    maxQuestions: 20,
    allowDeepDiving: false,
    enableExpertAnalysis: false,
    customPrompts: [],
    specializedAgents: ['ANALYST'],
    analysisDepth: 'basic',
    includeRiskAnalysis: false,
    includeCompetitiveAnalysis: false,
    includeImplementationRoadmap: false
  },
  [UserTier.EMAIL_CAPTURED]: {
    maxDuration: 30, // 30 minutes
    maxQuestions: 35,
    allowDeepDiving: false,
    enableExpertAnalysis: false,
    customPrompts: [],
    specializedAgents: ['ANALYST', 'PM'],
    analysisDepth: 'basic',
    includeRiskAnalysis: false,
    includeCompetitiveAnalysis: false,
    includeImplementationRoadmap: false
  },
  [UserTier.PREMIUM]: {
    maxDuration: 90, // 90 minutes
    maxQuestions: 100,
    allowDeepDiving: true,
    enableExpertAnalysis: true,
    customPrompts: ['deep_analysis', 'expert_insights', 'industry_specific'],
    specializedAgents: ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'],
    analysisDepth: 'detailed',
    includeRiskAnalysis: true,
    includeCompetitiveAnalysis: true,
    includeImplementationRoadmap: true
  },
  [UserTier.ENTERPRISE]: {
    maxDuration: 180, // 3 hours
    maxQuestions: -1, // Unlimited
    allowDeepDiving: true,
    enableExpertAnalysis: true,
    customPrompts: ['deep_analysis', 'expert_insights', 'industry_specific', 'custom_enterprise'],
    specializedAgents: ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'],
    analysisDepth: 'comprehensive',
    includeRiskAnalysis: true,
    includeCompetitiveAnalysis: true,
    includeImplementationRoadmap: true
  }
};

export class PremiumProcessor extends EventEmitter {
  private static instance: PremiumProcessor;
  private redis: Redis;
  
  // Processing queues by priority
  private queues: Map<ProcessingPriority, Queue> = new Map();
  private workers: Map<ProcessingPriority, Worker> = new Map();
  
  // Performance tracking
  private metrics: QueueMetrics = {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    averageProcessingTime: 0,
    averageQueueTime: 0,
    jobsByPriority: {} as Record<ProcessingPriority, number>,
    jobsByType: {} as Record<ProcessingJobType, number>
  };

  // SLA targets by tier
  private readonly SLA_TARGETS = {
    [UserTier.FREE]: { processingTime: 60000, queueTime: 30000 }, // 60s processing, 30s queue
    [UserTier.EMAIL_CAPTURED]: { processingTime: 45000, queueTime: 20000 }, // 45s processing, 20s queue
    [UserTier.PREMIUM]: { processingTime: 30000, queueTime: 10000 }, // 30s processing, 10s queue
    [UserTier.ENTERPRISE]: { processingTime: 15000, queueTime: 5000 } // 15s processing, 5s queue
  };

  private constructor() {
    super();
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3
    });

    this.initializeQueues();
    this.startMetricsCollection();
  }

  static getInstance(): PremiumProcessor {
    if (!PremiumProcessor.instance) {
      PremiumProcessor.instance = new PremiumProcessor();
    }
    return PremiumProcessor.instance;
  }

  /**
   * Submit a job for processing with automatic priority assignment
   */
  async submitJob(jobData: Omit<ProcessingJob, 'id' | 'priority' | 'createdAt'>): Promise<string> {
    try {
      // Validate user access and determine priority
      const userContext = await subscriptionValidator.validateUserSubscription(jobData.userId);
      const priority = this.determinePriority(userContext.tier, jobData.type);
      
      // Check if user has required features
      if (jobData.metadata.requiredFeatures) {
        const hasAccess = jobData.metadata.requiredFeatures.every(feature =>
          userContext.features.includes(feature)
        );
        
        if (!hasAccess) {
          throw new Error('User does not have access to required features');
        }
      }

      // Create job
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const job: ProcessingJob = {
        id: jobId,
        type: jobData.type,
        userId: jobData.userId,
        userTier: jobData.userTier,
        priority,
        data: jobData.data,
        config: jobData.config,
        metadata: {
          ...jobData.metadata,
          submittedAt: new Date()
        },
        createdAt: new Date()
      };

      // Add to appropriate queue
      const queue = this.queues.get(priority);
      if (!queue) {
        throw new Error(`No queue found for priority ${priority}`);
      }

      await queue.add(jobData.type, job, {
        priority: priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      });

      // Update metrics
      this.updateMetrics('job_submitted', job);

      // Emit event
      this.emit('job_submitted', { jobId, job });

      console.log(`Job ${jobId} submitted to ${ProcessingPriority[priority]} priority queue`);
      return jobId;

    } catch (error) {
      console.error('Error submitting job:', error);
      throw error;
    }
  }

  /**
   * Submit advanced planning session
   */
  async submitAdvancedPlanningSession(params: {
    userId: string;
    projectData: any;
    customRequirements?: string[];
    analysisDepth?: 'basic' | 'detailed' | 'comprehensive';
  }): Promise<string> {
    const { userId, projectData, customRequirements, analysisDepth } = params;
    
    // Get user context and planning config
    const userContext = await subscriptionValidator.validateUserSubscription(userId);
    const planningConfig = this.getPlanningConfig(userContext.tier, analysisDepth);

    // Check if user has advanced planning access
    if (!userContext.features.includes(FeatureFlag.ADVANCED_PLANNING_SESSIONS)) {
      throw new Error('User does not have access to advanced planning sessions');
    }

    const jobData = {
      userId,
      userTier: userContext.tier,
      type: ProcessingJobType.PLANNING_SESSION,
      data: {
        projectData,
        customRequirements,
        planningConfig
      },
      config: {
        maxDuration: planningConfig.maxDuration,
        analysisDepth: planningConfig.analysisDepth,
        specializedAgents: planningConfig.specializedAgents
      },
      metadata: {
        submittedAt: new Date(),
        estimatedDuration: planningConfig.maxDuration * 60 * 1000, // Convert to milliseconds
        requiredFeatures: [FeatureFlag.ADVANCED_PLANNING_SESSIONS]
      }
    };

    return await this.submitJob(jobData);
  }

  /**
   * Get job status and result
   */
  async getJobResult(jobId: string): Promise<ProcessingResult | null> {
    try {
      // Search across all queues for the job
      for (const [priority, queue] of this.queues.entries()) {
        const job = await queue.getJob(jobId);
        if (job) {
          const result: ProcessingResult = {
            jobId,
            success: job.finishedOn !== null && job.failedReason === null,
            result: job.returnvalue,
            error: job.failedReason,
            processingTime: job.processedOn && job.finishedOn ? 
              job.finishedOn - job.processedOn : 0,
            queueTime: job.processedOn ? 
              job.processedOn - job.timestamp : 0,
            priority,
            metadata: {
              processedAt: job.processedOn ? new Date(job.processedOn) : new Date(),
              processingNode: job.opts?.jobId || 'unknown',
              resourcesUsed: job.returnvalue?.resourcesUsed || { cpu: 0, memory: 0 }
            }
          };

          return result;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting job result:', error);
      return null;
    }
  }

  /**
   * Get user's processing queue status
   */
  async getUserQueueStatus(userId: string): Promise<{
    pendingJobs: number;
    processingJobs: number;
    completedJobs: number;
    failedJobs: number;
    estimatedWaitTime: number;
    priority: ProcessingPriority;
  }> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const priority = this.determinePriority(userContext.tier, ProcessingJobType.PLANNING_SESSION);
      const queue = this.queues.get(priority);

      if (!queue) {
        throw new Error(`No queue found for priority ${priority}`);
      }

      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed()
      ]);

      // Filter for user's jobs
      const userWaiting = waiting.filter(job => job.data.userId === userId);
      const userActive = active.filter(job => job.data.userId === userId);
      const userCompleted = completed.filter(job => job.data.userId === userId);
      const userFailed = failed.filter(job => job.data.userId === userId);

      // Estimate wait time based on queue position and processing rate
      const queuePosition = waiting.findIndex(job => job.data.userId === userId);
      const avgProcessingTime = this.metrics.averageProcessingTime || 30000; // Default 30s
      const estimatedWaitTime = queuePosition >= 0 ? queuePosition * avgProcessingTime : 0;

      return {
        pendingJobs: userWaiting.length,
        processingJobs: userActive.length,
        completedJobs: userCompleted.length,
        failedJobs: userFailed.length,
        estimatedWaitTime,
        priority
      };

    } catch (error) {
      console.error('Error getting user queue status:', error);
      throw error;
    }
  }

  /**
   * Get processing metrics
   */
  getProcessingMetrics(): QueueMetrics & {
    slaCompliance: Record<UserTier, {
      processingTimeSLA: number;
      queueTimeSLA: number;
      overallCompliance: number;
    }>;
    activeQueues: Array<{
      priority: ProcessingPriority;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    }>;
  } {
    // Calculate SLA compliance (would be tracked in real implementation)
    const slaCompliance = Object.values(UserTier).reduce((acc, tier) => {
      acc[tier] = {
        processingTimeSLA: 95, // 95% compliance
        queueTimeSLA: 98, // 98% compliance
        overallCompliance: 96.5 // Average compliance
      };
      return acc;
    }, {} as any);

    return {
      ...this.metrics,
      slaCompliance,
      activeQueues: Array.from(this.queues.entries()).map(([priority, queue]) => ({
        priority,
        waiting: 0, // Would query actual queue stats
        active: 0,
        completed: 0,
        failed: 0
      }))
    };
  }

  // Private helper methods

  private initializeQueues(): void {
    // Create queues for each priority level
    Object.values(ProcessingPriority).forEach(priority => {
      if (typeof priority === 'number') {
        const queueName = `processing_${ProcessingPriority[priority].toLowerCase()}`;
        
        const queue = new Queue(queueName, {
          connection: this.redis,
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50
          }
        });

        const worker = new Worker(queueName, this.processJob.bind(this), {
          connection: this.redis,
          concurrency: this.getConcurrencyForPriority(priority)
        });

        // Set up event handlers
        worker.on('completed', (job) => {
          this.handleJobCompleted(job);
        });

        worker.on('failed', (job, err) => {
          this.handleJobFailed(job, err);
        });

        worker.on('error', (error) => {
          console.error(`Worker error for priority ${priority}:`, error);
        });

        this.queues.set(priority, queue);
        this.workers.set(priority, worker);
      }
    });

    console.log(`Initialized ${this.queues.size} processing queues`);
  }

  private async processJob(job: Job): Promise<any> {
    const startTime = Date.now();
    
    try {
      console.log(`Processing job ${job.id} of type ${job.data.type}`);

      const jobData = job.data as ProcessingJob;
      let result: any;

      switch (jobData.type) {
        case ProcessingJobType.PLANNING_SESSION:
          result = await this.processAdvancedPlanningSession(jobData);
          break;
        case ProcessingJobType.DOCUMENT_GENERATION:
          result = await this.processDocumentGeneration(jobData);
          break;
        case ProcessingJobType.TEMPLATE_PROCESSING:
          result = await this.processTemplateGeneration(jobData);
          break;
        case ProcessingJobType.SEARCH_QUERY:
          result = await this.processAdvancedSearch(jobData);
          break;
        case ProcessingJobType.EXPORT_GENERATION:
          result = await this.processExportGeneration(jobData);
          break;
        default:
          throw new Error(`Unknown job type: ${jobData.type}`);
      }

      // Add processing metadata
      result.processingTime = Date.now() - startTime;
      result.resourcesUsed = {
        cpu: Math.random() * 100, // Simulated CPU usage
        memory: Math.random() * 512, // Simulated memory usage
        llmTokens: result.llmTokens || 0
      };

      return result;

    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);
      throw error;
    }
  }

  private async processAdvancedPlanningSession(jobData: ProcessingJob): Promise<any> {
    const { projectData, planningConfig } = jobData.data;
    
    // Simulate advanced planning processing
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate processing time

    return {
      sessionId: `session_${Date.now()}`,
      analysisDepth: planningConfig.analysisDepth,
      questionsGenerated: Math.min(planningConfig.maxQuestions || 50, 50),
      agentsUsed: planningConfig.specializedAgents,
      riskAnalysis: planningConfig.includeRiskAnalysis ? {
        riskLevel: 'medium',
        identifiedRisks: ['technical', 'timeline', 'resource']
      } : null,
      competitiveAnalysis: planningConfig.includeCompetitiveAnalysis ? {
        competitors: ['competitor1', 'competitor2'],
        advantages: ['unique feature', 'better pricing']
      } : null,
      implementationRoadmap: planningConfig.includeImplementationRoadmap ? {
        phases: ['planning', 'development', 'testing', 'deployment'],
        estimatedTimeline: '12 weeks'
      } : null,
      llmTokens: Math.floor(Math.random() * 5000) + 1000
    };
  }

  private async processDocumentGeneration(jobData: ProcessingJob): Promise<any> {
    // Simulate document generation
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      documentId: `doc_${Date.now()}`,
      template: jobData.data.template || 'standard',
      sections: ['executive_summary', 'analysis', 'recommendations'],
      wordCount: Math.floor(Math.random() * 5000) + 1000,
      llmTokens: Math.floor(Math.random() * 3000) + 500
    };
  }

  private async processTemplateGeneration(jobData: ProcessingJob): Promise<any> {
    // Simulate template processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      templateId: `template_${Date.now()}`,
      type: jobData.data.templateType,
      customizations: jobData.data.customizations || [],
      llmTokens: Math.floor(Math.random() * 2000) + 300
    };
  }

  private async processAdvancedSearch(jobData: ProcessingJob): Promise<any> {
    // Simulate advanced search
    await new Promise(resolve => setTimeout(resolve, 800));
    
    return {
      searchId: `search_${Date.now()}`,
      query: jobData.data.query,
      results: Array.from({ length: 10 }, (_, i) => ({
        id: i,
        title: `Result ${i + 1}`,
        relevance: Math.random()
      }))
    };
  }

  private async processExportGeneration(jobData: ProcessingJob): Promise<any> {
    // Simulate export generation
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    return {
      exportId: `export_${Date.now()}`,
      format: jobData.data.format || 'pdf',
      fileSize: Math.floor(Math.random() * 1000000) + 100000, // Random file size
      customBranding: jobData.data.customBranding || false
    };
  }

  private determinePriority(userTier: UserTier, jobType: ProcessingJobType): ProcessingPriority {
    // Enterprise users get highest priority
    if (userTier === UserTier.ENTERPRISE) {
      return ProcessingPriority.ENTERPRISE;
    }
    
    // Premium users get premium priority
    if (userTier === UserTier.PREMIUM) {
      return ProcessingPriority.PREMIUM;
    }
    
    // Email captured users get slightly higher priority than free
    if (userTier === UserTier.EMAIL_CAPTURED) {
      return ProcessingPriority.HIGH;
    }
    
    // Free users get normal priority
    return ProcessingPriority.NORMAL;
  }

  private getPlanningConfig(userTier: UserTier, analysisDepth?: string): AdvancedPlanningConfig {
    const baseConfig = PLANNING_CONFIGS[userTier];
    
    if (analysisDepth && userTier === UserTier.PREMIUM || userTier === UserTier.ENTERPRISE) {
      return {
        ...baseConfig,
        analysisDepth: analysisDepth as any
      };
    }
    
    return baseConfig;
  }

  private getConcurrencyForPriority(priority: ProcessingPriority): number {
    const concurrencyMap = {
      [ProcessingPriority.LOW]: 1,
      [ProcessingPriority.NORMAL]: 2,
      [ProcessingPriority.HIGH]: 3,
      [ProcessingPriority.PREMIUM]: 5,
      [ProcessingPriority.ENTERPRISE]: 10
    };
    
    return concurrencyMap[priority] || 1;
  }

  private handleJobCompleted(job: Job): void {
    this.updateMetrics('job_completed', job.data);
    this.emit('job_completed', { jobId: job.id, result: job.returnvalue });
  }

  private handleJobFailed(job: Job, error: Error): void {
    this.updateMetrics('job_failed', job.data);
    this.emit('job_failed', { jobId: job.id, error: error.message });
  }

  private updateMetrics(eventType: 'job_submitted' | 'job_completed' | 'job_failed', jobData: ProcessingJob): void {
    switch (eventType) {
      case 'job_submitted':
        this.metrics.totalJobs++;
        this.metrics.jobsByPriority[jobData.priority] = (this.metrics.jobsByPriority[jobData.priority] || 0) + 1;
        this.metrics.jobsByType[jobData.type] = (this.metrics.jobsByType[jobData.type] || 0) + 1;
        break;
      case 'job_completed':
        this.metrics.completedJobs++;
        break;
      case 'job_failed':
        this.metrics.failedJobs++;
        break;
    }
  }

  private startMetricsCollection(): void {
    // Update metrics every minute
    setInterval(async () => {
      try {
        // Calculate average processing and queue times
        // This would query actual job data in a real implementation
        this.metrics.averageProcessingTime = 25000; // 25 seconds
        this.metrics.averageQueueTime = 8000; // 8 seconds
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }
    }, 60000);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      const redisInfo = await this.redis.ping();
      const metrics = this.getProcessingMetrics();
      
      // Check queue health
      const queueHealth = await Promise.all(
        Array.from(this.queues.entries()).map(async ([priority, queue]) => {
          try {
            await queue.getWaiting();
            return { priority, status: 'healthy' };
          } catch (error) {
            return { priority, status: 'unhealthy', error: error.message };
          }
        })
      );

      const unhealthyQueues = queueHealth.filter(q => q.status === 'unhealthy');
      
      const status = redisInfo === 'PONG' && unhealthyQueues.length === 0 ? 'healthy' : 
                   unhealthyQueues.length > 0 ? 'degraded' : 'unhealthy';

      const details = {
        redis: redisInfo === 'PONG' ? 'healthy' : 'unhealthy',
        queues: queueHealth,
        metrics,
        timestamp: new Date()
      };

      return { status, details };

    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date()
        }
      };
    }
  }

  /**
   * Shutdown cleanup
   */
  async shutdown(): Promise<void> {
    // Close all workers
    for (const worker of this.workers.values()) {
      await worker.close();
    }

    // Close all queues
    for (const queue of this.queues.values()) {
      await queue.close();
    }

    await this.redis.disconnect();
    console.log('Premium processor shut down');
  }
}

// Export singleton instance
export const premiumProcessor = PremiumProcessor.getInstance();
export default premiumProcessor;