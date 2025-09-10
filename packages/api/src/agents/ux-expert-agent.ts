import { BaseAgent, BaseAgentConfig } from './base-agent';
import { WorkflowContext } from '../models/workflow-models';
import { logger } from '../utils/logger';

export interface UXExpertAgentConfig extends Omit<BaseAgentConfig, 'agentPhase'> {
  designApproach?: 'user-centered' | 'design-thinking' | 'lean-ux' | 'atomic-design';
  fidelityLevel?: 'low' | 'medium' | 'high';
  focusAreas?: string[];
  accessibilityLevel?: 'basic' | 'wcag-aa' | 'wcag-aaa';
  responsiveDesign?: boolean;
}

export interface UserExperienceResult {
  designStrategy: {
    designPrinciples: string[];
    userCenteredApproach: string;
    designSystem: {
      colorPalette: string[];
      typography: string[];
      spacing: string[];
      components: string[];
    };
    accessibilityGuidelines: string[];
  };
  userJourneys: Array<{
    name: string;
    description: string;
    steps: Array<{
      step: number;
      action: string;
      touchpoint: string;
      emotions: string[];
      painPoints: string[];
    }>;
    criticalPath: boolean;
  }>;
  wireframes: Array<{
    screenName: string;
    screenType: 'landing' | 'dashboard' | 'form' | 'detail' | 'list' | 'modal';
    layout: {
      header: string[];
      navigation: string[];
      content: string[];
      sidebar?: string[];
      footer: string[];
    };
    interactions: string[];
    responsiveConsiderations: string[];
  }>;
  informationArchitecture: {
    siteMap: Array<{
      section: string;
      pages: string[];
      priority: 'high' | 'medium' | 'low';
    }>;
    navigationStructure: {
      primary: string[];
      secondary: string[];
      utility: string[];
    };
    contentStrategy: string[];
  };
  usabilityRecommendations: {
    generalPrinciples: string[];
    specificRecommendations: Array<{
      area: string;
      recommendation: string;
      impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
    }>;
    testingStrategy: string[];
  };
  recommendations: string[];
  confidence: number;
}

/**
 * UX Expert Agent
 * 
 * Specializes in user experience design, interface planning, and usability optimization.
 * Focuses on creating intuitive, accessible, and user-friendly designs.
 */
export class UXExpertAgent extends BaseAgent {
  private uxConfig: UXExpertAgentConfig;

  constructor(config: Partial<UXExpertAgentConfig> = {}) {
    const baseConfig: BaseAgentConfig = {
      agentPhase: 'UX_EXPERT',
      enableMetrics: true,
      maxInteractions: 25,
      interactionTimeout: 300000, // 5 minutes
      enableContextValidation: true,
      enableResponseValidation: true,
      ...config
    };

    super(baseConfig);

    this.uxConfig = {
      designApproach: 'user-centered',
      fidelityLevel: 'medium',
      focusAreas: ['usability', 'accessibility', 'user journey', 'information architecture'],
      accessibilityLevel: 'wcag-aa',
      responsiveDesign: true,
      ...config
    };

    logger.debug('UX Expert agent initialized', {
      designApproach: this.uxConfig.designApproach,
      fidelityLevel: this.uxConfig.fidelityLevel,
      accessibilityLevel: this.uxConfig.accessibilityLevel
    });
  }

  protected async validateContext(context: WorkflowContext): Promise<void> {
    if (!context.projectInput) {
      throw new Error('Project input is required for UX design');
    }

    // Check for PM analysis from previous phase
    if (!context.projectScope && !this.hasProjectScopeContext(context)) {
      throw new Error('Project scope context is required for UX design phase');
    }

    // Validate that we have user stories or feature definitions
    if (!this.hasUserDefinedFeatures(context)) {
      logger.warn('Limited feature definition for UX design - will work with available context');
    }
  }

