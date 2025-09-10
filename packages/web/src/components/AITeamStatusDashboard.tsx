import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import type { AgentPhase, ProjectType } from '../utils/status-message-library';
import { useAgentStatus } from '../hooks/useAgentStatus';
import AgentStatusIndicator from './AgentStatusIndicator';
import ProgressVisualization from './ProgressVisualization';
import TeamWorkingAnimations from './TeamWorkingAnimations';
import { statusPersistenceEngine, startSessionAutoSave, stopSessionAutoSave } from '../utils/status-persistence';
import type { ProgressPhase } from './ProgressVisualization';

export interface AITeamStatusDashboardProps {
  workflowExecutionId: string;
  projectType?: ProjectType;
  initialPhase?: AgentPhase;
  showTeamAnimation?: boolean;
  showProgressVisualization?: boolean;
  progressVariant?: 'minimal' | 'detailed' | 'timeline';
  enablePersistence?: boolean;
  enableAutoSave?: boolean;
  className?: string;
  onPhaseChange?: (phase: AgentPhase) => void;
  onStatusUpdate?: (status: any) => void;
  onError?: (error: Error) => void;
}

export interface TeamStatusState {
  isLoading: boolean;
  isRecovering: boolean;
  hasRecovered: boolean;
  error: string | null;
  recoveryScore?: number;
}

const PHASE_SEQUENCE: AgentPhase[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];

