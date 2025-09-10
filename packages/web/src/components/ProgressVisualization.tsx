import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import type { AgentPhase } from '../utils/status-message-library';
import { AGENT_PROFILES } from '../utils/status-message-library';
import type { TimeEstimationResult } from '../utils/time-estimation';

export interface ProgressPhase {
  phase: AgentPhase;
  title: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';
  progress: number; // 0-1
  estimatedDuration?: number; // minutes
  actualDuration?: number; // minutes
  startTime?: Date;
  completionTime?: Date;
}

export interface ProgressVisualizationProps {
  phases: ProgressPhase[];
  currentPhase: AgentPhase;
  timeEstimate?: TimeEstimationResult | null;
  showTimeEstimate?: boolean;
  showPhaseDetails?: boolean;
  variant?: 'minimal' | 'detailed' | 'timeline';
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  theme?: 'light' | 'dark';
  onPhaseClick?: (phase: AgentPhase) => void;
}

const PHASE_COLORS = {
  ANALYST: {
    primary: 'rgb(59, 130, 246)',
    light: 'rgb(219, 234, 254)',
    gradient: 'from-blue-400 to-blue-600'
  },
  PM: {
    primary: 'rgb(34, 197, 94)',
    light: 'rgb(220, 252, 231)',
    gradient: 'from-green-400 to-green-600'
  },
  UX_EXPERT: {
    primary: 'rgb(168, 85, 247)',
    light: 'rgb(243, 232, 255)',
    gradient: 'from-purple-400 to-purple-600'
  },
  ARCHITECT: {
    primary: 'rgb(249, 115, 22)',
    light: 'rgb(254, 235, 200)',
    gradient: 'from-orange-400 to-orange-600'
  }
};