  protected async validateOutput(output: Record<string, any>): Promise<void> {
    const userExperience = output.userExperience as UserExperienceResult;
    
    if (!userExperience) {
      throw new Error('User experience result is required');
    }

    if (!userExperience.designStrategy || !userExperience.userJourneys || !userExperience.wireframes) {
      throw new Error('Incomplete UX design - missing core components');
    }

    if (userExperience.userJourneys.length === 0) {
      throw new Error('At least one user journey is required');
    }

    if (userExperience.wireframes.length === 0) {
      throw new Error('At least one wireframe is required');
    }

    if (userExperience.confidence < 0.6) {
      logger.warn('Low confidence in UX design results', {
        confidence: userExperience.confidence
      });
    }
  }

  protected async executeAgentLogic(
    executionId: string,
    context: WorkflowContext,
    userInput?: string
  ): Promise<Record<string, any>> {
    
    logger.info('Starting UX design analysis', {
      executionId,
      designApproach: this.uxConfig.designApproach,
      hasProjectScope: !!context.projectScope
    });

    // Phase 1: Design Strategy and Principles
    const designStrategy = await this.defineDesignStrategy(context);

    // Phase 2: User Journey Mapping
    const userJourneys = await this.createUserJourneys(context, designStrategy);

    // Phase 3: Information Architecture
    const informationArchitecture = await this.defineInformationArchitecture(context, userJourneys);

    // Phase 4: Wireframing
    const wireframes = await this.createWireframes(context, userJourneys, informationArchitecture);

    // Phase 5: Usability Recommendations
    const usabilityRecommendations = await this.generateUsabilityRecommendations(
      context,
      designStrategy,
      userJourneys,
      wireframes
    );

    // Phase 6: Generate UX Recommendations
    const recommendations = await this.generateUXRecommendations(
      designStrategy,
      userJourneys,
      informationArchitecture,
      wireframes,
      usabilityRecommendations
    );

    // Compile user experience result
    const userExperience: UserExperienceResult = {
      designStrategy,
      userJourneys,
      wireframes,
      informationArchitecture,
      usabilityRecommendations,
      recommendations,
      confidence: this.calculateUXConfidence(
        designStrategy,
        userJourneys,
        wireframes,
        informationArchitecture,
        usabilityRecommendations
      )
    };

    // Generate UX artifacts
    this.generateUXArtifacts(userExperience);

    // Provide summary
    await this.provideSummary(this.generateUXSummary(userExperience));

    return {
      userExperience,
      uxMetadata: {
        designApproach: this.uxConfig.designApproach,
        fidelityLevel: this.uxConfig.fidelityLevel,
        accessibilityLevel: this.uxConfig.accessibilityLevel,
        responsiveDesign: this.uxConfig.responsiveDesign,
        completedAt: new Date(),
        executionId
      }
    };
  }

  private async defineDesignStrategy(context: WorkflowContext): Promise<UserExperienceResult['designStrategy']> {
    await this.createInteraction(
      'QUESTION',
      'I\'ll now focus on creating an exceptional user experience based on the project scope and user stories.',
      undefined,
      { phase: 'design-strategy' }
    );

    const designPreferencesQuestion = `What kind of user experience are you envisioning? Modern and minimal, rich and interactive, or professional and clean?`;
    const designPreferencesResponse = await this.askQuestion(designPreferencesQuestion, {
      phase: 'design-strategy',
      analysisType: 'design-preferences'
    });

    const targetDevicesQuestion = `What devices/platforms should we prioritize? Desktop, mobile, tablet, or all?`;
    const targetDevicesResponse = await this.askQuestion(targetDevicesQuestion, {
      phase: 'design-strategy',
      analysisType: 'target-devices'
    });

    const accessibilityQuestion = `How important is accessibility? Should we follow WCAG AA standards?`;
    const accessibilityResponse = await this.askQuestion(accessibilityQuestion, {
      phase: 'design-strategy',
      analysisType: 'accessibility-requirements'
    });

    return {
      designPrinciples: this.defineDesignPrinciples(designPreferencesResponse, context),
      userCenteredApproach: this.defineUserCenteredApproach(context),
      designSystem: this.createDesignSystem(designPreferencesResponse, targetDevicesResponse),
      accessibilityGuidelines: this.defineAccessibilityGuidelines(accessibilityResponse)
    };
  }

