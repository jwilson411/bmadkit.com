import type { AgentPhase, ProjectType } from './status-message-library';

// Session metrics for time estimation
export interface SessionMetrics {
  startTime: Date;
  currentTime: Date;
  currentPhase: AgentPhase;
  completedPhases: AgentPhase[];
  phaseStartTimes: Map<AgentPhase, Date>;
  phaseCompletionTimes: Map<AgentPhase, Date>;
  userResponseTimes: number[]; // milliseconds
  totalInteractions: number;
  projectComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  projectType?: ProjectType;
}

// Time estimation configuration
export interface TimeEstimationConfig {
  baseSessionDuration: number; // minutes
  phaseWeights: Record<AgentPhase, number>;
  complexityMultipliers: Record<string, number>;
  projectTypeAdjustments: Partial<Record<ProjectType, number>>;
  confidenceThreshold: number;
  adaptationRate: number;
}

// Estimation result
export interface TimeEstimationResult {
  estimatedCompletionTime: Date;
  timeRemaining: number; // minutes
  sessionProgress: number; // 0-1
  phaseProgress: number; // 0-1 for current phase
  confidenceLevel: number; // 0-1
  estimatedTotalDuration: number; // minutes
  breakdown: {
    phase: AgentPhase;
    estimatedDuration: number;
    actualDuration?: number;
    status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';
  }[];
}

// Historical data for baseline modeling
const BASELINE_TIMING_DATA = {
  // Average phase durations in minutes for different project complexities
  PHASE_DURATIONS: {
    LOW: {
      ANALYST: 8,
      PM: 7,
      UX_EXPERT: 6,
      ARCHITECT: 9
    },
    MEDIUM: {
      ANALYST: 12,
      PM: 10,
      UX_EXPERT: 9,
      ARCHITECT: 14
    },
    HIGH: {
      ANALYST: 18,
      PM: 15,
      UX_EXPERT: 13,
      ARCHITECT: 20
    }
  },

  // Project type adjustments (multipliers)
  PROJECT_TYPE_ADJUSTMENTS: {
    WEB_APPLICATION: 1.0,
    MOBILE_APP: 1.1,
    API_SERVICE: 0.9,
    DESKTOP_APPLICATION: 1.2,
    ECOMMERCE: 1.3,
    SAAS_PLATFORM: 1.4,
    DATA_PLATFORM: 1.5,
    IOT_SYSTEM: 1.6
  },

  // User response pattern impact on session duration
  USER_RESPONSE_PATTERNS: {
    QUICK: 0.85,      // Users who respond quickly tend to have shorter sessions
    DETAILED: 1.15,   // Users who give detailed responses tend to have longer sessions
    HESITANT: 1.25    // Users who hesitate tend to have longer sessions
  }
};

export class TimeEstimationEngine {
  private static instance: TimeEstimationEngine;
  private config: TimeEstimationConfig;

  constructor(config?: Partial<TimeEstimationConfig>) {
    this.config = {
      baseSessionDuration: 30, // 30 minutes baseline
      phaseWeights: {
        ANALYST: 0.25,
        PM: 0.23,
        UX_EXPERT: 0.20,
        ARCHITECT: 0.32
      },
      complexityMultipliers: {
        LOW: 0.75,
        MEDIUM: 1.0,
        HIGH: 1.4
      },
      projectTypeAdjustments: BASELINE_TIMING_DATA.PROJECT_TYPE_ADJUSTMENTS,
      confidenceThreshold: 0.7,
      adaptationRate: 0.1,
      ...config
    };
  }

  static getInstance(config?: Partial<TimeEstimationConfig>): TimeEstimationEngine {
    if (!TimeEstimationEngine.instance) {
      TimeEstimationEngine.instance = new TimeEstimationEngine(config);
    }
    return TimeEstimationEngine.instance;
  }

