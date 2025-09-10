import { z } from 'zod';

// Agent phase enum
export const AgentPhaseEnum = z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']);
export type AgentPhase = z.infer<typeof AgentPhaseEnum>;

// Project types
export const ProjectTypeEnum = z.enum([
  'WEB_APPLICATION',
  'MOBILE_APP', 
  'API_SERVICE',
  'DESKTOP_APPLICATION',
  'ECOMMERCE',
  'SAAS_PLATFORM',
  'DATA_PLATFORM',
  'IOT_SYSTEM'
]);
export type ProjectType = z.infer<typeof ProjectTypeEnum>;

// Status message context
export interface StatusMessageContext {
  agentPhase: AgentPhase;
  projectType?: ProjectType;
  sessionProgress: number; // 0-1
  currentActivity?: string;
  userResponsePattern?: 'QUICK' | 'DETAILED' | 'HESITANT';
  complexity?: 'LOW' | 'MEDIUM' | 'HIGH';
  timeInPhase?: number; // minutes
}

// Status message template
export interface StatusMessageTemplate {
  id: string;
  agentPhase: AgentPhase;
  category: 'WORKING' | 'ANALYZING' | 'TRANSITIONING' | 'COMPLETING';
  message: string;
  duration: number; // milliseconds
  projectTypes?: ProjectType[];
  conditions?: {
    minProgress?: number;
    maxProgress?: number;
    minTimeInPhase?: number;
    complexity?: string[];
    userPattern?: string[];
  };
  variants?: string[];
  weight: number; // for random selection
}

// Agent profile information
export const AGENT_PROFILES = {
  ANALYST: {
    title: 'Business Analyst',
    expertise: ['Market Research', 'Business Strategy', 'Competitive Analysis', 'User Research'],
    personalityTraits: ['Analytical', 'Data-driven', 'Strategic', 'Thorough'],
    workingStyle: 'methodical and research-focused'
  },
  PM: {
    title: 'Project Manager', 
    expertise: ['Project Planning', 'Feature Prioritization', 'Risk Management', 'Resource Allocation'],
    personalityTraits: ['Organized', 'Strategic', 'Detail-oriented', 'Results-focused'],
    workingStyle: 'systematic and goal-oriented'
  },
  UX_EXPERT: {
    title: 'UX Expert',
    expertise: ['User Experience Design', 'User Journey Mapping', 'Usability Testing', 'Design Systems'],
    personalityTraits: ['Creative', 'User-focused', 'Empathetic', 'Design-thinking'],
    workingStyle: 'user-centered and iterative'
  },
  ARCHITECT: {
    title: 'Technical Architect',
    expertise: ['System Design', 'Technology Selection', 'Scalability Planning', 'Security Architecture'],
    personalityTraits: ['Technical', 'Systematic', 'Forward-thinking', 'Quality-focused'],
    workingStyle: 'methodical and architecture-focused'
  }
} as const;

