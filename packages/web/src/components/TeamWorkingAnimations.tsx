import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils/cn';
import type { AgentPhase } from '../utils/status-message-library';
import { AGENT_PROFILES } from '../utils/status-message-library';
import AgentStatusIndicator from './AgentStatusIndicator';

export interface TeamWorkingAnimationsProps {
  teamMembers: Array<{
    phase: AgentPhase;
    status: 'IDLE' | 'WORKING' | 'TRANSITIONING' | 'COMPLETED' | 'ERROR';
    progress?: number;
    currentMessage?: string;
  }>;
  currentPhase: AgentPhase;
  showConnectionLines?: boolean;
  showCollaborationEffects?: boolean;
  animationIntensity?: 'subtle' | 'normal' | 'intense';
  className?: string;
  onMemberClick?: (phase: AgentPhase) => void;
}

interface CollaborationEffect {
  id: string;
  from: AgentPhase;
  to: AgentPhase;
  type: 'data_flow' | 'consultation' | 'handoff' | 'feedback';
  startTime: number;
  duration: number;
}

const COLLABORATION_PATTERNS = {
  ANALYST: {
    flows_to: ['PM', 'UX_EXPERT'],
    consults_with: ['ARCHITECT'],
    handoff_to: 'PM'
  },
  PM: {
    flows_to: ['UX_EXPERT', 'ARCHITECT'],
    consults_with: ['ANALYST'],
    handoff_to: 'UX_EXPERT'
  },
  UX_EXPERT: {
    flows_to: ['ARCHITECT'],
    consults_with: ['PM', 'ANALYST'],
    handoff_to: 'ARCHITECT'
  },
  ARCHITECT: {
    flows_to: [],
    consults_with: ['ANALYST', 'PM', 'UX_EXPERT'],
    handoff_to: null
  }
};

const ANIMATION_VARIANTS = {
  subtle: {
    pulseIntensity: 0.05,
    connectionOpacity: 0.3,
    effectDuration: 3000,
    effectFrequency: 8000
  },
  normal: {
    pulseIntensity: 0.1,
    connectionOpacity: 0.5,
    effectDuration: 2000,
    effectFrequency: 5000
  },
  intense: {
    pulseIntensity: 0.15,
    connectionOpacity: 0.7,
    effectDuration: 1500,
    effectFrequency: 3000
  }
};