  private async createUserJourneys(
    context: WorkflowContext,
    designStrategy: UserExperienceResult['designStrategy']
  ): Promise<UserExperienceResult['userJourneys']> {
    
    const userJourneysQuestion = `Based on the user stories, what are the main user journeys? What are users trying to accomplish?`;
    const userJourneysResponse = await this.askQuestion(userJourneysQuestion, {
      phase: 'user-journey-mapping',
      analysisType: 'journey-identification'
    });

    const painPointsQuestion = `Where do you anticipate users might struggle or get confused?`;
    const painPointsResponse = await this.askQuestion(painPointsQuestion, {
      phase: 'user-journey-mapping',
      analysisType: 'pain-point-analysis'
    });

    return this.mapUserJourneys(context, userJourneysResponse, painPointsResponse);
  }

  private async defineInformationArchitecture(
    context: WorkflowContext,
    userJourneys: UserExperienceResult['userJourneys']
  ): Promise<UserExperienceResult['informationArchitecture']> {
    
    await this.createInteraction(
      'QUESTION',
      'Now I\'ll organize the information architecture to support the user journeys.',
      undefined,
      { phase: 'information-architecture' }
    );

    const contentQuestion = `What main sections or categories of content will users need to access?`;
    const contentResponse = await this.askQuestion(contentQuestion, {
      phase: 'information-architecture',
      analysisType: 'content-organization'
    });

    return {
      siteMap: this.createSiteMap(context, contentResponse, userJourneys),
      navigationStructure: this.defineNavigationStructure(contentResponse, userJourneys),
      contentStrategy: this.defineContentStrategy(context, contentResponse)
    };
  }

  private async createWireframes(
    context: WorkflowContext,
    userJourneys: UserExperienceResult['userJourneys'],
    informationArchitecture: UserExperienceResult['informationArchitecture']
  ): Promise<UserExperienceResult['wireframes']> {
    
    const wireframeQuestion = `What are the most important screens users will interact with?`;
    const wireframeResponse = await this.askQuestion(wireframeQuestion, {
      phase: 'wireframing',
      analysisType: 'key-screens-identification'
    });

    return this.generateWireframes(context, wireframeResponse, userJourneys, informationArchitecture);
  }

  private async generateUsabilityRecommendations(
    context: WorkflowContext,
    designStrategy: UserExperienceResult['designStrategy'],
    userJourneys: UserExperienceResult['userJourneys'],
    wireframes: UserExperienceResult['wireframes']
  ): Promise<UserExperienceResult['usabilityRecommendations']> {
    
    await this.createInteraction(
      'QUESTION',
      'Let me analyze the design for usability opportunities and potential issues.',
      undefined,
      { phase: 'usability-analysis' }
    );

    return {
      generalPrinciples: this.defineUsabilityPrinciples(),
      specificRecommendations: this.generateSpecificRecommendations(
        context,
        designStrategy,
        userJourneys,
        wireframes
      ),
      testingStrategy: this.defineTestingStrategy(userJourneys, wireframes)
    };
  }