// Comprehensive status message library
const STATUS_MESSAGE_TEMPLATES: StatusMessageTemplate[] = [
  // ANALYST PHASE MESSAGES
  {
    id: 'analyst_market_research',
    agentPhase: 'ANALYST',
    category: 'ANALYZING',
    message: 'Your Business Analyst is conducting market research and competitive analysis...',
    duration: 4000,
    projectTypes: ['WEB_APPLICATION', 'MOBILE_APP', 'SAAS_PLATFORM', 'ECOMMERCE'],
    conditions: { minProgress: 0.1, maxProgress: 0.4 },
    variants: [
      'Analyzing market opportunities and competitive landscape...',
      'Researching target audience and market positioning...',
      'Evaluating market dynamics and business opportunities...'
    ],
    weight: 1.0
  },
  {
    id: 'analyst_user_research',
    agentPhase: 'ANALYST',
    category: 'WORKING',
    message: 'Identifying user personas and pain points based on your project vision...',
    duration: 3500,
    conditions: { minProgress: 0.2, maxProgress: 0.6 },
    variants: [
      'Mapping user needs and behavioral patterns...',
      'Analyzing user pain points and solution opportunities...',
      'Developing user personas from your requirements...'
    ],
    weight: 1.2
  },
  {
    id: 'analyst_business_model',
    agentPhase: 'ANALYST',
    category: 'ANALYZING',
    message: 'Evaluating business model viability and revenue opportunities...',
    duration: 4500,
    projectTypes: ['SAAS_PLATFORM', 'ECOMMERCE', 'WEB_APPLICATION'],
    conditions: { minProgress: 0.3, complexity: ['MEDIUM', 'HIGH'] },
    variants: [
      'Assessing monetization strategies and business sustainability...',
      'Analyzing revenue streams and business model options...',
      'Evaluating market entry strategies and positioning...'
    ],
    weight: 0.9
  },

  // PM PHASE MESSAGES
  {
    id: 'pm_feature_analysis',
    agentPhase: 'PM',
    category: 'ANALYZING',
    message: 'Your Project Manager is breaking down features and defining project scope...',
    duration: 4000,
    conditions: { minProgress: 0.1, maxProgress: 0.5 },
    variants: [
      'Prioritizing features based on business value and user impact...',
      'Analyzing feature dependencies and development complexity...',
      'Structuring project deliverables and milestone planning...'
    ],
    weight: 1.1
  },
  {
    id: 'pm_user_stories',
    agentPhase: 'PM',
    category: 'WORKING',
    message: 'Creating detailed user stories and acceptance criteria...',
    duration: 3800,
    conditions: { minProgress: 0.3, maxProgress: 0.7 },
    variants: [
      'Translating requirements into actionable user stories...',
      'Defining acceptance criteria and success metrics...',
      'Organizing features into development sprints...'
    ],
    weight: 1.0
  },
  {
    id: 'pm_risk_assessment',
    agentPhase: 'PM',
    category: 'ANALYZING',
    message: 'Identifying project risks and mitigation strategies...',
    duration: 4200,
    conditions: { complexity: ['MEDIUM', 'HIGH'], minTimeInPhase: 3 },
    variants: [
      'Evaluating technical and business risks...',
      'Planning risk mitigation and contingency strategies...',
      'Assessing resource requirements and timeline constraints...'
    ],
    weight: 0.8
  },

  // UX_EXPERT PHASE MESSAGES  
  {
    id: 'ux_journey_mapping',
    agentPhase: 'UX_EXPERT',
    category: 'WORKING',
    message: 'Your UX Expert is mapping user journeys and interaction flows...',
    duration: 4100,
    conditions: { minProgress: 0.15, maxProgress: 0.6 },
    variants: [
      'Designing optimal user flows and navigation patterns...',
      'Mapping user touchpoints and interaction sequences...',
      'Creating seamless user experience pathways...'
    ],
    weight: 1.2
  },
  {
    id: 'ux_information_architecture',
    agentPhase: 'UX_EXPERT',
    category: 'ANALYZING',
    message: 'Designing information architecture and content organization...',
    duration: 3900,
    projectTypes: ['WEB_APPLICATION', 'SAAS_PLATFORM', 'ECOMMERCE'],
    conditions: { minProgress: 0.2, maxProgress: 0.7 },
    variants: [
      'Organizing content hierarchy and navigation structure...',
      'Structuring information for optimal user comprehension...',
      'Designing intuitive content categorization and flow...'
    ],
    weight: 1.0
  },
  {
    id: 'ux_usability_optimization',
    agentPhase: 'UX_EXPERT',
    category: 'WORKING',
    message: 'Optimizing user interface patterns for maximum usability...',
    duration: 4300,
    conditions: { minProgress: 0.4, complexity: ['MEDIUM', 'HIGH'] },
    variants: [
      'Applying usability best practices and design principles...',
      'Ensuring accessibility standards and inclusive design...',
      'Optimizing interactions for user efficiency and satisfaction...'
    ],
    weight: 0.9
  },

  // ARCHITECT PHASE MESSAGES
  {
    id: 'architect_system_design',
    agentPhase: 'ARCHITECT',
    category: 'ANALYZING',
    message: 'Your Technical Architect is designing system architecture and component structure...',
    duration: 4600,
    conditions: { minProgress: 0.1, maxProgress: 0.5 },
    variants: [
      'Architecting scalable system components and interactions...',
      'Designing robust technical infrastructure and data flows...',
      'Planning system architecture for optimal performance...'
    ],
    weight: 1.1
  },
  {
    id: 'architect_technology_selection',
    agentPhase: 'ARCHITECT',
    category: 'WORKING',
    message: 'Evaluating and selecting optimal technology stack...',
    duration: 4400,
    conditions: { minProgress: 0.2, maxProgress: 0.6 },
    variants: [
      'Analyzing technology options and compatibility requirements...',
      'Selecting frameworks and tools for development efficiency...',
      'Optimizing technology choices for project requirements...'
    ],
    weight: 1.0
  },
  {
    id: 'architect_scalability_planning',
    agentPhase: 'ARCHITECT',
    category: 'ANALYZING',
    message: 'Planning scalability strategies and performance optimization...',
    duration: 4800,
    projectTypes: ['SAAS_PLATFORM', 'DATA_PLATFORM', 'API_SERVICE'],
    conditions: { complexity: ['MEDIUM', 'HIGH'], minProgress: 0.4 },
    variants: [
      'Designing for horizontal scaling and high availability...',
      'Planning performance optimization and caching strategies...',
      'Architecting for future growth and system expansion...'
    ],
    weight: 0.8
  },

  // TRANSITION MESSAGES
  {
    id: 'analyst_to_pm_transition',
    agentPhase: 'ANALYST',
    category: 'TRANSITIONING',
    message: 'Transitioning insights to your Project Manager for scope definition...',
    duration: 2500,
    conditions: { minProgress: 0.9 },
    weight: 1.0
  },
  {
    id: 'pm_to_ux_transition',
    agentPhase: 'PM',
    category: 'TRANSITIONING',
    message: 'Handing off project scope to your UX Expert for user experience design...',
    duration: 2500,
    conditions: { minProgress: 0.9 },
    weight: 1.0
  },
  {
    id: 'ux_to_architect_transition',
    agentPhase: 'UX_EXPERT',
    category: 'TRANSITIONING',
    message: 'Sharing UX requirements with your Technical Architect...',
    duration: 2500,
    conditions: { minProgress: 0.9 },
    weight: 1.0
  },

  // COMPLETION MESSAGES
  {
    id: 'analyst_completion',
    agentPhase: 'ANALYST',
    category: 'COMPLETING',
    message: 'Business analysis complete! Moving to project management phase...',
    duration: 2000,
    conditions: { minProgress: 0.95 },
    weight: 1.0
  },
  {
    id: 'pm_completion',
    agentPhase: 'PM',
    category: 'COMPLETING',
    message: 'Project scope defined! Transitioning to user experience design...',
    duration: 2000,
    conditions: { minProgress: 0.95 },
    weight: 1.0
  },
  {
    id: 'ux_completion',
    agentPhase: 'UX_EXPERT',
    category: 'COMPLETING',
    message: 'User experience design complete! Moving to technical architecture...',
    duration: 2000,
    conditions: { minProgress: 0.95 },
    weight: 1.0
  },
  {
    id: 'architect_completion',
    agentPhase: 'ARCHITECT',
    category: 'COMPLETING',
    message: 'Technical architecture complete! Your planning session is finished.',
    duration: 2000,
    conditions: { minProgress: 0.95 },
    weight: 1.0
  }
];