export const TeamWorkingAnimations: React.FC<TeamWorkingAnimationsProps> = ({
  teamMembers,
  currentPhase,
  showConnectionLines = true,
  showCollaborationEffects = true,
  animationIntensity = 'normal',
  className,
  onMemberClick
}) => {
  const [collaborationEffects, setCollaborationEffects] = useState<CollaborationEffect[]>([]);
  const [teamPulse, setTeamPulse] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const memberRefs = useRef<Record<AgentPhase, HTMLDivElement | null>>({
    ANALYST: null,
    PM: null,
    UX_EXPERT: null,
    ARCHITECT: null
  });

  const animationConfig = ANIMATION_VARIANTS[animationIntensity];

  // Generate collaboration effects
  useEffect(() => {
    if (!showCollaborationEffects) return;

    const generateEffect = () => {
      const workingMembers = teamMembers.filter(m => m.status === 'WORKING');
      if (workingMembers.length === 0) return;

      const currentMember = workingMembers.find(m => m.phase === currentPhase);
      if (!currentMember) return;

      const patterns = COLLABORATION_PATTERNS[currentPhase];
      const possibleTargets = [
        ...patterns.flows_to,
        ...patterns.consults_with
      ].filter(target => 
        teamMembers.some(m => m.phase === target && m.status !== 'IDLE')
      );

      if (possibleTargets.length === 0) return;

      const targetPhase = possibleTargets[Math.floor(Math.random() * possibleTargets.length)] as AgentPhase;
      const effectType = patterns.flows_to.includes(targetPhase) ? 'data_flow' : 'consultation';

      const newEffect: CollaborationEffect = {
        id: `effect_${Date.now()}_${Math.random()}`,
        from: currentPhase,
        to: targetPhase,
        type: effectType,
        startTime: Date.now(),
        duration: animationConfig.effectDuration
      };

      setCollaborationEffects(prev => [...prev, newEffect]);

      // Clean up effect after animation
      setTimeout(() => {
        setCollaborationEffects(prev => prev.filter(e => e.id !== newEffect.id));
      }, animationConfig.effectDuration);
    };

    const interval = setInterval(generateEffect, animationConfig.effectFrequency);
    return () => clearInterval(interval);
  }, [teamMembers, currentPhase, showCollaborationEffects, animationConfig]);

  // Team pulse effect
  useEffect(() => {
    const activeMembers = teamMembers.filter(m => m.status === 'WORKING').length;
    if (activeMembers === 0) return;

    const pulseInterval = setInterval(() => {
      setTeamPulse(prev => prev + 1);
    }, 2000);

    return () => clearInterval(pulseInterval);
  }, [teamMembers]);

  // Calculate connection line coordinates
  const getConnectionPath = (from: AgentPhase, to: AgentPhase): string => {
    const fromRef = memberRefs.current[from];
    const toRef = memberRefs.current[to];
    
    if (!fromRef || !toRef || !containerRef.current) return '';

    const containerRect = containerRef.current.getBoundingClientRect();
    const fromRect = fromRef.getBoundingClientRect();
    const toRect = toRef.getBoundingClientRect();

    const fromX = fromRect.left - containerRect.left + fromRect.width / 2;
    const fromY = fromRect.top - containerRect.top + fromRect.height / 2;
    const toX = toRect.left - containerRect.left + toRect.width / 2;
    const toY = toRect.top - containerRect.top + toRect.height / 2;

    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    const controlY = midY - Math.abs(toX - fromX) * 0.2;

    return `M ${fromX} ${fromY} Q ${midX} ${controlY} ${toX} ${toY}`;
  };

  // Team formation layout
  const getTeamLayout = () => {
    return {
      ANALYST: { x: '20%', y: '30%' },
      PM: { x: '50%', y: '20%' },
      UX_EXPERT: { x: '80%', y: '30%' },
      ARCHITECT: { x: '50%', y: '70%' }
    };
  };

  const teamLayout = getTeamLayout();

  return (
    <div 
      ref={containerRef}
      className={cn(
        'relative w-full h-96 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Background grid effect */}
      <div className="absolute inset-0 opacity-20">
        <svg width="100%" height="100%">
          <defs>
            <pattern
              id="grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="text-slate-300"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Connection lines */}
      {showConnectionLines && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(59, 130, 246, 0.6)" />
              <stop offset="50%" stopColor="rgba(147, 51, 234, 0.6)" />
              <stop offset="100%" stopColor="rgba(59, 130, 246, 0.6)" />
            </linearGradient>
          </defs>
          
          {Object.entries(COLLABORATION_PATTERNS).map(([from, patterns]) => 
            patterns.flows_to.map(to => {
              const path = getConnectionPath(from as AgentPhase, to as AgentPhase);
              const isActive = from === currentPhase || to === currentPhase;
              
              return (
                <motion.path
                  key={`${from}-${to}`}
                  d={path}
                  fill="none"
                  stroke="url(#connectionGradient)"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                  className="transition-all duration-500"
                  initial={{ opacity: 0 }}
                  animate={{ 
                    opacity: isActive ? animationConfig.connectionOpacity : 0.2,
                    pathLength: [0, 1, 0]
                  }}
                  transition={{
                    opacity: { duration: 0.5 },
                    pathLength: { duration: 3, repeat: Infinity, ease: "linear" }
                  }}
                />
              );
            })
          )}
        </svg>
      )}

      {/* Team members */}
      {teamMembers.map(member => {
        const position = teamLayout[member.phase];
        const isCurrentPhase = member.phase === currentPhase;
        
        return (
          <motion.div
            key={member.phase}
            ref={el => memberRefs.current[member.phase] = el}
            className="absolute transform -translate-x-1/2 -translate-y-1/2"
            style={{
              left: position.x,
              top: position.y
            }}
            animate={{
              scale: isCurrentPhase ? [1, 1.05, 1] : 1,
              y: member.status === 'WORKING' ? [0, -5, 0] : 0
            }}
            transition={{
              scale: { duration: 2, repeat: Infinity },
              y: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
            }}
          >
            <AgentStatusIndicator
              agentPhase={member.phase}
              status={member.status}
              progress={member.progress}
              currentMessage={member.currentMessage}
              size="lg"
              showProgress={true}
              showAvatar={true}
              animationState={
                member.status === 'WORKING' ? 'working' :
                member.status === 'TRANSITIONING' ? 'transitioning' :
                member.status === 'COMPLETED' ? 'celebrating' : 'idle'
              }
              onAgentClick={onMemberClick}
            />
            
            {/* Team member glow effect */}
            {isCurrentPhase && (
              <motion.div
                className="absolute inset-0 rounded-full bg-blue-400 opacity-20 blur-xl"
                animate={{
                  scale: [1, 1.5, 1],
                  opacity: [0.2, 0.05, 0.2]
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
            )}
          </motion.div>
        );
      })}

      {/* Collaboration effects */}
      <AnimatePresence>
        {collaborationEffects.map(effect => {
          const fromPosition = teamLayout[effect.from];
          const toPosition = teamLayout[effect.to];
          
          return (
            <motion.div
              key={effect.id}
              className="absolute pointer-events-none"
              initial={{
                left: fromPosition.x,
                top: fromPosition.y,
                scale: 0,
                opacity: 0
              }}
              animate={{
                left: toPosition.x,
                top: toPosition.y,
                scale: [0, 1, 0.5],
                opacity: [0, 1, 0]
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: effect.duration / 1000,
                ease: "easeOut"
              }}
            >
              <div className={cn(
                'w-3 h-3 rounded-full transform -translate-x-1/2 -translate-y-1/2',
                effect.type === 'data_flow' ? 'bg-blue-400' :
                effect.type === 'consultation' ? 'bg-purple-400' :
                effect.type === 'handoff' ? 'bg-green-400' :
                'bg-orange-400'
              )} />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Team synchronization pulse */}
      <motion.div
        key={teamPulse}
        className="absolute inset-0 border-4 border-blue-300 rounded-xl opacity-30"
        initial={{ scale: 0.95 }}
        animate={{ scale: [0.95, 1.02, 0.95] }}
        transition={{ duration: 2, ease: "easeInOut" }}
      />

      {/* Status legend */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-400 rounded-full" />
            <span>Data Flow</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-purple-400 rounded-full" />
            <span>Consultation</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-green-400 rounded-full" />
            <span>Handoff</span>
          </div>
        </div>
      </div>

      {/* Current phase indicator */}
      <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full" />
          <span className="font-medium">
            {AGENT_PROFILES[currentPhase].title} Leading
          </span>
        </div>
      </div>
    </div>
  );
};

export default TeamWorkingAnimations;