  private async generateUXRecommendations(
    designStrategy: UserExperienceResult['designStrategy'],
    userJourneys: UserExperienceResult['userJourneys'],
    informationArchitecture: UserExperienceResult['informationArchitecture'],
    wireframes: UserExperienceResult['wireframes'],
    usabilityRecommendations: UserExperienceResult['usabilityRecommendations']
  ): Promise<string[]> {
    
    const recommendations: string[] = [];

    // Design strategy recommendations
    if (designStrategy.designPrinciples.length > 6) {
      recommendations.push('Focus on 3-4 core design principles to maintain consistency');
    }

    // User journey recommendations
    const criticalJourneys = userJourneys.filter(j => j.criticalPath);
    if (criticalJourneys.length > 3) {
      recommendations.push('Prioritize optimization of the most critical user journeys first');
    }

    // Information architecture recommendations
    if (informationArchitecture.siteMap.length > 8) {
      recommendations.push('Consider consolidating content sections for simpler navigation');
    }

    // Wireframe recommendations
    const complexScreens = wireframes.filter(w => w.layout.content.length > 6);
    if (complexScreens.length > 0) {
      recommendations.push('Simplify complex screens to reduce cognitive load');
    }

    // General UX recommendations
    recommendations.push('Implement progressive disclosure for complex workflows');
    recommendations.push('Ensure consistent interaction patterns across all screens');
    recommendations.push('Plan for empty states and error handling in all interfaces');
    recommendations.push('Conduct usability testing with real users before development');

    return recommendations;
  }

  private generateUXArtifacts(userExperience: UserExperienceResult): void {
    // Generate UX Strategy Document
    this.generateArtifact(
      'ux-strategy',
      'UX Design Strategy',
      {
        designPrinciples: userExperience.designStrategy.designPrinciples,
        userCenteredApproach: userExperience.designStrategy.userCenteredApproach,
        designSystem: userExperience.designStrategy.designSystem,
        accessibilityGuidelines: userExperience.designStrategy.accessibilityGuidelines,
        confidenceLevel: userExperience.confidence
      },
      'Comprehensive UX strategy and design principles'
    );

    // Generate User Journey Maps
    this.generateArtifact(
      'user-journey-maps',
      'User Journey Maps',
      {
        totalJourneys: userExperience.userJourneys.length,
        criticalJourneys: userExperience.userJourneys.filter(j => j.criticalPath).length,
        userJourneys: userExperience.userJourneys,
        keyPainPoints: this.extractPainPoints(userExperience.userJourneys)
      },
      'Detailed user journey maps with pain points and opportunities'
    );

    // Generate Wireframe Collection
    this.generateArtifact(
      'wireframe-collection',
      'Wireframe Collection',
      {
        totalScreens: userExperience.wireframes.length,
        screenTypes: this.getScreenTypes(userExperience.wireframes),
        wireframes: userExperience.wireframes,
        responsiveConsiderations: userExperience.wireframes.flatMap(w => w.responsiveConsiderations)
      },
      'Complete wireframe collection with responsive design considerations'
    );

    // Generate Information Architecture
    this.generateArtifact(
      'information-architecture',
      'Information Architecture & Site Map',
      {
        siteMap: userExperience.informationArchitecture.siteMap,
        navigationStructure: userExperience.informationArchitecture.navigationStructure,
        contentStrategy: userExperience.informationArchitecture.contentStrategy,
        totalPages: userExperience.informationArchitecture.siteMap.reduce((sum, section) => sum + section.pages.length, 0)
      },
      'Comprehensive information architecture and navigation structure'
    );

    // Generate Usability Report
    this.generateArtifact(
      'usability-report',
      'Usability Analysis & Recommendations',
      {
        generalPrinciples: userExperience.usabilityRecommendations.generalPrinciples,
        specificRecommendations: userExperience.usabilityRecommendations.specificRecommendations,
        testingStrategy: userExperience.usabilityRecommendations.testingStrategy,
        highImpactRecommendations: userExperience.usabilityRecommendations.specificRecommendations
          .filter(r => r.impact === 'high')
      },
      'Usability analysis with actionable recommendations and testing strategy'
    );
  }