const MinimalProgress: React.FC<{
  phases: ProgressPhase[];
  currentPhase: AgentPhase;
  onPhaseClick?: (phase: AgentPhase) => void;
}> = ({ phases, currentPhase, onPhaseClick }) => {
  const currentIndex = phases.findIndex(p => p.phase === currentPhase);
  const overallProgress = phases.reduce((acc, phase, index) => {
    if (phase.status === 'COMPLETED') return acc + (1 / phases.length);
    if (phase.status === 'IN_PROGRESS') return acc + (phase.progress / phases.length);
    return acc;
  }, 0);

  return (
    <div className="w-full space-y-3">
      {/* Progress Bar */}
      <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: `${overallProgress * 100}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        
        {/* Phase Markers */}
        {phases.map((phase, index) => (
          <div
            key={phase.phase}
            className="absolute top-0 h-full w-px bg-white opacity-50"
            style={{ left: `${((index + 1) / phases.length) * 100}%` }}
          />
        ))}
      </div>

      {/* Current Phase Info */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="font-medium text-gray-900">
            {AGENT_PROFILES[currentPhase].title}
          </span>
          <span className="text-gray-500 ml-2">
            Phase {currentIndex + 1} of {phases.length}
          </span>
        </div>
        <div className="text-gray-600">
          {Math.round(overallProgress * 100)}% Complete
        </div>
      </div>
    </div>
  );
};

const DetailedProgress: React.FC<{
  phases: ProgressPhase[];
  currentPhase: AgentPhase;
  timeEstimate?: TimeEstimationResult | null;
  showTimeEstimate?: boolean;
  onPhaseClick?: (phase: AgentPhase) => void;
}> = ({ phases, currentPhase, timeEstimate, showTimeEstimate, onPhaseClick }) => {
  return (
    <div className="space-y-4">
      {/* Overall Progress Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Planning Progress</h3>
        {showTimeEstimate && timeEstimate && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">{timeEstimate.timeRemaining} min</span> remaining
          </div>
        )}
      </div>

      {/* Phase Cards */}
      <div className="space-y-3">
        {phases.map((phase, index) => {
          const colors = PHASE_COLORS[phase.phase];
          const profile = AGENT_PROFILES[phase.phase];
          const isActive = phase.phase === currentPhase;
          
          return (
            <motion.div
              key={phase.phase}
              className={cn(
                'relative p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer',
                phase.status === 'COMPLETED' 
                  ? 'bg-green-50 border-green-200'
                  : isActive
                  ? `border-[${colors.primary}] bg-white shadow-md`
                  : 'bg-gray-50 border-gray-200 hover:border-gray-300'
              )}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onPhaseClick?.(phase.phase)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Phase Icon/Status */}
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold',
                    phase.status === 'COMPLETED' 
                      ? 'bg-green-500'
                      : isActive
                      ? `bg-gradient-to-br ${colors.gradient}`
                      : 'bg-gray-400'
                  )}>
                    {phase.status === 'COMPLETED' ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>

                  <div>
                    <div className="font-medium text-gray-900">{profile.title}</div>
                    <div className="text-sm text-gray-600">
                      {phase.status === 'COMPLETED' 
                        ? 'Completed' 
                        : isActive 
                        ? 'In Progress' 
                        : 'Pending'
                      }
                    </div>
                  </div>
                </div>

                {/* Progress Indicator */}
                {isActive && phase.progress > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full bg-gradient-to-r ${colors.gradient} rounded-full`}
                        initial={{ width: '0%' }}
                        animate={{ width: `${phase.progress * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    <span className="text-sm text-gray-600">
                      {Math.round(phase.progress * 100)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Phase Progress Bar (for active phase) */}
              {isActive && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <motion.div
                    className={`h-full bg-gradient-to-r ${colors.gradient}`}
                    initial={{ width: '0%' }}
                    animate={{ width: `${phase.progress * 100}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Time Estimate Summary */}
      {showTimeEstimate && timeEstimate && (
        <motion.div
          className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-between text-sm">
            <div>
              <span className="font-medium text-blue-900">Session Progress:</span>
              <span className="text-blue-700 ml-2">
                {Math.round(timeEstimate.sessionProgress * 100)}%
              </span>
            </div>
            <div>
              <span className="text-blue-700">
                Est. Completion: {timeEstimate.estimatedCompletionTime.toLocaleTimeString([], { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

const TimelineProgress: React.FC<{
  phases: ProgressPhase[];
  currentPhase: AgentPhase;
  timeEstimate?: TimeEstimationResult | null;
  onPhaseClick?: (phase: AgentPhase) => void;
}> = ({ phases, currentPhase, timeEstimate, onPhaseClick }) => {
  return (
    <div className="relative">
      {/* Timeline Line */}
      <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-300"></div>
      
      <div className="space-y-6">
        {phases.map((phase, index) => {
          const colors = PHASE_COLORS[phase.phase];
          const profile = AGENT_PROFILES[phase.phase];
          const isActive = phase.phase === currentPhase;
          const isCompleted = phase.status === 'COMPLETED';
          
          return (
            <motion.div
              key={phase.phase}
              className="relative flex items-center gap-4"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              {/* Timeline Node */}
              <div className={cn(
                'relative z-10 w-12 h-12 rounded-full border-4 flex items-center justify-center transition-all duration-200',
                isCompleted 
                  ? 'bg-green-500 border-green-500 text-white'
                  : isActive
                  ? `bg-white border-[${colors.primary}] text-[${colors.primary}]`
                  : 'bg-gray-200 border-gray-300 text-gray-500'
              )}>
                {isCompleted ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <span className="font-bold">{index + 1}</span>
                )}
                
                {/* Pulse Animation for Active */}
                {isActive && !isCompleted && (
                  <motion.div
                    className={`absolute inset-0 rounded-full border-2 border-[${colors.primary}] opacity-50`}
                    animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
              </div>

              {/* Phase Content */}
              <motion.div
                className={cn(
                  'flex-1 p-4 rounded-lg cursor-pointer transition-all duration-200',
                  isActive 
                    ? 'bg-white border border-gray-200 shadow-md'
                    : 'bg-gray-50 hover:bg-gray-100'
                )}
                whileHover={{ scale: 1.02 }}
                onClick={() => onPhaseClick?.(phase.phase)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">{profile.title}</h4>
                    <p className="text-sm text-gray-600">
                      {phase.status === 'COMPLETED' ? 'Completed' : 
                       phase.status === 'IN_PROGRESS' ? 'In Progress' : 'Pending'}
                    </p>
                  </div>
                  
                  {/* Time Info */}
                  <div className="text-right text-sm text-gray-500">
                    {phase.actualDuration && (
                      <div>{Math.round(phase.actualDuration)} min</div>
                    )}
                    {phase.estimatedDuration && !phase.actualDuration && (
                      <div>~{Math.round(phase.estimatedDuration)} min</div>
                    )}
                  </div>
                </div>

                {/* Progress Bar for Active Phase */}
                {isActive && phase.progress > 0 && (
                  <div className="mt-3">
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full bg-gradient-to-r ${colors.gradient} rounded-full`}
                        initial={{ width: '0%' }}
                        animate={{ width: `${phase.progress * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {Math.round(phase.progress * 100)}% complete
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export const ProgressVisualization: React.FC<ProgressVisualizationProps> = ({
  phases,
  currentPhase,
  timeEstimate,
  showTimeEstimate = true,
  showPhaseDetails = true,
  variant = 'detailed',
  orientation = 'vertical',
  className,
  theme = 'light',
  onPhaseClick
}) => {
  const [animationKey, setAnimationKey] = useState(0);

  // Trigger re-animation when current phase changes
  useEffect(() => {
    setAnimationKey(prev => prev + 1);
  }, [currentPhase]);

  const renderVariant = () => {
    switch (variant) {
      case 'minimal':
        return (
          <MinimalProgress
            phases={phases}
            currentPhase={currentPhase}
            onPhaseClick={onPhaseClick}
          />
        );
      case 'timeline':
        return (
          <TimelineProgress
            phases={phases}
            currentPhase={currentPhase}
            timeEstimate={timeEstimate}
            onPhaseClick={onPhaseClick}
          />
        );
      case 'detailed':
      default:
        return (
          <DetailedProgress
            phases={phases}
            currentPhase={currentPhase}
            timeEstimate={timeEstimate}
            showTimeEstimate={showTimeEstimate}
            onPhaseClick={onPhaseClick}
          />
        );
    }
  };

  return (
    <div 
      key={animationKey}
      className={cn(
        'w-full',
        theme === 'dark' && 'dark',
        className
      )}
    >
      {renderVariant()}
    </div>
  );
};

export default ProgressVisualization;