export class StatusMessageLibrary {
  private static instance: StatusMessageLibrary;
  private messageHistory: Map<string, number> = new Map();
  private lastMessageTime: Map<AgentPhase, number> = new Map();

  static getInstance(): StatusMessageLibrary {
    if (!StatusMessageLibrary.instance) {
      StatusMessageLibrary.instance = new StatusMessageLibrary();
    }
    return StatusMessageLibrary.instance;
  }

  /**
   * Get contextual status message based on current state
   */
  getStatusMessage(context: StatusMessageContext): StatusMessageTemplate | null {
    const eligibleMessages = this.filterMessagesByContext(context);
    
    if (eligibleMessages.length === 0) {
      return this.getFallbackMessage(context);
    }

    // Apply diversity filtering to avoid repetition
    const diverseMessages = this.applyDiversityFilter(eligibleMessages, context.agentPhase);
    
    // Select message using weighted random selection
    return this.selectWeightedRandom(diverseMessages);
  }

  /**
   * Get transition message for agent handoffs
   */
  getTransitionMessage(fromPhase: AgentPhase, toPhase: AgentPhase): StatusMessageTemplate | null {
    const transitionId = `${fromPhase.toLowerCase()}_to_${toPhase.toLowerCase()}_transition`;
    return STATUS_MESSAGE_TEMPLATES.find(msg => msg.id === transitionId) || null;
  }

