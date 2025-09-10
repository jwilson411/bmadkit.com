import { EventEmitter } from 'events';
import { subscriptionValidator, UserSubscriptionContext } from './subscription-validator';
import { featureFlagManager, FeatureFlag, UserTier } from './feature-flag-manager';
import { customBrandingManager } from './custom-branding-manager';

export interface PremiumUserProfile {
  userId: string;
  tier: UserTier;
  subscriptionId?: string;
  organizationId?: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  
  // Premium status
  premiumSince?: Date;
  premiumFeatures: FeatureFlag[];
  usageLimits: {
    planningSessionsPerMonth: { limit: number; used: number; resetDate: Date };
    documentsPerMonth: { limit: number; used: number; resetDate: Date };
    storageGB: { limit: number; used: number };
    exportsPerMonth: { limit: number; used: number; resetDate: Date };
    apiCallsPerDay: { limit: number; used: number; resetDate: Date };
  };
  
  // Preferences
  preferences: {
    theme: 'light' | 'dark' | 'auto';
    language: string;
    timezone: string;
    notifications: {
      email: boolean;
      push: boolean;
      inApp: boolean;
      marketing: boolean;
    };
    dashboard: {
      layout: 'compact' | 'comfortable' | 'spacious';
      widgets: string[];
      defaultView: 'recent' | 'favorites' | 'all';
    };
    analysis: {
      defaultDepth: 'basic' | 'detailed' | 'comprehensive';
      autoSave: boolean;
      realTimeUpdates: boolean;
    };
  };
  
  // Customization
  customization: {
    brandingId?: string;
    customDashboardTitle?: string;
    customWelcomeMessage?: string;
    favoriteTemplates: string[];
    customQuickActions: Array<{
      label: string;
      action: string;
      icon: string;
    }>;
  };
  
  // Analytics
  analytics: {
    totalSessions: number;
    totalDocuments: number;
    favoriteFeatures: string[];
    averageSessionDuration: number;
    lastActiveDate: Date;
    onboardingCompleted: boolean;
    onboardingSteps: {
      [key: string]: { completed: boolean; completedAt?: Date };
    };
  };
  
  // Support & Assistance
  support: {
    priority: 'standard' | 'priority' | 'white-glove';
    dedicatedManager?: {
      name: string;
      email: string;
      phone?: string;
    };
    supportHistory: Array<{
      ticketId: string;
      subject: string;
      status: string;
      createdAt: Date;
      resolvedAt?: Date;
    }>;
  };
}

export interface PremiumExperience {
  welcomeMessage: string;
  dashboardLayout: 'premium' | 'enterprise';
  availableFeatures: FeatureFlag[];
  customizations: {
    branding?: any;
    theme?: string;
    layout?: string;
  };
  quickActions: Array<{
    label: string;
    description: string;
    action: string;
    icon: string;
    isPremium: boolean;
  }>;
  promotionalContent?: {
    title: string;
    description: string;
    ctaText: string;
    ctaUrl: string;
  };
}

export interface UserOnboardingFlow {
  userId: string;
  tier: UserTier;
  currentStep: number;
  totalSteps: number;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    component: string;
    completed: boolean;
    skippable: boolean;
    estimatedTime: string;
  }>;
  progress: number; // 0-100
  personalizations: {
    industry?: string;
    role?: string;
    teamSize?: string;
    primaryUseCase?: string;
    experience?: string;
  };
}