  private generateUXSummary(userExperience: UserExperienceResult): string {
    return `
UX Design Analysis Complete!

Design Strategy:
• Design Principles: ${userExperience.designStrategy.designPrinciples.length} defined
• Design System: Colors, typography, and components specified
• Accessibility: ${userExperience.designStrategy.accessibilityGuidelines.length} guidelines established

User Experience:
• User Journeys: ${userExperience.userJourneys.length} mapped (${userExperience.userJourneys.filter(j => j.criticalPath).length} critical)
• Wireframes: ${userExperience.wireframes.length} screens designed
• Information Architecture: ${userExperience.informationArchitecture.siteMap.length} main sections organized

Usability Focus:
• General Principles: ${userExperience.usabilityRecommendations.generalPrinciples.length} established
• Specific Recommendations: ${userExperience.usabilityRecommendations.specificRecommendations.length} identified
• High Impact Items: ${userExperience.usabilityRecommendations.specificRecommendations.filter(r => r.impact === 'high').length}

Confidence Level: ${Math.round(userExperience.confidence * 100)}%

Top Recommendations:
${userExperience.recommendations.slice(0, 3).map(r => `• ${r}`).join('\n')}

Ready to proceed to Technical Architecture phase.
    `.trim();
  }

  // Helper methods
  private hasProjectScopeContext(context: WorkflowContext): boolean {
    return !!(context.projectScope || 
             context.userStories || 
             context.featurePrioritization ||
             (context.enrichments && context.enrichments.some(e => e.agentPhase === 'PM')));
  }

  private hasUserDefinedFeatures(context: WorkflowContext): boolean {
    return !!(context.projectScope?.featurePrioritization || 
             context.userStories || 
             context.featurePrioritization);
  }

  private defineDesignPrinciples(designPreferencesResponse: string, context: WorkflowContext): string[] {
    const principles = ['User-centered design', 'Consistency', 'Simplicity'];
    
    if (designPreferencesResponse.toLowerCase().includes('modern')) {
      principles.push('Modern aesthetics', 'Clean interfaces');
    }
    
    if (designPreferencesResponse.toLowerCase().includes('interactive')) {
      principles.push('Engaging interactions', 'Responsive feedback');
    }
    
    if (designPreferencesResponse.toLowerCase().includes('professional')) {
      principles.push('Professional appearance', 'Trustworthy design');
    }
    
    // Add accessibility principle if mentioned
    principles.push('Accessibility first');
    
    return principles;
  }

  private defineUserCenteredApproach(context: WorkflowContext): string {
    let approach = `${this.uxConfig.designApproach} methodology focusing on user needs and business objectives`;
    
    if (context.businessAnalysis?.userNeeds) {
      approach += '. Design decisions will be validated against identified user needs from business analysis.';
    }
    
    return approach;
  }

  private createDesignSystem(designPreferencesResponse: string, targetDevicesResponse: string): UserExperienceResult['designStrategy']['designSystem'] {
    return {
      colorPalette: this.generateColorPalette(designPreferencesResponse),
      typography: this.generateTypography(designPreferencesResponse, targetDevicesResponse),
      spacing: ['4px', '8px', '16px', '24px', '32px', '48px', '64px'],
      components: [
        'Button',
        'Input Field',
        'Card',
        'Modal',
        'Navigation',
        'Form',
        'Table',
        'Loading States'
      ]
    };
  }

  private generateColorPalette(designPreferencesResponse: string): string[] {
    if (designPreferencesResponse.toLowerCase().includes('modern')) {
      return ['#2563EB', '#F8FAFC', '#1E293B', '#64748B', '#10B981', '#EF4444'];
    }
    
    if (designPreferencesResponse.toLowerCase().includes('professional')) {
      return ['#1F2937', '#F9FAFB', '#374151', '#6B7280', '#059669', '#DC2626'];
    }
    
    return ['#3B82F6', '#FFFFFF', '#111827', '#6B7280', '#10B981', '#EF4444'];
  }

  private generateTypography(designPreferencesResponse: string, targetDevicesResponse: string): string[] {
    const typography = ['Inter', 'Roboto', 'System Font Stack'];
    
    if (targetDevicesResponse.toLowerCase().includes('mobile')) {
      typography.push('Mobile-optimized sizes', 'Touch-friendly spacing');
    }
    
    return typography;
  }

