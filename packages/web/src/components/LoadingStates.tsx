import React from 'react';
import { cn } from '@/utils/cn';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <div className={cn('loading-spinner', sizeClasses[size], className)} />
  );
}

interface LoadingDotsProps {
  className?: string;
}

export function LoadingDots({ className }: LoadingDotsProps) {
  return (
    <div className={cn('flex space-x-1', className)}>
      <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="loading-pulse h-4 rounded"
          style={{ width: `${Math.random() * 40 + 60}%` }}
        />
      ))}
    </div>
  );
}

interface AIProcessingIndicatorProps {
  message?: string;
  className?: string;
}

export function AIProcessingIndicator({ 
  message = 'AI experts are analyzing your project...', 
  className 
}: AIProcessingIndicatorProps) {
  return (
    <div className={cn('flex items-center space-x-3 p-4 bg-primary-50 rounded-lg border border-primary-200', className)}>
      <div className="flex-shrink-0">
        <div className="relative">
          <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="absolute -inset-1 bg-primary-400 rounded-full animate-ping opacity-75" />
        </div>
      </div>
      <div className="flex-1">
        <p className="text-primary-800 font-medium">{message}</p>
      </div>
      <LoadingDots className="flex-shrink-0" />
    </div>
  );
}

interface ConnectionStatusProps {
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  className?: string;
}

export function ConnectionStatus({ status, className }: ConnectionStatusProps) {
  const statusConfig = {
    disconnected: {
      color: 'bg-red-500',
      text: 'Disconnected',
      icon: (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
        </svg>
      )
    },
    connecting: {
      color: 'bg-yellow-500',
      text: 'Connecting...',
      icon: <LoadingSpinner size="sm" />
    },
    connected: {
      color: 'bg-green-500',
      text: 'Connected',
      icon: (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )
    },
    reconnecting: {
      color: 'bg-orange-500',
      text: 'Reconnecting...',
      icon: <LoadingSpinner size="sm" />
    }
  };

  const config = statusConfig[status];

  return (
    <div className={cn('flex items-center space-x-2 px-3 py-2 bg-white border rounded-lg shadow-sm', className)}>
      <div className={cn('flex items-center justify-center w-4 h-4 rounded-full text-white', config.color)}>
        {config.icon}
      </div>
      <span className="text-sm font-medium text-gray-700">{config.text}</span>
    </div>
  );
}

interface ProgressBarProps {
  percentage: number;
  label?: string;
  showPercentage?: boolean;
  className?: string;
}

export function ProgressBar({ 
  percentage, 
  label, 
  showPercentage = true, 
  className 
}: ProgressBarProps) {
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  return (
    <div className={cn('space-y-2', className)}>
      {(label || showPercentage) && (
        <div className="flex justify-between items-center">
          {label && <span className="text-sm font-medium text-gray-700">{label}</span>}
          {showPercentage && <span className="text-sm text-gray-500">{clampedPercentage.toFixed(0)}%</span>}
        </div>
      )}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div 
          className="bg-primary-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${clampedPercentage}%` }}
        />
      </div>
    </div>
  );
}

interface AgentIndicatorProps {
  agentType: 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT' | 'USER';
  status: 'STARTING' | 'WORKING' | 'COMPLETED' | 'HANDOFF';
  task?: string;
  className?: string;
}

export function AgentIndicator({ agentType, status, task, className }: AgentIndicatorProps) {
  const agentConfig = {
    ANALYST: {
      name: 'Business Analyst',
      color: 'bg-blue-600',
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    PM: {
      name: 'Product Manager',
      color: 'bg-purple-600',
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
      )
    },
    UX_EXPERT: {
      name: 'UX Expert',
      color: 'bg-pink-600',
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
        </svg>
      )
    },
    ARCHITECT: {
      name: 'Software Architect',
      color: 'bg-indigo-600',
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      )
    },
    USER: {
      name: 'You',
      color: 'bg-gray-600',
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
        </svg>
      )
    }
  };

  const statusConfig = {
    STARTING: { color: 'text-yellow-600', label: 'Starting' },
    WORKING: { color: 'text-green-600', label: 'Working' },
    COMPLETED: { color: 'text-blue-600', label: 'Completed' },
    HANDOFF: { color: 'text-purple-600', label: 'Handoff' }
  };

  const agent = agentConfig[agentType];
  const statusInfo = statusConfig[status];

  return (
    <div className={cn('flex items-center space-x-3 p-3 bg-white rounded-lg border', className)}>
      <div className={cn('flex items-center justify-center w-10 h-10 rounded-full text-white', agent.color)}>
        {agent.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium text-gray-900">{agent.name}</p>
          <span className={cn('text-xs font-medium', statusInfo.color)}>
            {statusInfo.label}
          </span>
          {status === 'WORKING' && <LoadingDots />}
        </div>
        {task && (
          <p className="text-sm text-gray-600 truncate">{task}</p>
        )}
      </div>
    </div>
  );
}

export default {
  LoadingSpinner,
  LoadingDots,
  Skeleton,
  AIProcessingIndicator,
  ConnectionStatus,
  ProgressBar,
  AgentIndicator,
};