export const AITeamStatusDashboard: React.FC<AITeamStatusDashboardProps> = ({
  workflowExecutionId,
  projectType = 'WEB_APPLICATION',
  initialPhase = 'ANALYST',
  showTeamAnimation = true,
  showProgressVisualization = true,
  progressVariant = 'detailed',
  enablePersistence = true,
  enableAutoSave = true,
  className,
  onPhaseChange,
  onStatusUpdate,
  onError
}) => {
  const [teamState, setTeamState] = useState<TeamStatusState>({
    isLoading: true,
    isRecovering: false,
    hasRecovered: false,
    error: null
  });
  const [recoveryBanner, setRecoveryBanner] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'warning' | 'error';
  }>({ show: false, message: '', type: 'success' });

  // Initialize agent status hook
  const {
    agentStatus,
    displayState,
    timeEstimate,
    updateStatus,
    triggerTransition,
    markPhaseComplete,
    refreshStatus,
    getCurrentMessage,
    getSessionProgress
  } = useAgentStatus({
    workflowExecutionId,
    projectType,
    enableTimeEstimation: true,
    enablePersistence,
    onStatusChange: onStatusUpdate,
    onPhaseTransition: onPhaseChange,
    onError
  });

  // Session recovery on mount
  useEffect(() => {
    const recoverSession = async () => {
      if (!enablePersistence) {
        setTeamState(prev => ({ ...prev, isLoading: false }));
        updateStatus({
          currentPhase: initialPhase,
          status: 'WORKING',
          progress: 0
        });
        return;
      }

      setTeamState(prev => ({ ...prev, isRecovering: true }));

      try {
        const canRecover = await statusPersistenceEngine.canRecoverSession(workflowExecutionId);
        
        if (canRecover) {
          const recovery = await statusPersistenceEngine.recoverSessionState(workflowExecutionId);
          
          if (recovery.isValid && recovery.recoveryScore > 0.5) {
            // Successful recovery
            if (recovery.agentStatus) {
              updateStatus({
                currentPhase: recovery.agentStatus.currentPhase,
                status: recovery.agentStatus.status,
                progress: recovery.agentStatus.progress,
                currentActivity: recovery.agentStatus.currentActivity
              });
            }

            setTeamState(prev => ({
              ...prev,
              hasRecovered: true,
              recoveryScore: recovery.recoveryScore,
              isLoading: false,
              isRecovering: false
            }));

            setRecoveryBanner({
              show: true,
              message: `Session recovered successfully (${Math.round(recovery.recoveryScore * 100)}% complete)`,
              type: 'success'
            });

            // Auto-hide banner after 5 seconds
            setTimeout(() => {
              setRecoveryBanner(prev => ({ ...prev, show: false }));
            }, 5000);

          } else {
            // Partial recovery or low confidence
            throw new Error('Recovery confidence too low');
          }
        } else {
          throw new Error('Session cannot be recovered');
        }
      } catch (error) {
        // Start fresh session
        updateStatus({
          currentPhase: initialPhase,
          status: 'WORKING',
          progress: 0
        });

        setTeamState(prev => ({
          ...prev,
          isLoading: false,
          isRecovering: false,
          hasRecovered: false
        }));

        if (enablePersistence) {
          setRecoveryBanner({
            show: true,
            message: 'Starting fresh session',
            type: 'warning'
          });

          setTimeout(() => {
            setRecoveryBanner(prev => ({ ...prev, show: false }));
          }, 3000);
        }
      }
    };

    recoverSession();
  }, [workflowExecutionId, enablePersistence, initialPhase, updateStatus]);

  // Auto-save setup
  useEffect(() => {
    if (enableAutoSave && enablePersistence && agentStatus) {
      const getCurrentState = () => ({
        agentStatus,
        sessionMetrics: null, // Would be provided by actual session tracking
        displayState
      });

      startSessionAutoSave(workflowExecutionId, getCurrentState);

      return () => {
        stopSessionAutoSave();
      };
    }
  }, [enableAutoSave, enablePersistence, agentStatus, displayState, workflowExecutionId]);

  // Generate progress phases
  const generateProgressPhases = (): ProgressPhase[] => {
    if (!agentStatus) return [];

    return PHASE_SEQUENCE.map(phase => ({
      phase,
      title: phase.replace('_', ' '),
      status: phase === agentStatus.currentPhase ? 'IN_PROGRESS' :
              PHASE_SEQUENCE.indexOf(phase) < PHASE_SEQUENCE.indexOf(agentStatus.currentPhase) ? 'COMPLETED' : 'PENDING',
      progress: phase === agentStatus.currentPhase ? agentStatus.progress : 
               PHASE_SEQUENCE.indexOf(phase) < PHASE_SEQUENCE.indexOf(agentStatus.currentPhase) ? 1 : 0
    }));
  };

  // Generate team members for animation
  const generateTeamMembers = () => {
    if (!agentStatus) return [];

    return PHASE_SEQUENCE.map(phase => ({
      phase,
      status: phase === agentStatus.currentPhase ? agentStatus.status :
              PHASE_SEQUENCE.indexOf(phase) < PHASE_SEQUENCE.indexOf(agentStatus.currentPhase) ? 'COMPLETED' as const : 'IDLE' as const,
      progress: phase === agentStatus.currentPhase ? agentStatus.progress : undefined,
      currentMessage: phase === agentStatus.currentPhase ? getCurrentMessage() : undefined
    }));
  };

  // Handle phase clicks
  const handlePhaseClick = useCallback((phase: AgentPhase) => {
    if (!agentStatus) return;

    const currentIndex = PHASE_SEQUENCE.indexOf(agentStatus.currentPhase);
    const targetIndex = PHASE_SEQUENCE.indexOf(phase);

    // Only allow clicking on the next phase or completed phases for review
    if (targetIndex === currentIndex + 1 || targetIndex < currentIndex) {
      if (targetIndex === currentIndex + 1) {
        // Transitioning to next phase
        markPhaseComplete(agentStatus.currentPhase);
        setTimeout(() => {
          triggerTransition(phase);
        }, 1000);
      }
    }
  }, [agentStatus, markPhaseComplete, triggerTransition]);

  // Error boundary
  const handleError = useCallback((error: Error) => {
    setTeamState(prev => ({
      ...prev,
      error: error.message,
      isLoading: false,
      isRecovering: false
    }));
    onError?.(error);
  }, [onError]);

  if (teamState.isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="text-center space-y-4">
          <motion.div
            className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <div className="text-lg font-medium text-gray-900">
            {teamState.isRecovering ? 'Recovering session...' : 'Initializing AI team...'}
          </div>
          {teamState.isRecovering && (
            <div className="text-sm text-gray-600">
              Checking for previous session data
            </div>
          )}
        </div>
      </div>
    );
  }

  if (teamState.error) {
    return (
      <div className={cn('p-6 bg-red-50 border border-red-200 rounded-lg', className)}>
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div>
            <div className="font-medium text-red-900">AI Team Status Error</div>
            <div className="text-sm text-red-700">{teamState.error}</div>
          </div>
        </div>
        <button
          onClick={() => {
            setTeamState(prev => ({ ...prev, error: null, isLoading: true }));
            refreshStatus();
          }}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!agentStatus) return null;

  const progressPhases = generateProgressPhases();
  const teamMembers = generateTeamMembers();

  return (
    <div className={cn('space-y-6', className)}>
      {/* Recovery Banner */}
      <AnimatePresence>
        {recoveryBanner.show && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className={cn(
              'p-4 rounded-lg border',
              recoveryBanner.type === 'success' && 'bg-green-50 border-green-200 text-green-900',
              recoveryBanner.type === 'warning' && 'bg-amber-50 border-amber-200 text-amber-900',
              recoveryBanner.type === 'error' && 'bg-red-50 border-red-200 text-red-900'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {recoveryBanner.type === 'success' && (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium">{recoveryBanner.message}</span>
              </div>
              <button
                onClick={() => setRecoveryBanner(prev => ({ ...prev, show: false }))}
                className="text-current opacity-70 hover:opacity-100"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Team Working Animation */}
      {showTeamAnimation && (
        <TeamWorkingAnimations
          teamMembers={teamMembers}
          currentPhase={agentStatus.currentPhase}
          showConnectionLines={true}
          showCollaborationEffects={true}
          animationIntensity="normal"
          onMemberClick={handlePhaseClick}
        />
      )}

      {/* Progress Visualization */}
      {showProgressVisualization && (
        <ProgressVisualization
          phases={progressPhases}
          currentPhase={agentStatus.currentPhase}
          timeEstimate={timeEstimate}
          showTimeEstimate={true}
          variant={progressVariant}
          onPhaseClick={handlePhaseClick}
        />
      )}

      {/* Current Status Summary */}
      <motion.div
        className="bg-white border border-gray-200 rounded-lg p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <AgentStatusIndicator
              agentPhase={agentStatus.currentPhase}
              status={agentStatus.status}
              progress={agentStatus.progress}
              currentMessage={getCurrentMessage()}
              size="md"
              showProgress={true}
              animationState={
                agentStatus.status === 'WORKING' ? 'working' :
                agentStatus.status === 'TRANSITIONING' ? 'transitioning' :
                agentStatus.status === 'COMPLETED' ? 'celebrating' : 'idle'
              }
            />
            <div>
              <div className="font-medium text-gray-900">
                Current Status: {agentStatus.status.toLowerCase().replace('_', ' ')}
              </div>
              <div className="text-sm text-gray-600">
                Session Progress: {Math.round(getSessionProgress() * 100)}%
              </div>
              {agentStatus.currentActivity && (
                <div className="text-sm text-blue-600 mt-1">
                  {agentStatus.currentActivity}
                </div>
              )}
            </div>
          </div>

          <div className="text-right">
            {timeEstimate && (
              <>
                <div className="text-lg font-semibold text-gray-900">
                  {timeEstimate.timeRemaining} min remaining
                </div>
                <div className="text-sm text-gray-600">
                  Est. completion: {timeEstimate.estimatedCompletionTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {displayState.currentMessage && (
          <motion.div
            key={displayState.currentMessage.id}
            className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="text-sm text-blue-900">
              <span className="font-medium">Status: </span>
              {getCurrentMessage()}
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Debug Panel (Development only) */}
      {process.env.NODE_ENV === 'development' && (
        <details className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <summary className="cursor-pointer font-medium text-gray-700 mb-2">
            Debug Information
          </summary>
          <div className="text-xs text-gray-600 space-y-2">
            <div>Workflow ID: {workflowExecutionId}</div>
            <div>Recovery Score: {teamState.recoveryScore ? (teamState.recoveryScore * 100).toFixed(1) + '%' : 'N/A'}</div>
            <div>Has Recovered: {teamState.hasRecovered ? 'Yes' : 'No'}</div>
            <div>Auto-save: {enableAutoSave ? 'Enabled' : 'Disabled'}</div>
            <div>Persistence: {enablePersistence ? 'Enabled' : 'Disabled'}</div>
          </div>
        </details>
      )}
    </div>
  );
};

export default AITeamStatusDashboard;