  private defineAccessibilityGuidelines(accessibilityResponse: string): string[] {
    const guidelines = [
      'WCAG 2.1 AA compliance',
      'Keyboard navigation support',
      'Screen reader compatibility',
      'Color contrast requirements (4.5:1 minimum)'
    ];
    
    if (accessibilityResponse.toLowerCase().includes('aaa') || 
        accessibilityResponse.toLowerCase().includes('advanced')) {
      guidelines.push('WCAG 2.1 AAA compliance where possible');
    }
    
    guidelines.push('Focus indicators', 'Alt text for images', 'Semantic HTML structure');
    
    return guidelines;
  }

  private mapUserJourneys(
    context: WorkflowContext,
    userJourneysResponse: string,
    painPointsResponse: string
  ): UserExperienceResult['userJourneys'] {
    
    const journeys: UserExperienceResult['userJourneys'] = [];
    
    // Primary user journey
    journeys.push({
      name: 'Primary User Flow',
      description: 'Main user workflow from entry to goal completion',
      steps: [
        {
          step: 1,
          action: 'Land on homepage',
          touchpoint: 'Web/Mobile',
          emotions: ['curious', 'interested'],
          painPoints: this.extractPainPointsFromResponse(painPointsResponse, 'entry')
        },
        {
          step: 2,
          action: 'Explore features',
          touchpoint: 'Navigation/Content',
          emotions: ['engaged', 'learning'],
          painPoints: this.extractPainPointsFromResponse(painPointsResponse, 'exploration')
        },
        {
          step: 3,
          action: 'Complete primary action',
          touchpoint: 'Forms/Interactive elements',
          emotions: ['focused', 'determined'],
          painPoints: this.extractPainPointsFromResponse(painPointsResponse, 'action')
        },
        {
          step: 4,
          action: 'Receive confirmation',
          touchpoint: 'Success page/Notification',
          emotions: ['satisfied', 'accomplished'],
          painPoints: []
        }
      ],
      criticalPath: true
    });

    // Secondary user journey
    journeys.push({
      name: 'User Management Flow',
      description: 'User account creation and management workflow',
      steps: [
        {
          step: 1,
          action: 'Access account features',
          touchpoint: 'Authentication',
          emotions: ['cautious', 'hopeful'],
          painPoints: this.extractPainPointsFromResponse(painPointsResponse, 'authentication')
        },
        {
          step: 2,
          action: 'Manage account settings',
          touchpoint: 'Settings interface',
          emotions: ['in-control', 'confident'],
          painPoints: []
        }
      ],
      criticalPath: false
    });

    return journeys;
  }

  private extractPainPointsFromResponse(painPointsResponse: string, context: string): string[] {
    const painPoints = painPointsResponse.toLowerCase();
    const contextualPainPoints: string[] = [];
    
    if (painPoints.includes('confusing') || painPoints.includes('unclear')) {
      contextualPainPoints.push('Unclear navigation or content');
    }
    
    if (painPoints.includes('slow') || painPoints.includes('loading')) {
      contextualPainPoints.push('Performance concerns');
    }
    
    if (painPoints.includes('complex') || painPoints.includes('complicated')) {
      contextualPainPoints.push('Overly complex workflow');
    }
    
    return contextualPainPoints;
  }

  private createSiteMap(
    context: WorkflowContext,
    contentResponse: string,
    userJourneys: UserExperienceResult['userJourneys']
  ): UserExperienceResult['informationArchitecture']['siteMap'] {
    
    const siteMap: UserExperienceResult['informationArchitecture']['siteMap'] = [
      {
        section: 'Home',
        pages: ['Homepage', 'About'],
        priority: 'high'
      },
      {
        section: 'Core Features',
        pages: this.extractCoreFeaturePages(context, contentResponse),
        priority: 'high'
      },
      {
        section: 'User Account',
        pages: ['Profile', 'Settings', 'Dashboard'],
        priority: 'medium'
      },
      {
        section: 'Support',
        pages: ['Help', 'FAQ', 'Contact'],
        priority: 'low'
      }
    ];

    return siteMap;
  }

