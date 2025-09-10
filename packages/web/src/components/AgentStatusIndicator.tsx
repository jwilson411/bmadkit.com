import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import type { AgentPhase } from '../utils/status-message-library';
import { AGENT_PROFILES } from '../utils/status-message-library';

export interface AgentStatusIndicatorProps {
  agentPhase: AgentPhase;
  status: 'IDLE' | 'WORKING' | 'TRANSITIONING' | 'COMPLETED' | 'ERROR';
  progress?: number; // 0-1
  currentMessage?: string;
  showProgress?: boolean;
  showAvatar?: boolean;
  animationState?: 'idle' | 'working' | 'transitioning' | 'celebrating';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  theme?: 'light' | 'dark';
  onAgentClick?: (phase: AgentPhase) => void;
}

const AGENT_COLORS = {
  ANALYST: {
    primary: 'from-blue-500 to-cyan-500',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-900',
    accent: 'text-blue-600'
  },
  PM: {
    primary: 'from-green-500 to-emerald-500',
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-900',
    accent: 'text-green-600'
  },
  UX_EXPERT: {
    primary: 'from-purple-500 to-pink-500',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-900',
    accent: 'text-purple-600'
  },
  ARCHITECT: {
    primary: 'from-orange-500 to-red-500',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-900',
    accent: 'text-orange-600'
  }
};

const AGENT_AVATARS = {
  ANALYST: (
    <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="currentColor"/>
      <path d="M19 7H5C4.45 7 4 7.45 4 8V20C4 20.55 4.45 21 5 21H19C19.55 21 20 20.55 20 20V8C20 7.45 19.55 7 19 7Z" fill="currentColor" opacity="0.7"/>
      <path d="M9 10H15V12H9V10Z" fill="white"/>
      <path d="M9 14H15V16H9V14Z" fill="white"/>
      <path d="M9 18H12V19H9V18Z" fill="white"/>
    </svg>
  ),
  PM: (
    <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="currentColor"/>
      <path d="M3 9L12 6L21 9V20C21 20.55 20.55 21 20 21H4C3.45 21 3 20.55 3 20V9Z" fill="currentColor" opacity="0.7"/>
      <path d="M8 12H16V14H8V12Z" fill="white"/>
      <path d="M8 16H13V18H8V16Z" fill="white"/>
      <circle cx="17" cy="15" r="2" fill="currentColor"/>
    </svg>
  ),
  UX_EXPERT: (
    <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="currentColor"/>
      <path d="M12 7L8 21H16L12 7Z" fill="currentColor" opacity="0.7"/>
      <path d="M10 10L12 14L14 10H10Z" fill="white"/>
      <circle cx="12" cy="17" r="1.5" fill="white"/>
      <path d="M8 21C6 19 6 17 8 17H16C18 17 18 19 16 21" fill="currentColor"/>
    </svg>
  ),
  ARCHITECT: (
    <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2Z" fill="currentColor"/>
      <path d="M4 8H20V20C20 20.55 19.55 21 19 21H5C4.45 21 4 20.55 4 20V8Z" fill="currentColor" opacity="0.7"/>
      <rect x="7" y="11" width="3" height="3" fill="white" rx="0.5"/>
      <rect x="11" y="11" width="3" height="3" fill="white" rx="0.5"/>
      <rect x="15" y="11" width="2" height="3" fill="white" rx="0.5"/>
      <rect x="7" y="15" width="10" height="2" fill="white" rx="0.5"/>
    </svg>
  )
};

