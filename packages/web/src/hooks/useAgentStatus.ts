import { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { z } from 'zod';
import type { AgentPhase, ProjectType, StatusMessageTemplate } from '../utils/status-message-library';
import { 
  statusMessageLibrary, 
  getStatusMessage, 
  getTransitionMessage,
  getPersonalizedMessage 
} from '../utils/status-message-library';
import type { SessionMetrics, TimeEstimationResult } from '../utils/time-estimation';
import { timeEstimationEngine } from '../utils/time-estimation';

// Agent status schema
const AgentStatusSchema = z.object({
  currentPhase: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  status: z.enum(['IDLE', 'WORKING', 'TRANSITIONING', 'COMPLETED', 'ERROR']),
  progress: z.number().min(0).max(1),
  currentActivity: z.string().optional(),
  lastUpdate: z.date().or(z.string().transform(str => new Date(str))),
  estimatedCompletion: z.date().or(z.string().transform(str => new Date(str))).optional(),
  metadata: z.record(z.any()).optional()
});

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export interface UseAgentStatusOptions {
  workflowExecutionId: string;
  projectType?: ProjectType;
  autoRotateMessages?: boolean;
  messageRotationInterval?: number; // milliseconds
  enableTimeEstimation?: boolean;
  enablePersistence?: boolean;
  onStatusChange?: (status: AgentStatus) => void;
  onPhaseTransition?: (fromPhase: AgentPhase, toPhase: AgentPhase) => void;
  onError?: (error: Error) => void;
}

export interface StatusDisplayState {
  currentMessage: StatusMessageTemplate | null;
  messageHistory: StatusMessageTemplate[];
  isTransitioning: boolean;
  showTimeEstimate: boolean;
  animationState: 'idle' | 'working' | 'transitioning' | 'celebrating';
}

export interface UseAgentStatusReturn {
  // Current status
  agentStatus: AgentStatus | null;
  displayState: StatusDisplayState;
  timeEstimate: TimeEstimationResult | null;
  
  // Status information
  getCurrentMessage: () => string;
  getAgentProfile: () => any;
  getPhaseProgress: () => number;
  getSessionProgress: () => number;
  
  // Actions
  updateStatus: (status: Partial<AgentStatus>) => void;
  triggerTransition: (toPhase: AgentPhase) => void;
  markPhaseComplete: (phase: AgentPhase) => void;
  refreshStatus: () => Promise<void>;
  
  // Message control
  rotateMessage: () => void;
  setCustomMessage: (message: string, duration?: number) => void;
  clearCustomMessage: () => void;
  
  // Animation control
  triggerWorkingAnimation: () => void;
  triggerTransitionAnimation: () => void;
  triggerCelebrationAnimation: () => void;
}

export const useAgentStatus = (options: UseAgentStatusOptions): UseAgentStatusReturn => {
  const {
    workflowExecutionId,
    projectType,
    autoRotateMessages = true,
    messageRotationInterval = 15000,
    enableTimeEstimation = true,
    enablePersistence = true,
    onStatusChange,
    onPhaseTransition,
    onError
  } = options;

  const dispatch = useDispatch();
  
  // State management
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [displayState, setDisplayState] = useState<StatusDisplayState>({
    currentMessage: null,
    messageHistory: [],
    isTransitioning: false,
    showTimeEstimate: true,
    animationState: 'idle'
  });
  const [timeEstimate, setTimeEstimate] = useState<TimeEstimationResult | null>(null);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics | null>(null);

  // Refs for cleanup and timing
  const messageRotationTimer = useRef<NodeJS.Timeout | null>(null);
  const customMessageTimer = useRef<NodeJS.Timeout | null>(null);
  const animationTimer = useRef<NodeJS.Timeout | null>(null);
  const lastStatusUpdate = useRef<Date>(new Date());

  // Initialize session metrics
  useEffect(() => {
    if (workflowExecutionId && !sessionMetrics) {
      const metrics: SessionMetrics = {
        startTime: new Date(),
        currentTime: new Date(),
        currentPhase: 'ANALYST',
        completedPhases: [],
        phaseStartTimes: new Map([['ANALYST', new Date()]]),
        phaseCompletionTimes: new Map(),
        userResponseTimes: [],
        totalInteractions: 0,
        projectComplexity: 'MEDIUM',
        projectType
      };
      setSessionMetrics(metrics);
    }
  }, [workflowExecutionId, sessionMetrics, projectType]);

  // Message rotation effect
  useEffect(() => {
    if (!autoRotateMessages || !agentStatus) return;

    const startRotation = () => {
      if (messageRotationTimer.current) {
        clearInterval(messageRotationTimer.current);
      }

      messageRotationTimer.current = setInterval(() => {
        if (agentStatus.status === 'WORKING' && !displayState.isTransitioning) {
          rotateMessage();
        }
      }, messageRotationInterval);
    };

    startRotation();

    return () => {
      if (messageRotationTimer.current) {
        clearInterval(messageRotationTimer.current);
      }
    };
  }, [autoRotateMessages, messageRotationInterval, agentStatus, displayState.isTransitioning]);

  // Time estimation updates
  useEffect(() => {
    if (!enableTimeEstimation || !sessionMetrics) return;

    const updateTimeEstimate = () => {
      try {
        const updatedMetrics = {
          ...sessionMetrics,
          currentTime: new Date()
        };
        
        const estimate = timeEstimationEngine.estimateCompletion(updatedMetrics);
        setTimeEstimate(estimate);
        setSessionMetrics(updatedMetrics);
      } catch (error) {
        onError?.(error as Error);
      }
    };

    // Update immediately and then every 30 seconds
    updateTimeEstimate();
    const interval = setInterval(updateTimeEstimate, 30000);

    return () => clearInterval(interval);
  }, [enableTimeEstimation, sessionMetrics, onError]);

  // Status persistence
  useEffect(() => {
    if (enablePersistence && agentStatus) {
      try {
        localStorage.setItem(
          `agent_status_${workflowExecutionId}`,
          JSON.stringify({
            ...agentStatus,
            lastUpdate: agentStatus.lastUpdate.toISOString()
          })
        );
      } catch (error) {
        console.warn('Failed to persist agent status:', error);
      }
    }
  }, [enablePersistence, workflowExecutionId, agentStatus]);

  // Load persisted status on mount
  useEffect(() => {
    if (enablePersistence && workflowExecutionId) {
      try {
        const persistedStatus = localStorage.getItem(`agent_status_${workflowExecutionId}`);
        if (persistedStatus) {
          const parsed = JSON.parse(persistedStatus);
          const validatedStatus = AgentStatusSchema.parse({
            ...parsed,
            lastUpdate: new Date(parsed.lastUpdate)
          });
          setAgentStatus(validatedStatus);
        }
      } catch (error) {
        console.warn('Failed to load persisted agent status:', error);
      }
    }
  }, [enablePersistence, workflowExecutionId]);

  // Update current message based on status
  useEffect(() => {
    if (!agentStatus || !sessionMetrics) return;

    const getContextualMessage = () => {
      const context = {
        agentPhase: agentStatus.currentPhase,
        projectType,
        sessionProgress: agentStatus.progress,
        currentActivity: agentStatus.currentActivity,
        userResponsePattern: 'DETAILED' as const, // This would come from actual user interaction analysis
        complexity: sessionMetrics.projectComplexity,
        timeInPhase: sessionMetrics.phaseStartTimes.get(agentStatus.currentPhase) 
          ? (Date.now() - sessionMetrics.phaseStartTimes.get(agentStatus.currentPhase)!.getTime()) / (1000 * 60)
          : 0
      };

      return getStatusMessage(context);
    };

    const newMessage = getContextualMessage();
    if (newMessage && newMessage.id !== displayState.currentMessage?.id) {
      setDisplayState(prev => ({
        ...prev,
        currentMessage: newMessage,
        messageHistory: [newMessage, ...prev.messageHistory.slice(0, 9)] // Keep last 10 messages
      }));
    }
  }, [agentStatus, sessionMetrics, projectType, displayState.currentMessage?.id]);

  // Status update function
  const updateStatus = useCallback((statusUpdate: Partial<AgentStatus>) => {
    setAgentStatus(prev => {
      if (!prev) {
        // Initialize with defaults if no previous status
        const newStatus = {
          currentPhase: 'ANALYST' as AgentPhase,
          status: 'WORKING' as const,
          progress: 0,
          lastUpdate: new Date(),
          ...statusUpdate
        };
        
        onStatusChange?.(newStatus);
        return newStatus;
      }

      const updated = {
        ...prev,
        ...statusUpdate,
        lastUpdate: new Date()
      };

      onStatusChange?.(updated);
      return updated;
    });
    
    lastStatusUpdate.current = new Date();
  }, [onStatusChange]);

  // Phase transition function
  const triggerTransition = useCallback((toPhase: AgentPhase) => {
    if (!agentStatus || !sessionMetrics) return;

    const fromPhase = agentStatus.currentPhase;
    
    setDisplayState(prev => ({ ...prev, isTransitioning: true, animationState: 'transitioning' }));
    
    // Get transition message
    const transitionMessage = getTransitionMessage(fromPhase, toPhase);
    if (transitionMessage) {
      setDisplayState(prev => ({
        ...prev,
        currentMessage: transitionMessage
      }));
    }

    // Update session metrics
    const now = new Date();
    const updatedMetrics = {
      ...sessionMetrics,
      currentPhase: toPhase,
      completedPhases: [...sessionMetrics.completedPhases, fromPhase],
      phaseStartTimes: new Map([...sessionMetrics.phaseStartTimes, [toPhase, now]]),
      phaseCompletionTimes: new Map([...sessionMetrics.phaseCompletionTimes, [fromPhase, now]])
    };

    setSessionMetrics(updatedMetrics);

    // Update agent status
    updateStatus({
      currentPhase: toPhase,
      status: 'WORKING',
      progress: 0
    });

    // Trigger callbacks
    onPhaseTransition?.(fromPhase, toPhase);

    // End transition after animation
    setTimeout(() => {
      setDisplayState(prev => ({ 
        ...prev, 
        isTransitioning: false, 
        animationState: 'working' 
      }));
    }, 2500);

  }, [agentStatus, sessionMetrics, updateStatus, onPhaseTransition]);

  // Mark phase complete
  const markPhaseComplete = useCallback((phase: AgentPhase) => {
    if (!sessionMetrics) return;

    const now = new Date();
    const phaseStartTime = sessionMetrics.phaseStartTimes.get(phase);
    
    if (phaseStartTime) {
      const duration = (now.getTime() - phaseStartTime.getTime()) / (1000 * 60);
      timeEstimationEngine.updateOnPhaseCompletion(sessionMetrics, phase, duration);
    }

    updateStatus({
      status: 'COMPLETED',
      progress: 1.0
    });

    // Trigger celebration animation
    triggerCelebrationAnimation();

  }, [sessionMetrics, updateStatus]);

  // Message rotation
  const rotateMessage = useCallback(() => {
    if (!agentStatus || !sessionMetrics) return;

    const context = {
      agentPhase: agentStatus.currentPhase,
      projectType,
      sessionProgress: agentStatus.progress,
      currentActivity: agentStatus.currentActivity,
      userResponsePattern: 'DETAILED' as const,
      complexity: sessionMetrics.projectComplexity
    };

    const newMessage = getStatusMessage(context);
    if (newMessage && newMessage.id !== displayState.currentMessage?.id) {
      setDisplayState(prev => ({
        ...prev,
        currentMessage: newMessage,
        messageHistory: [newMessage, ...prev.messageHistory.slice(0, 9)]
      }));
    }
  }, [agentStatus, sessionMetrics, projectType, displayState.currentMessage?.id]);

  // Custom message handling
  const setCustomMessage = useCallback((message: string, duration = 5000) => {
    const customMessage: StatusMessageTemplate = {
      id: `custom_${Date.now()}`,
      agentPhase: agentStatus?.currentPhase || 'ANALYST',
      category: 'WORKING',
      message,
      duration,
      weight: 1.0
    };

    setDisplayState(prev => ({
      ...prev,
      currentMessage: customMessage
    }));

    // Clear custom message after duration
    if (customMessageTimer.current) {
      clearTimeout(customMessageTimer.current);
    }
    
    customMessageTimer.current = setTimeout(() => {
      rotateMessage();
    }, duration);
  }, [agentStatus?.currentPhase, rotateMessage]);

  const clearCustomMessage = useCallback(() => {
    if (customMessageTimer.current) {
      clearTimeout(customMessageTimer.current);
    }
    rotateMessage();
  }, [rotateMessage]);

  // Animation triggers
  const triggerWorkingAnimation = useCallback(() => {
    setDisplayState(prev => ({ ...prev, animationState: 'working' }));
  }, []);

  const triggerTransitionAnimation = useCallback(() => {
    setDisplayState(prev => ({ ...prev, animationState: 'transitioning' }));
    
    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }
    
    animationTimer.current = setTimeout(() => {
      setDisplayState(prev => ({ ...prev, animationState: 'working' }));
    }, 3000);
  }, []);

  const triggerCelebrationAnimation = useCallback(() => {
    setDisplayState(prev => ({ ...prev, animationState: 'celebrating' }));
    
    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }
    
    animationTimer.current = setTimeout(() => {
      setDisplayState(prev => ({ ...prev, animationState: 'idle' }));
    }, 2000);
  }, []);

  // Refresh status from server
  const refreshStatus = useCallback(async () => {
    try {
      // In a real implementation, this would fetch from the API
      // For now, we'll simulate an update
      updateStatus({
        lastUpdate: new Date()
      });
    } catch (error) {
      onError?.(error as Error);
    }
  }, [updateStatus, onError]);

  // Utility functions
  const getCurrentMessage = useCallback(() => {
    if (!displayState.currentMessage || !sessionMetrics || !agentStatus) return '';
    
    const context = {
      agentPhase: agentStatus.currentPhase,
      projectType,
      sessionProgress: agentStatus.progress,
      complexity: sessionMetrics.projectComplexity
    };
    
    return getPersonalizedMessage(context);
  }, [displayState.currentMessage, sessionMetrics, agentStatus, projectType]);

  const getAgentProfile = useCallback(() => {
    if (!agentStatus) return null;
    return statusMessageLibrary.getAgentActivitySummary(agentStatus.currentPhase);
  }, [agentStatus]);

  const getPhaseProgress = useCallback(() => {
    return agentStatus?.progress || 0;
  }, [agentStatus]);

  const getSessionProgress = useCallback(() => {
    if (!sessionMetrics) return 0;
    return timeEstimationEngine.calculateSessionProgress(sessionMetrics);
  }, [sessionMetrics]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (messageRotationTimer.current) clearInterval(messageRotationTimer.current);
      if (customMessageTimer.current) clearTimeout(customMessageTimer.current);
      if (animationTimer.current) clearTimeout(animationTimer.current);
    };
  }, []);

  return {
    agentStatus,
    displayState,
    timeEstimate,
    getCurrentMessage,
    getAgentProfile,
    getPhaseProgress,
    getSessionProgress,
    updateStatus,
    triggerTransition,
    markPhaseComplete,
    refreshStatus,
    rotateMessage,
    setCustomMessage,
    clearCustomMessage,
    triggerWorkingAnimation,
    triggerTransitionAnimation,
    triggerCelebrationAnimation
  };
};

export default useAgentStatus;