  /**
   * Get completion message for phase endings
   */
  getCompletionMessage(phase: AgentPhase): StatusMessageTemplate | null {
    const completionId = `${phase.toLowerCase()}_completion`;
    return STATUS_MESSAGE_TEMPLATES.find(msg => msg.id === completionId) || null;
  }

  /**
   * Get messages by category
   */
  getMessagesByCategory(
    category: StatusMessageTemplate['category'], 
    phase?: AgentPhase
  ): StatusMessageTemplate[] {
    return STATUS_MESSAGE_TEMPLATES.filter(msg => 
      msg.category === category && (!phase || msg.agentPhase === phase)
    );
  }

  /**
   * Get personalized message with agent context
   */
  getPersonalizedMessage(context: StatusMessageContext): string {
    const message = this.getStatusMessage(context);
    if (!message) return '';

    const agentProfile = AGENT_PROFILES[context.agentPhase];
    
    // Use variant if available and suitable
    if (message.variants && message.variants.length > 0) {
      const variantIndex = Math.floor(Math.random() * message.variants.length);
      return message.variants[variantIndex];
    }

    return message.message;
  }

  /**
   * Filter messages by context constraints
   */
  private filterMessagesByContext(context: StatusMessageContext): StatusMessageTemplate[] {
    return STATUS_MESSAGE_TEMPLATES.filter(msg => {
      // Must match agent phase
      if (msg.agentPhase !== context.agentPhase) return false;

      // Check project type compatibility
      if (msg.projectTypes && context.projectType) {
        if (!msg.projectTypes.includes(context.projectType)) return false;
      }

      // Check conditions
      if (msg.conditions) {
        const conditions = msg.conditions;
        
        if (conditions.minProgress !== undefined && context.sessionProgress < conditions.minProgress) {
          return false;
        }
        
        if (conditions.maxProgress !== undefined && context.sessionProgress > conditions.maxProgress) {
          return false;
        }
        
        if (conditions.minTimeInPhase !== undefined && context.timeInPhase !== undefined) {
          if (context.timeInPhase < conditions.minTimeInPhase) return false;
        }
        
        if (conditions.complexity && context.complexity) {
          if (!conditions.complexity.includes(context.complexity)) return false;
        }
        
        if (conditions.userPattern && context.userResponsePattern) {
          if (!conditions.userPattern.includes(context.userResponsePattern)) return false;
        }
      }

      return true;
    });
  }

  /**
   * Apply diversity filter to prevent message repetition
   */
  private applyDiversityFilter(messages: StatusMessageTemplate[], phase: AgentPhase): StatusMessageTemplate[] {
    const lastMessageTime = this.lastMessageTime.get(phase) || 0;
    const timeSinceLastMessage = Date.now() - lastMessageTime;
    
    // If enough time has passed, allow all messages
    if (timeSinceLastMessage > 60000) { // 1 minute
      return messages;
    }

    // Filter out recently used messages
    return messages.filter(msg => {
      const lastUsed = this.messageHistory.get(msg.id) || 0;
      return (Date.now() - lastUsed) > 30000; // 30 seconds minimum between same messages
    });
  }