  /**
   * Generate time estimation based on current session metrics
   */
  estimateCompletion(metrics: SessionMetrics): TimeEstimationResult {
    const now = metrics.currentTime;
    const elapsed = this.getElapsedMinutes(metrics.startTime, now);

    // Calculate base estimates
    const baseEstimate = this.calculateBaseEstimate(metrics);
    
    // Apply adaptive adjustments based on actual progress
    const adaptedEstimate = this.applyAdaptiveAdjustments(baseEstimate, metrics);
    
    // Calculate confidence level
    const confidence = this.calculateConfidence(metrics, elapsed);
    
    // Generate phase breakdown
    const breakdown = this.generatePhaseBreakdown(metrics, adaptedEstimate);
    
    // Calculate remaining time
    const completedDuration = this.getCompletedPhasesTotalDuration(metrics);
    const currentPhaseProgress = this.getCurrentPhaseProgress(metrics);
    const currentPhaseEstimated = breakdown.find(b => b.phase === metrics.currentPhase)?.estimatedDuration || 0;
    const currentPhaseRemaining = currentPhaseEstimated * (1 - currentPhaseProgress);
    
    const pendingPhasesDuration = breakdown
      .filter(b => b.status === 'PENDING')
      .reduce((sum, b) => sum + b.estimatedDuration, 0);
    
    const timeRemaining = currentPhaseRemaining + pendingPhasesDuration;
    const estimatedCompletionTime = new Date(now.getTime() + timeRemaining * 60000);
    
    // Calculate overall progress
    const sessionProgress = Math.min(0.99, completedDuration / adaptedEstimate.totalDuration);
    
    return {
      estimatedCompletionTime,
      timeRemaining: Math.ceil(timeRemaining),
      sessionProgress,
      phaseProgress: currentPhaseProgress,
      confidenceLevel: confidence,
      estimatedTotalDuration: adaptedEstimate.totalDuration,
      breakdown
    };
  }

  /**
   * Update estimation based on phase completion
   */
  updateOnPhaseCompletion(
    metrics: SessionMetrics,
    completedPhase: AgentPhase,
    actualDuration: number
  ): void {
    // Store historical data for future improvements
    this.storePhaseCompletion(completedPhase, actualDuration, metrics.projectComplexity);
    
    // Adapt future estimates based on actual vs estimated performance
    this.adaptEstimationModel(completedPhase, actualDuration, metrics);
  }

  /**
   * Get time remaining in current phase
   */
  getCurrentPhaseTimeRemaining(metrics: SessionMetrics): number {
    const phaseStartTime = metrics.phaseStartTimes.get(metrics.currentPhase);
    if (!phaseStartTime) return 0;

    const elapsed = this.getElapsedMinutes(phaseStartTime, metrics.currentTime);
    const estimated = this.getPhaseEstimatedDuration(metrics.currentPhase, metrics.projectComplexity, metrics.projectType);
    
    return Math.max(0, estimated - elapsed);
  }

  /**
   * Calculate session progress percentage
   */
  calculateSessionProgress(metrics: SessionMetrics): number {
    const totalPhases = 4; // ANALYST, PM, UX_EXPERT, ARCHITECT
    const completedPhases = metrics.completedPhases.length;
    const currentPhaseProgress = this.getCurrentPhaseProgress(metrics);
    
    return Math.min(0.99, (completedPhases + currentPhaseProgress) / totalPhases);
  }

  /**
   * Get user response pattern based on interaction history
   */
  analyzeUserResponsePattern(responseTimesMs: number[]): 'QUICK' | 'DETAILED' | 'HESITANT' {
    if (responseTimesMs.length === 0) return 'DETAILED';

    const avgResponseTime = responseTimesMs.reduce((sum, time) => sum + time, 0) / responseTimesMs.length;
    const avgResponseSeconds = avgResponseTime / 1000;

    if (avgResponseSeconds < 30) return 'QUICK';
    if (avgResponseSeconds > 120) return 'HESITANT';
    return 'DETAILED';
  }