export const AgentStatusIndicator: React.FC<AgentStatusIndicatorProps> = ({
  agentPhase,
  status,
  progress = 0,
  currentMessage,
  showProgress = true,
  showAvatar = true,
  animationState = 'idle',
  className,
  size = 'md',
  theme = 'light',
  onAgentClick
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);

  const agentProfile = AGENT_PROFILES[agentPhase];
  const colors = AGENT_COLORS[agentPhase];
  const avatar = AGENT_AVATARS[agentPhase];

  const sizeClasses = {
    sm: {
      container: 'w-16 h-16',
      avatar: 'w-8 h-8',
      text: 'text-xs',
      message: 'text-xs max-w-32'
    },
    md: {
      container: 'w-20 h-20',
      avatar: 'w-10 h-10',
      text: 'text-sm',
      message: 'text-sm max-w-48'
    },
    lg: {
      container: 'w-24 h-24',
      avatar: 'w-12 h-12', 
      text: 'text-base',
      message: 'text-sm max-w-64'
    }
  };

  // Trigger pulse animation on status change
  useEffect(() => {
    if (status === 'WORKING' || status === 'TRANSITIONING') {
      setPulseKey(prev => prev + 1);
    }
  }, [status, animationState]);

  // Working animation variants
  const workingAnimation = {
    scale: [1, 1.05, 1],
    transition: {
      duration: 2,
      repeat: Infinity,
      repeatType: 'reverse' as const
    }
  };

  const transitioningAnimation = {
    rotate: [0, 360],
    scale: [1, 1.1, 1],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut'
    }
  };

  const celebratingAnimation = {
    scale: [1, 1.2, 1],
    rotate: [0, -5, 5, 0],
    transition: {
      duration: 0.6,
      repeat: 2,
      repeatType: 'reverse' as const
    }
  };

  const getAnimationProps = () => {
    switch (animationState) {
      case 'working':
        return status === 'WORKING' ? workingAnimation : {};
      case 'transitioning':
        return transitioningAnimation;
      case 'celebrating':
        return celebratingAnimation;
      default:
        return {};
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'WORKING':
        return (
          <motion.div
            key={pulseKey}
            className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.2, 1] }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-full h-full bg-green-500 rounded-full animate-ping opacity-75" />
          </motion.div>
        );
      case 'TRANSITIONING':
        return (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
            <motion.div
              className="w-2 h-2 border border-white rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        );
      case 'COMPLETED':
        return (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-600 rounded-full flex items-center justify-center">
            <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        );
      case 'ERROR':
        return (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div 
      className={cn('relative flex flex-col items-center gap-2', className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Agent Avatar */}
      <motion.div
        className={cn(
          'relative rounded-full border-2 cursor-pointer transition-all duration-200',
          sizeClasses[size].container,
          colors.border,
          colors.bg,
          isHovered && 'shadow-lg scale-105',
          onAgentClick && 'hover:shadow-lg hover:scale-105'
        )}
        animate={getAnimationProps()}
        onClick={() => onAgentClick?.(agentPhase)}
      >
        {/* Progress Ring */}
        {showProgress && progress > 0 && (
          <svg 
            className="absolute inset-0 w-full h-full transform -rotate-90"
            viewBox="0 0 100 100"
          >
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-gray-200"
            />
            <motion.circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className={colors.accent}
              strokeDasharray="283"
              initial={{ strokeDashoffset: 283 }}
              animate={{ strokeDashoffset: 283 - (283 * progress) }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </svg>
        )}

        {/* Avatar Background */}
        <div className={cn(
          'w-full h-full rounded-full bg-gradient-to-br flex items-center justify-center',
          colors.primary
        )}>
          {showAvatar ? (
            <div className={cn('text-white', sizeClasses[size].avatar)}>
              {avatar}
            </div>
          ) : (
            <div className={cn('font-bold text-white', sizeClasses[size].text)}>
              {agentPhase.charAt(0)}
            </div>
          )}
        </div>

        {/* Status Indicator */}
        {getStatusIcon()}
      </motion.div>

      {/* Agent Title */}
      <div className="text-center">
        <div className={cn(
          'font-medium',
          colors.text,
          sizeClasses[size].text
        )}>
          {agentProfile.title}
        </div>
        
        {/* Status Message */}
        <AnimatePresence mode="wait">
          {currentMessage && (
            <motion.div
              key={currentMessage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className={cn(
                'text-gray-600 leading-tight mt-1',
                sizeClasses[size].message
              )}
            >
              {currentMessage}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hover Tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 z-50"
          >
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg max-w-48">
              <div className="font-medium mb-1">{agentProfile.title}</div>
              <div className="text-gray-300">
                {agentProfile.expertise.slice(0, 2).join(' • ')}
              </div>
              {showProgress && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <div className="flex justify-between items-center">
                    <span>Progress</span>
                    <span>{Math.round(progress * 100)}%</span>
                  </div>
                </div>
              )}
              
              {/* Tooltip arrow */}
              <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Working State Glow Effect */}
      {status === 'WORKING' && (
        <motion.div
          className={cn(
            'absolute inset-0 rounded-full opacity-20',
            colors.primary.replace('from-', 'bg-').split(' ')[0]
          )}
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.2, 0.05, 0.2]
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      )}
    </div>
  );
};

export default AgentStatusIndicator;