  /**
   * Select message using weighted random selection
   */
  private selectWeightedRandom(messages: StatusMessageTemplate[]): StatusMessageTemplate | null {
    if (messages.length === 0) return null;
    if (messages.length === 1) return messages[0];

    const totalWeight = messages.reduce((sum, msg) => sum + msg.weight, 0);
    let random = Math.random() * totalWeight;

    for (const message of messages) {
      random -= message.weight;
      if (random <= 0) {
        // Track message usage
        this.messageHistory.set(message.id, Date.now());
        this.lastMessageTime.set(message.agentPhase, Date.now());
        return message;
      }
    }

    return messages[messages.length - 1];
  }

  /**
   * Get fallback message when no specific message is available
   */
  private getFallbackMessage(context: StatusMessageContext): StatusMessageTemplate {
    const agentProfile = AGENT_PROFILES[context.agentPhase];
    
    return {
      id: `${context.agentPhase.toLowerCase()}_fallback`,
      agentPhase: context.agentPhase,
      category: 'WORKING',
      message: `Your ${agentProfile.title} is working on your project requirements...`,
      duration: 3000,
      weight: 0.5
    };
  }

  /**
   * Get agent activity summary
   */
  getAgentActivitySummary(phase: AgentPhase): {
    title: string;
    expertise: string[];
    currentFocus: string;
    nextSteps: string;
  } {
    const profile = AGENT_PROFILES[phase];
    const activityMap = {
      ANALYST: {
        currentFocus: 'Market research and business requirements analysis',
        nextSteps: 'Handoff business insights to Project Manager'
      },
      PM: {
        currentFocus: 'Project scope definition and feature prioritization',
        nextSteps: 'Collaborate with UX Expert on user experience design'
      },
      UX_EXPERT: {
        currentFocus: 'User experience design and journey optimization',
        nextSteps: 'Share UX requirements with Technical Architect'
      },
      ARCHITECT: {
        currentFocus: 'Technical architecture and implementation planning',
        nextSteps: 'Complete final planning deliverables'
      }
    };

    return {
      title: profile.title,
      expertise: profile.expertise,
      ...activityMap[phase]
    };
  }

  /**
   * Clear message history (useful for testing or session reset)
   */
  clearHistory(): void {
    this.messageHistory.clear();
    this.lastMessageTime.clear();
  }

  /**
   * Get message statistics for debugging
   */
  getMessageStats(): {
    totalMessages: number;
    messagesByPhase: Record<AgentPhase, number>;
    messagesByCategory: Record<string, number>;
  } {
    const messagesByPhase = STATUS_MESSAGE_TEMPLATES.reduce((acc, msg) => {
      acc[msg.agentPhase] = (acc[msg.agentPhase] || 0) + 1;
      return acc;
    }, {} as Record<AgentPhase, number>);

    const messagesByCategory = STATUS_MESSAGE_TEMPLATES.reduce((acc, msg) => {
      acc[msg.category] = (acc[msg.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalMessages: STATUS_MESSAGE_TEMPLATES.length,
      messagesByPhase,
      messagesByCategory
    };
  }
}

// Export singleton instance
export const statusMessageLibrary = StatusMessageLibrary.getInstance();

// Export utility functions
export const getStatusMessage = (context: StatusMessageContext) => {
  return statusMessageLibrary.getStatusMessage(context);
};

export const getPersonalizedMessage = (context: StatusMessageContext) => {
  return statusMessageLibrary.getPersonalizedMessage(context);
};

export const getAgentProfile = (phase: AgentPhase) => {
  return AGENT_PROFILES[phase];
};

export const getTransitionMessage = (fromPhase: AgentPhase, toPhase: AgentPhase) => {
  return statusMessageLibrary.getTransitionMessage(fromPhase, toPhase);
};