  /**
   * Calculate base time estimate using historical data
   */
  private calculateBaseEstimate(metrics: SessionMetrics): {
    totalDuration: number;
    phaseDurations: Record<AgentPhase, number>;
  } {
    const complexity = metrics.projectComplexity;
    const projectType = metrics.projectType;
    
    // Get base phase durations
    const baseDurations = BASELINE_TIMING_DATA.PHASE_DURATIONS[complexity];
    
    // Apply project type adjustments
    const projectMultiplier = projectType 
      ? (this.config.projectTypeAdjustments[projectType] || 1.0)
      : 1.0;
    
    // Apply user response pattern adjustments
    const userPattern = this.analyzeUserResponsePattern(metrics.userResponseTimes);
    const userMultiplier = BASELINE_TIMING_DATA.USER_RESPONSE_PATTERNS[userPattern];
    
    const phaseDurations = Object.entries(baseDurations).reduce((acc, [phase, duration]) => {
      acc[phase as AgentPhase] = duration * projectMultiplier * userMultiplier;
      return acc;
    }, {} as Record<AgentPhase, number>);

    const totalDuration = Object.values(phaseDurations).reduce((sum, duration) => sum + duration, 0);

    return { totalDuration, phaseDurations };
  }

  /**
   * Apply adaptive adjustments based on actual performance
   */
  private applyAdaptiveAdjustments(
    baseEstimate: { totalDuration: number; phaseDurations: Record<AgentPhase, number> },
    metrics: SessionMetrics
  ): { totalDuration: number; phaseDurations: Record<AgentPhase, number> } {
    const adaptedDurations = { ...baseEstimate.phaseDurations };
    
    // Adjust based on completed phases
    for (const completedPhase of metrics.completedPhases) {
      const actualDuration = this.getActualPhaseDuration(completedPhase, metrics);
      const estimatedDuration = baseEstimate.phaseDurations[completedPhase];
      
      if (actualDuration && estimatedDuration) {
        const performanceRatio = actualDuration / estimatedDuration;
        
        // Adapt remaining phases based on performance pattern
        const remainingPhases = this.getRemainingPhases(metrics.currentPhase, metrics.completedPhases);
        for (const phase of remainingPhases) {
          adaptedDurations[phase] *= (1 + (performanceRatio - 1) * this.config.adaptationRate);
        }
      }
    }

    const totalDuration = Object.values(adaptedDurations).reduce((sum, duration) => sum + duration, 0);
    return { totalDuration, phaseDurations: adaptedDurations };
  }

  /**
   * Calculate confidence level for the estimation
   */
  private calculateConfidence(metrics: SessionMetrics, elapsedMinutes: number): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence with more completed phases
    confidence += metrics.completedPhases.length * 0.15;

    // Increase confidence with session progress
    const sessionProgress = this.calculateSessionProgress(metrics);
    confidence += sessionProgress * 0.3;

    // Adjust based on user response consistency
    if (metrics.userResponseTimes.length > 3) {
      const responseConsistency = this.calculateResponseConsistency(metrics.userResponseTimes);
      confidence += responseConsistency * 0.15;
    }

    // Adjust based on time elapsed (more data = higher confidence up to a point)
    if (elapsedMinutes > 5) {
      confidence += Math.min(0.2, elapsedMinutes / 50);
    }