export interface FeatureDiscovery {
  userId: string;
  newFeatures: Array<{
    featureFlag: FeatureFlag;
    title: string;
    description: string;
    benefits: string[];
    howToUse: string;
    demoUrl?: string;
    isHighlighted: boolean;
  }>;
  recommendations: Array<{
    title: string;
    description: string;
    action: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

export interface PremiumInsights {
  userId: string;
  period: '7d' | '30d' | '90d';
  productivity: {
    documentsCreated: number;
    timesSaved: number; // estimated hours saved
    templatesUsed: number;
    favoriteFeatures: string[];
  };
  engagement: {
    sessionCount: number;
    averageSessionDuration: number;
    featureAdoption: Array<{
      feature: string;
      usage: number;
      trend: 'up' | 'down' | 'stable';
    }>;
  };
  recommendations: Array<{
    type: 'feature' | 'workflow' | 'template';
    title: string;
    description: string;
    potentialImpact: string;
    effort: 'low' | 'medium' | 'high';
  }>;
}

class PremiumUserExperience extends EventEmitter {
  private userProfiles: Map<string, PremiumUserProfile> = new Map();
  private onboardingFlows: Map<string, UserOnboardingFlow> = new Map();

  constructor() {
    super();
  }

  async getPremiumUserProfile(userId: string): Promise<PremiumUserProfile | null> {
    try {
      // Check cache first
      let profile = this.userProfiles.get(userId);
      
      if (!profile) {
        // Load from database
        profile = await this.loadUserProfile(userId);
        if (profile) {
          this.userProfiles.set(userId, profile);
        }
      }

      // Refresh subscription context
      if (profile) {
        const userContext = await subscriptionValidator.validateUserSubscription(userId);
        profile.tier = userContext.tier;
        profile.premiumFeatures = userContext.features;
        profile.usageLimits = this.formatUsageLimits(userContext.limits, userContext.usage);
      }

      return profile;

    } catch (error) {
      this.emit('profileError', { userId, error: error.message });
      return null;
    }
  }

  async createPremiumUserProfile(userId: string, initialData: Partial<PremiumUserProfile>): Promise<PremiumUserProfile> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      const profile: PremiumUserProfile = {
        userId,
        tier: userContext.tier,
        subscriptionId: userContext.subscriptionId,
        organizationId: userContext.organizationId,
        displayName: initialData.displayName || 'Premium User',
        email: initialData.email || '',
        premiumSince: userContext.tier !== UserTier.FREE ? new Date() : undefined,
        premiumFeatures: userContext.features,
        usageLimits: this.formatUsageLimits(userContext.limits, userContext.usage),
        ...this.getDefaultPreferences(),
        ...initialData,
        analytics: {
          totalSessions: 0,
          totalDocuments: 0,
          favoriteFeatures: [],
          averageSessionDuration: 0,
          lastActiveDate: new Date(),
          onboardingCompleted: false,
          onboardingSteps: {},
          ...initialData.analytics
        },
        support: this.getSupportConfiguration(userContext.tier)
      };

      await this.saveUserProfile(profile);
      this.userProfiles.set(userId, profile);

      this.emit('profileCreated', {
        userId,
        tier: profile.tier,
        organizationId: profile.organizationId
      });

      return profile;

    } catch (error) {
      this.emit('profileCreationError', { userId, error: error.message });
      throw error;
    }
  }

  async updateUserPreferences(userId: string, preferences: Partial<PremiumUserProfile['preferences']>): Promise<void> {
    try {
      const profile = await this.getPremiumUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      profile.preferences = {
        ...profile.preferences,
        ...preferences
      };

      await this.saveUserProfile(profile);
      this.userProfiles.set(userId, profile);

      this.emit('preferencesUpdated', {
        userId,
        preferences: Object.keys(preferences),
        tier: profile.tier
      });

    } catch (error) {
      this.emit('preferencesError', { userId, error: error.message });
      throw error;
    }
  }

  async getPremiumExperience(userId: string): Promise<PremiumExperience> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const profile = await this.getPremiumUserProfile(userId);

      const experience: PremiumExperience = {
        welcomeMessage: this.generateWelcomeMessage(userContext, profile),
        dashboardLayout: this.getDashboardLayout(userContext.tier),
        availableFeatures: userContext.features,
        customizations: await this.getCustomizations(profile),
        quickActions: this.getQuickActions(userContext, profile),
        promotionalContent: await this.getPromotionalContent(userContext)
      };

      this.emit('experienceLoaded', {
        userId,
        tier: userContext.tier,
        features: userContext.features.length
      });