  private extractCoreFeaturePages(context: WorkflowContext, contentResponse: string): string[] {
    const pages = ['Main Dashboard'];
    
    if (context.projectScope?.featurePrioritization) {
      const mustHaveFeatures = context.projectScope.featurePrioritization.mvpFeatures
        .filter(f => f.priority === 'must-have')
        .map(f => f.name);
      pages.push(...mustHaveFeatures.slice(0, 4));
    } else {
      // Default core pages
      pages.push('Feature 1', 'Feature 2', 'Feature 3');
    }
    
    return pages;
  }

  private defineNavigationStructure(
    contentResponse: string,
    userJourneys: UserExperienceResult['userJourneys']
  ): UserExperienceResult['informationArchitecture']['navigationStructure'] {
    
    return {
      primary: ['Home', 'Features', 'Dashboard', 'About'],
      secondary: ['Settings', 'Profile', 'Help'],
      utility: ['Login', 'Sign Up', 'Search', 'Notifications']
    };
  }

  private defineContentStrategy(context: WorkflowContext, contentResponse: string): string[] {
    return [
      'Clear value proposition on homepage',
      'Progressive disclosure of complex information',
      'Consistent tone and voice throughout',
      'Scannable content with headings and bullet points',
      'Action-oriented language for CTAs',
      'Error messages that guide users to solutions'
    ];
  }

  private generateWireframes(
    context: WorkflowContext,
    wireframeResponse: string,
    userJourneys: UserExperienceResult['userJourneys'],
    informationArchitecture: UserExperienceResult['informationArchitecture']
  ): UserExperienceResult['wireframes'] {
    
    const wireframes: UserExperienceResult['wireframes'] = [];

    // Homepage wireframe
    wireframes.push({
      screenName: 'Homepage',
      screenType: 'landing',
      layout: {
        header: ['Logo', 'Navigation menu', 'CTA button'],
        navigation: ['Primary navigation', 'Search'],
        content: ['Hero section', 'Feature highlights', 'Value proposition', 'Social proof'],
        footer: ['Links', 'Contact info', 'Legal']
      },
      interactions: ['Navigation clicks', 'CTA clicks', 'Scroll interactions'],
      responsiveConsiderations: ['Mobile hamburger menu', 'Responsive grid', 'Touch-friendly buttons']
    });

    // Dashboard wireframe
    wireframes.push({
      screenName: 'Dashboard',
      screenType: 'dashboard',
      layout: {
        header: ['Logo', 'User menu', 'Notifications'],
        navigation: ['Side navigation', 'Breadcrumbs'],
        content: ['Key metrics', 'Recent activity', 'Quick actions'],
        sidebar: ['Filters', 'Secondary actions'],
        footer: ['Status bar', 'Help link']
      },
      interactions: ['Data filtering', 'Quick actions', 'Navigation'],
      responsiveConsiderations: ['Collapsible sidebar', 'Responsive data tables', 'Touch gestures']
    });

    // Form wireframe (if forms are mentioned)
    if (wireframeResponse.toLowerCase().includes('form') || 
        context.projectScope?.userStories?.some(s => s.story.toLowerCase().includes('form'))) {
      wireframes.push({
        screenName: 'Primary Form',
        screenType: 'form',
        layout: {
          header: ['Logo', 'Progress indicator'],
          navigation: ['Back button', 'Save draft'],
          content: ['Form fields', 'Help text', 'Validation messages', 'Submit button']
        },
        interactions: ['Field validation', 'Form submission', 'Auto-save'],
        responsiveConsiderations: ['Single column on mobile', 'Large touch targets', 'Keyboard optimization']
      });
    }

    return wireframes;
  }

  private defineUsabilityPrinciples(): string[] {
    return [
      'Visibility of system status',
      'Match between system and real world',
      'User control and freedom',
      'Consistency and standards',
      'Error prevention',
      'Recognition rather than recall',
      'Flexibility and efficiency of use',
      'Aesthetic and minimalist design',
      'Help users recognize, diagnose, and recover from errors',
      'Help and documentation'
    ];
  }