    return Math.min(0.95, Math.max(0.3, confidence));
  }

  /**
   * Generate detailed phase breakdown
   */
  private generatePhaseBreakdown(
    metrics: SessionMetrics,
    estimate: { totalDuration: number; phaseDurations: Record<AgentPhase, number> }
  ): TimeEstimationResult['breakdown'] {
    const phases: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    
    return phases.map(phase => {
      let status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';
      let actualDuration: number | undefined;

      if (metrics.completedPhases.includes(phase)) {
        status = 'COMPLETED';
        actualDuration = this.getActualPhaseDuration(phase, metrics);
      } else if (phase === metrics.currentPhase) {
        status = 'IN_PROGRESS';
      } else {
        status = 'PENDING';
      }

      return {
        phase,
        estimatedDuration: estimate.phaseDurations[phase],
        actualDuration,
        status
      };
    });
  }

  /**
   * Helper methods
   */
  private getElapsedMinutes(startTime: Date, endTime: Date): number {
    return (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  }

  private getActualPhaseDuration(phase: AgentPhase, metrics: SessionMetrics): number | undefined {
    const startTime = metrics.phaseStartTimes.get(phase);
    const endTime = metrics.phaseCompletionTimes.get(phase);
    
    if (startTime && endTime) {
      return this.getElapsedMinutes(startTime, endTime);
    }
    
    return undefined;
  }

  private getCurrentPhaseProgress(metrics: SessionMetrics): number {
    const phaseStartTime = metrics.phaseStartTimes.get(metrics.currentPhase);
    if (!phaseStartTime) return 0;

    const elapsed = this.getElapsedMinutes(phaseStartTime, metrics.currentTime);
    const estimated = this.getPhaseEstimatedDuration(
      metrics.currentPhase, 
      metrics.projectComplexity, 
      metrics.projectType
    );

    return Math.min(0.95, elapsed / estimated);
  }

  private getPhaseEstimatedDuration(
    phase: AgentPhase, 
    complexity: 'LOW' | 'MEDIUM' | 'HIGH',
    projectType?: ProjectType
  ): number {
    const baseDuration = BASELINE_TIMING_DATA.PHASE_DURATIONS[complexity][phase];
    const projectMultiplier = projectType 
      ? (this.config.projectTypeAdjustments[projectType] || 1.0)
      : 1.0;
    
    return baseDuration * projectMultiplier;
  }

  private getCompletedPhasesTotalDuration(metrics: SessionMetrics): number {
    return metrics.completedPhases.reduce((total, phase) => {
      const duration = this.getActualPhaseDuration(phase, metrics);
      return total + (duration || 0);
    }, 0);
  }

  private getRemainingPhases(currentPhase: AgentPhase, completedPhases: AgentPhase[]): AgentPhase[] {
    const allPhases: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
    const currentIndex = allPhases.indexOf(currentPhase);
    
    return allPhases.slice(currentIndex + 1).filter(phase => !completedPhases.includes(phase));
  }

  private calculateResponseConsistency(responseTimes: number[]): number {
    if (responseTimes.length < 2) return 0;

    const mean = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const variance = responseTimes.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / responseTimes.length;
    const stdDev = Math.sqrt(variance);
    
    // Normalize consistency score (lower std dev = higher consistency)
    const coefficientOfVariation = stdDev / mean;
    return Math.max(0, 1 - Math.min(1, coefficientOfVariation));
  }

  private storePhaseCompletion(phase: AgentPhase, duration: number, complexity: string): void {
    // In a real implementation, this would store data in a database or analytics system
    console.log(`Phase ${phase} completed in ${duration} minutes (complexity: ${complexity})`);
  }

  private adaptEstimationModel(phase: AgentPhase, actualDuration: number, metrics: SessionMetrics): void {
    // In a real implementation, this would use machine learning to improve the model
    console.log(`Adapting estimation model based on ${phase} performance`);
  }
}

// Export singleton instance and utility functions
export const timeEstimationEngine = TimeEstimationEngine.getInstance();

export const estimateSessionCompletion = (metrics: SessionMetrics) => {
  return timeEstimationEngine.estimateCompletion(metrics);
};

export const getCurrentPhaseTimeRemaining = (metrics: SessionMetrics) => {
  return timeEstimationEngine.getCurrentPhaseTimeRemaining(metrics);
};

export const calculateSessionProgress = (metrics: SessionMetrics) => {
  return timeEstimationEngine.calculateSessionProgress(metrics);
};