      return experience;

    } catch (error) {
      this.emit('experienceError', { userId, error: error.message });
      throw error;
    }
  }

  async initializeUserOnboarding(userId: string): Promise<UserOnboardingFlow> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const profile = await this.getPremiumUserProfile(userId);

      if (profile?.analytics.onboardingCompleted) {
        throw new Error('Onboarding already completed');
      }

      const onboardingFlow: UserOnboardingFlow = {
        userId,
        tier: userContext.tier,
        currentStep: 0,
        totalSteps: 0,
        steps: this.getOnboardingSteps(userContext.tier),
        progress: 0,
        personalizations: {}
      };

      onboardingFlow.totalSteps = onboardingFlow.steps.length;
      
      this.onboardingFlows.set(userId, onboardingFlow);
      await this.saveOnboardingFlow(onboardingFlow);

      this.emit('onboardingInitialized', {
        userId,
        tier: userContext.tier,
        totalSteps: onboardingFlow.totalSteps
      });

      return onboardingFlow;

    } catch (error) {
      this.emit('onboardingError', { userId, error: error.message });
      throw error;
    }
  }

  async updateOnboardingProgress(userId: string, stepId: string, personalizations?: any): Promise<UserOnboardingFlow> {
    try {
      const flow = this.onboardingFlows.get(userId) || await this.loadOnboardingFlow(userId);
      if (!flow) {
        throw new Error('Onboarding flow not found');
      }

      // Update step completion
      const stepIndex = flow.steps.findIndex(step => step.id === stepId);
      if (stepIndex === -1) {
        throw new Error('Onboarding step not found');
      }

      flow.steps[stepIndex].completed = true;
      flow.currentStep = Math.max(flow.currentStep, stepIndex + 1);
      
      // Update personalizations
      if (personalizations) {
        flow.personalizations = { ...flow.personalizations, ...personalizations };
      }

      // Calculate progress
      const completedSteps = flow.steps.filter(step => step.completed).length;
      flow.progress = Math.round((completedSteps / flow.totalSteps) * 100);

      // Check if onboarding is complete
      if (flow.progress === 100) {
        await this.completeOnboarding(userId, flow);
      }

      await this.saveOnboardingFlow(flow);
      this.onboardingFlows.set(userId, flow);

      this.emit('onboardingProgress', {
        userId,
        stepId,
        progress: flow.progress,
        completed: flow.progress === 100
      });

      return flow;

    } catch (error) {
      this.emit('onboardingProgressError', { userId, stepId, error: error.message });
      throw error;
    }
  }

  async getFeatureDiscovery(userId: string): Promise<FeatureDiscovery> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const profile = await this.getPremiumUserProfile(userId);

      // Find new features user hasn't discovered yet
      const allFeatures = Object.values(FeatureFlag);
      const userFeatures = userContext.features;
      const discoveredFeatures = profile?.analytics.favoriteFeatures || [];

      const newFeatures = userFeatures
        .filter(feature => !discoveredFeatures.includes(feature))
        .map(feature => this.getFeatureInfo(feature))
        .filter(Boolean);

      const recommendations = await this.generateFeatureRecommendations(userId, userContext, profile);

      const discovery: FeatureDiscovery = {
        userId,
        newFeatures,
        recommendations
      };

      this.emit('featureDiscoveryGenerated', {
        userId,
        newFeatures: newFeatures.length,
        recommendations: recommendations.length
      });

      return discovery;

    } catch (error) {
      this.emit('featureDiscoveryError', { userId, error: error.message });
      throw error;
    }
  }

  async markFeatureAsDiscovered(userId: string, featureFlag: FeatureFlag): Promise<void> {
    try {
      const profile = await this.getPremiumUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      if (!profile.analytics.favoriteFeatures.includes(featureFlag)) {
        profile.analytics.favoriteFeatures.push(featureFlag);
        await this.saveUserProfile(profile);
        this.userProfiles.set(userId, profile);
      }

      this.emit('featureDiscovered', { userId, feature: featureFlag });

    } catch (error) {
      this.emit('featureDiscoveryMarkError', { userId, feature: featureFlag, error: error.message });
      throw error;
    }
  }

  async getPremiumInsights(userId: string, period: '7d' | '30d' | '90d' = '30d'): Promise<PremiumInsights> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      // Premium insights are only available to premium users
      if (!userContext.features.includes(FeatureFlag.PREMIUM_USER_SUPPORT)) {
        throw new Error('Premium insights require Premium subscription');
      }

      const insights = await this.calculatePremiumInsights(userId, period, userContext);

      this.emit('insightsGenerated', {
        userId,
        period,
        tier: userContext.tier
      });

      return insights;

    } catch (error) {
      this.emit('insightsError', { userId, error: error.message });
      throw error;
    }
  }

  async createSupportTicket(userId: string, subject: string, description: string, priority?: 'low' | 'medium' | 'high'): Promise<string> {
    try {
      const profile = await this.getPremiumUserProfile(userId);
      if (!profile) {
        throw new Error('User profile not found');
      }

      // Determine priority based on user tier
      let ticketPriority = priority || 'medium';
      if (profile.tier === UserTier.ENTERPRISE) {
        ticketPriority = 'high';
      } else if (profile.tier === UserTier.PREMIUM) {
        ticketPriority = priority || 'medium';
      }

      const ticketId = this.generateTicketId();
      const ticket = {
        ticketId,
        subject,
        status: 'open',
        createdAt: new Date()
      };

      profile.support.supportHistory.push(ticket);
      await this.saveUserProfile(profile);

      // Send to support system
      await this.createSupportTicketInSystem(userId, ticketId, subject, description, ticketPriority, profile.tier);

      this.emit('supportTicketCreated', {
        userId,
        ticketId,
        subject,
        priority: ticketPriority,
        tier: profile.tier
      });

      return ticketId;

    } catch (error) {
      this.emit('supportTicketError', { userId, error: error.message });
      throw error;
    }
  }

  // Private helper methods

  private formatUsageLimits(limits: any, usage: any): PremiumUserProfile['usageLimits'] {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    return {
      planningSessionsPerMonth: {
        limit: limits.planningSessionsPerMonth || -1,
        used: usage.planningSessionsPerMonth || 0,
        resetDate: nextMonth
      },
      documentsPerMonth: {
        limit: limits.documentsPerMonth || -1,
        used: usage.documentsPerMonth || 0,
        resetDate: nextMonth
      },
      storageGB: {
        limit: limits.storageGB || -1,
        used: usage.storageGB || 0
      },
      exportsPerMonth: {
        limit: limits.exportsPerMonth || -1,
        used: usage.exportsPerMonth || 0,
        resetDate: nextMonth
      },
      apiCallsPerDay: {
        limit: limits.apiCallsPerDay || -1,
        used: usage.apiCallsPerDay || 0,
        resetDate: tomorrow
      }
    };
  }

  private getDefaultPreferences(): { preferences: PremiumUserProfile['preferences']; customization: PremiumUserProfile['customization'] } {
    return {
      preferences: {
        theme: 'auto',
        language: 'en',
        timezone: 'UTC',
        notifications: {
          email: true,
          push: true,
          inApp: true,
          marketing: false
        },
        dashboard: {
          layout: 'comfortable',
          widgets: ['recent-sessions', 'quick-actions', 'usage-overview'],
          defaultView: 'recent'
        },
        analysis: {
          defaultDepth: 'detailed',
          autoSave: true,
          realTimeUpdates: true
        }
      },
      customization: {
        favoriteTemplates: [],
        customQuickActions: []
      }
    };
  }

  private getSupportConfiguration(tier: UserTier): PremiumUserProfile['support'] {
    const baseSupport: PremiumUserProfile['support'] = {
      priority: 'standard',
      supportHistory: []
    };

    if (tier === UserTier.PREMIUM) {
      baseSupport.priority = 'priority';
    } else if (tier === UserTier.ENTERPRISE) {
      baseSupport.priority = 'white-glove';
      baseSupport.dedicatedManager = {
        name: 'Enterprise Success Manager',
        email: 'enterprise@bmadkit.com'
      };
    }

    return baseSupport;
  }

  private generateWelcomeMessage(userContext: UserSubscriptionContext, profile: PremiumUserProfile | null): string {
    const displayName = profile?.displayName || 'there';
    
    if (userContext.tier === UserTier.ENTERPRISE) {
      return `Welcome back, ${displayName}! Your Enterprise workspace is ready with white-label capabilities and dedicated support.`;
    } else if (userContext.tier === UserTier.PREMIUM) {
      return `Welcome back, ${displayName}! Access your premium features and unlimited session history.`;
    } else if (userContext.tier === UserTier.EMAIL_CAPTURED) {
      return `Welcome back, ${displayName}! Ready to upgrade to Premium for unlimited access?`;
    } else {
      return `Welcome, ${displayName}! Discover what's possible with BMAD Kit.`;
    }
  }

  private getDashboardLayout(tier: UserTier): 'premium' | 'enterprise' {
    return tier === UserTier.ENTERPRISE ? 'enterprise' : 'premium';
  }

  private async getCustomizations(profile: PremiumUserProfile | null): Promise<any> {
    if (!profile?.customization.brandingId) {
      return {};
    }

    try {
      const branding = await customBrandingManager.getBrandingConfiguration(
        profile.customization.brandingId,
        profile.userId
      );
      
      return {
        branding,
        theme: profile.preferences.theme,
        layout: profile.preferences.dashboard.layout
      };
    } catch (error) {
      return {};
    }
  }

  private getQuickActions(userContext: UserSubscriptionContext, profile: PremiumUserProfile | null): PremiumExperience['quickActions'] {
    const baseActions = [
      {
        label: 'New Planning Session',
        description: 'Start a new project planning session',
        action: '/planning/new',
        icon: 'planning',
        isPremium: false
      },
      {
        label: 'Browse Templates',
        description: 'Explore document templates',
        action: '/templates',
        icon: 'templates',
        isPremium: false
      }
    ];

    const premiumActions = [
      {
        label: 'Advanced Planning',
        description: 'Access detailed planning sessions',
        action: '/planning/advanced',
        icon: 'advanced-planning',
        isPremium: true
      },
      {
        label: 'Session History',
        description: 'Browse unlimited session history',
        action: '/history',
        icon: 'history',
        isPremium: true
      },
      {
        label: 'Premium Templates',
        description: 'Access premium template library',
        action: '/templates/premium',
        icon: 'premium-templates',
        isPremium: true
      }
    ];

    const enterpriseActions = [
      {
        label: 'Custom Branding',
        description: 'Manage your brand customization',
        action: '/branding',
        icon: 'branding',
        isPremium: true
      },
      {
        label: 'White Label Settings',
        description: 'Configure white label platform',
        action: '/settings/white-label',
        icon: 'white-label',
        isPremium: true
      }
    ];

    let actions = [...baseActions];
    
    if (userContext.tier === UserTier.PREMIUM || userContext.tier === UserTier.ENTERPRISE) {
      actions = [...actions, ...premiumActions];
    }
    
    if (userContext.tier === UserTier.ENTERPRISE) {
      actions = [...actions, ...enterpriseActions];
    }

    // Add user's custom quick actions
    if (profile?.customization.customQuickActions) {
      actions = [...actions, ...profile.customization.customQuickActions.map(action => ({
        ...action,
        isPremium: true
      }))];
    }

    return actions;
  }

  private async getPromotionalContent(userContext: UserSubscriptionContext): Promise<PremiumExperience['promotionalContent'] | undefined> {
    if (userContext.tier === UserTier.FREE) {
      return {
        title: 'Unlock Premium Features',
        description: 'Get unlimited sessions, advanced templates, and priority support',
        ctaText: 'Upgrade to Premium',
        ctaUrl: '/upgrade'
      };
    } else if (userContext.tier === UserTier.EMAIL_CAPTURED) {
      return {
        title: 'Ready for Premium?',
        description: 'Unlock unlimited document generation and advanced planning',
        ctaText: 'Go Premium',
        ctaUrl: '/upgrade'
      };
    } else if (userContext.tier === UserTier.PREMIUM) {
      return {
        title: 'Enterprise Solutions Available',
        description: 'Custom branding, white-label platform, and dedicated support',
        ctaText: 'Explore Enterprise',
        ctaUrl: '/enterprise'
      };
    }

    return undefined;
  }

  private getOnboardingSteps(tier: UserTier): UserOnboardingFlow['steps'] {
    const baseSteps = [
      {
        id: 'welcome',
        title: 'Welcome to BMAD Kit',
        description: 'Learn about our platform and capabilities',
        component: 'WelcomeStep',
        completed: false,
        skippable: false,
        estimatedTime: '2 min'
      },
      {
        id: 'personalization',
        title: 'Personalize Your Experience',
        description: 'Tell us about your role and industry',
        component: 'PersonalizationStep',
        completed: false,
        skippable: true,
        estimatedTime: '3 min'
      },
      {
        id: 'first-session',
        title: 'Create Your First Session',
        description: 'Start your first planning session',
        component: 'FirstSessionStep',
        completed: false,
        skippable: false,
        estimatedTime: '5 min'
      }
    ];

    const premiumSteps = [
      {
        id: 'premium-features',
        title: 'Explore Premium Features',
        description: 'Discover advanced planning and templates',
        component: 'PremiumFeaturesStep',
        completed: false,
        skippable: true,
        estimatedTime: '4 min'
      },
      {
        id: 'preferences',
        title: 'Set Your Preferences',
        description: 'Customize your dashboard and notifications',
        component: 'PreferencesStep',
        completed: false,
        skippable: true,
        estimatedTime: '3 min'
      }
    ];

    const enterpriseSteps = [
      {
        id: 'organization-setup',
        title: 'Organization Setup',
        description: 'Configure your organization settings',
        component: 'OrganizationSetupStep',
        completed: false,
        skippable: false,
        estimatedTime: '5 min'
      },
      {
        id: 'branding-setup',
        title: 'Brand Customization',
        description: 'Set up your custom branding',
        component: 'BrandingSetupStep',
        completed: false,
        skippable: true,
        estimatedTime: '10 min'
      }
    ];

    let steps = [...baseSteps];
    
    if (tier === UserTier.PREMIUM || tier === UserTier.ENTERPRISE) {
      steps = [...steps, ...premiumSteps];
    }
    
    if (tier === UserTier.ENTERPRISE) {
      steps = [...steps, ...enterpriseSteps];
    }

    return steps;
  }

  private getFeatureInfo(feature: FeatureFlag): any {
    const featureInfoMap = {
      [FeatureFlag.ADVANCED_PLANNING_SESSIONS]: {
        featureFlag: feature,
        title: 'Advanced Planning Sessions',
        description: 'Access extended planning sessions with deeper analysis and more detailed questioning',
        benefits: ['Longer session duration', 'Advanced questioning', 'Detailed analysis'],
        howToUse: 'Start a new planning session and select "Advanced" mode',
        isHighlighted: true
      },
      [FeatureFlag.PREMIUM_TEMPLATE_LIBRARY]: {
        featureFlag: feature,
        title: 'Premium Template Library',
        description: 'Access comprehensive templates including architecture, implementation, and analysis documents',
        benefits: ['Technical architecture templates', 'Implementation roadmaps', 'Risk analysis templates'],
        howToUse: 'Browse the template library and look for premium templates',
        isHighlighted: true
      },
      [FeatureFlag.UNLIMITED_SESSION_HISTORY]: {
        featureFlag: feature,
        title: 'Unlimited Session History',
        description: 'Store and search through all your planning sessions with advanced search capabilities',
        benefits: ['Unlimited storage', 'Advanced search', 'Session categorization'],
        howToUse: 'Access your session history and use the search functionality',
        isHighlighted: false
      },
      [FeatureFlag.CUSTOM_BRANDING]: {
        featureFlag: feature,
        title: 'Custom Branding',
        description: 'Customize the platform with your company branding and white-label options',
        benefits: ['Custom logo and colors', 'Branded documents', 'White-label platform'],
        howToUse: 'Go to Settings > Branding to configure your brand',
        isHighlighted: true
      }
    };

    return featureInfoMap[feature] || null;
  }

  private async generateFeatureRecommendations(
    userId: string, 
    userContext: UserSubscriptionContext, 
    profile: PremiumUserProfile | null
  ): Promise<FeatureDiscovery['recommendations']> {
    const recommendations: FeatureDiscovery['recommendations'] = [];

    // Analyze user behavior and suggest relevant features
    if (profile && profile.analytics.totalSessions > 5 && !profile.analytics.favoriteFeatures.includes(FeatureFlag.UNLIMITED_SESSION_HISTORY)) {
      recommendations.push({
        title: 'Organize Your Sessions',
        description: 'You have many sessions. Try our advanced search and categorization features.',
        action: 'explore-history',
        reason: 'Based on your session count',
        priority: 'high'
      });
    }

    if (userContext.tier === UserTier.PREMIUM && profile?.analytics.totalDocuments > 10) {
      recommendations.push({
        title: 'Try Premium Templates',
        description: 'Access advanced templates for technical architecture and implementation planning.',
        action: 'explore-premium-templates',
        reason: 'Based on your document creation activity',
        priority: 'medium'
      });
    }

    return recommendations;
  }

  private async calculatePremiumInsights(userId: string, period: string, userContext: UserSubscriptionContext): Promise<PremiumInsights> {
    // This would query your analytics database
    return {
      userId,
      period: period as any,
      productivity: {
        documentsCreated: 0,
        timesSaved: 0,
        templatesUsed: 0,
        favoriteFeatures: []
      },
      engagement: {
        sessionCount: 0,
        averageSessionDuration: 0,
        featureAdoption: []
      },
      recommendations: []
    };
  }

  private async completeOnboarding(userId: string, flow: UserOnboardingFlow): Promise<void> {
    const profile = await this.getPremiumUserProfile(userId);
    if (profile) {
      profile.analytics.onboardingCompleted = true;
      profile.analytics.onboardingSteps = flow.steps.reduce((acc, step) => {
        acc[step.id] = { completed: true, completedAt: new Date() };
        return acc;
      }, {} as any);
      
      // Apply personalizations from onboarding
      if (flow.personalizations.industry) {
        profile.customization.favoriteTemplates = this.getRecommendedTemplates(flow.personalizations.industry);
      }

      await this.saveUserProfile(profile);
      this.userProfiles.set(userId, profile);
    }

    this.emit('onboardingCompleted', {
      userId,
      tier: flow.tier,
      personalizations: flow.personalizations
    });
  }

  private getRecommendedTemplates(industry: string): string[] {
    const templateMap: Record<string, string[]> = {
      'technology': ['technical-architecture', 'implementation-roadmap', 'api-documentation'],
      'healthcare': ['compliance-analysis', 'risk-assessment', 'project-brief'],
      'finance': ['risk-analysis', 'competitive-analysis', 'implementation-roadmap'],
      'retail': ['competitive-analysis', 'project-brief', 'user-stories']
    };

    return templateMap[industry] || ['project-brief', 'user-stories'];
  }

  private generateTicketId(): string {
    return `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  // Database operations (would be implemented with your chosen database)
  private async loadUserProfile(userId: string): Promise<PremiumUserProfile | null> {
    // Load from database
    return null;
  }

  private async saveUserProfile(profile: PremiumUserProfile): Promise<void> {
    // Save to database
  }

  private async loadOnboardingFlow(userId: string): Promise<UserOnboardingFlow | null> {
    // Load from database
    return null;
  }

  private async saveOnboardingFlow(flow: UserOnboardingFlow): Promise<void> {
    // Save to database
  }

  private async createSupportTicketInSystem(
    userId: string,
    ticketId: string,
    subject: string,
    description: string,
    priority: string,
    tier: UserTier
  ): Promise<void> {
    // Create ticket in support system (Zendesk, Intercom, etc.)
  }
}

export const premiumUserExperience = new PremiumUserExperience();