  private generateSpecificRecommendations(
    context: WorkflowContext,
    designStrategy: UserExperienceResult['designStrategy'],
    userJourneys: UserExperienceResult['userJourneys'],
    wireframes: UserExperienceResult['wireframes']
  ): UserExperienceResult['usabilityRecommendations']['specificRecommendations'] {
    
    const recommendations: UserExperienceResult['usabilityRecommendations']['specificRecommendations'] = [];

    // Navigation recommendations
    recommendations.push({
      area: 'Navigation',
      recommendation: 'Implement breadcrumb navigation for complex hierarchies',
      impact: 'medium',
      effort: 'low'
    });

    // Form recommendations
    const hasComplexForms = wireframes.some(w => w.screenType === 'form');
    if (hasComplexForms) {
      recommendations.push({
        area: 'Forms',
        recommendation: 'Use inline validation to provide immediate feedback',
        impact: 'high',
        effort: 'medium'
      });
    }

    // Mobile recommendations
    if (this.uxConfig.responsiveDesign) {
      recommendations.push({
        area: 'Mobile Experience',
        recommendation: 'Implement thumb-friendly navigation zones',
        impact: 'high',
        effort: 'medium'
      });
    }

    // Performance recommendations
    recommendations.push({
      area: 'Performance',
      recommendation: 'Implement skeleton loading states for better perceived performance',
      impact: 'medium',
      effort: 'medium'
    });

    // Accessibility recommendations
    recommendations.push({
      area: 'Accessibility',
      recommendation: 'Ensure all interactive elements are keyboard accessible',
      impact: 'high',
      effort: 'low'
    });

    return recommendations;
  }

  private defineTestingStrategy(
    userJourneys: UserExperienceResult['userJourneys'],
    wireframes: UserExperienceResult['wireframes']
  ): string[] {
    
    const testingStrategy = [
      'Conduct moderated usability testing with 5-8 users',
      'Perform unmoderated remote testing for broader reach',
      'A/B test critical conversion flows',
      'Accessibility audit with automated and manual testing'
    ];

    // Add journey-specific testing
    const criticalJourneys = userJourneys.filter(j => j.criticalPath);
    if (criticalJourneys.length > 0) {
      testingStrategy.push('Task-based testing focusing on critical user journeys');
    }

    // Add device-specific testing
    if (this.uxConfig.responsiveDesign) {
      testingStrategy.push('Cross-device testing on mobile, tablet, and desktop');
    }

    return testingStrategy;
  }

  private extractPainPoints(userJourneys: UserExperienceResult['userJourneys']): string[] {
    const allPainPoints: string[] = [];
    
    userJourneys.forEach(journey => {
      journey.steps.forEach(step => {
        allPainPoints.push(...step.painPoints);
      });
    });

    return [...new Set(allPainPoints)]; // Remove duplicates
  }

  private getScreenTypes(wireframes: UserExperienceResult['wireframes']): string[] {
    return [...new Set(wireframes.map(w => w.screenType))];
  }

  private calculateUXConfidence(
    designStrategy: UserExperienceResult['designStrategy'],
    userJourneys: UserExperienceResult['userJourneys'],
    wireframes: UserExperienceResult['wireframes'],
    informationArchitecture: UserExperienceResult['informationArchitecture'],
    usabilityRecommendations: UserExperienceResult['usabilityRecommendations']
  ): number {
    
    let confidence = 0.6; // Base confidence
    
    if (designStrategy.designPrinciples.length >= 4) confidence += 0.1;
    if (userJourneys.some(j => j.criticalPath)) confidence += 0.1;
    if (wireframes.length >= 3) confidence += 0.1;
    if (informationArchitecture.siteMap.length >= 3) confidence += 0.1;
    if (usabilityRecommendations.specificRecommendations.some(r => r.impact === 'high')) confidence += 0.05;
    
    return Math.min(0.95, confidence);
  }
}

// Export singleton instance
export const uxExpertAgent = new UXExpertAgent();