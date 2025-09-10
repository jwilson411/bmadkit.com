import { BaseAgent, BaseAgentConfig } from './base-agent';
import { WorkflowContext } from '../models/workflow-models';
import { logger } from '../utils/logger';

export interface PMAgentConfig extends Omit<BaseAgentConfig, 'agentPhase'> {
  methodology?: 'agile' | 'waterfall' | 'lean' | 'hybrid';
  prioritizationFramework?: 'moscow' | 'kano' | 'rice' | 'impact-effort';
  scopeDefinitionDepth?: 'high-level' | 'detailed' | 'comprehensive';
  userStoryFormat?: 'standard' | 'bdd' | 'job-stories';
}

export interface ProjectScopeResult {
  projectOverview: {
    vision: string;
    objectives: string[];
    successCriteria: string[];
    scope: string;
    outOfScope: string[];
  };
  featurePrioritization: {
    mvpFeatures: Array<{
      name: string;
      description: string;
      priority: 'must-have' | 'should-have' | 'could-have' | 'won\'t-have';
      effort: 'low' | 'medium' | 'high';
      impact: 'low' | 'medium' | 'high';
    }>;
    futureFeatures: Array<{
      name: string;
      description: string;
      rationale: string;
    }>;
  };
  userStories: Array<{
    id: string;
    title: string;
    story: string;
    acceptanceCriteria: string[];
    priority: number;
    estimatedEffort: string;
    dependencies: string[];
  }>;
  projectPlan: {
    phases: Array<{
      name: string;
      duration: string;
      deliverables: string[];
      milestones: string[];
    }>;
    timeline: string;
    resources: string[];
    risks: string[];
  };
  recommendations: string[];
  confidence: number;
}

/**
 * Project Manager Agent
 * 
 * Specializes in project management, feature prioritization, and user story creation.
 * Focuses on defining project scope, creating actionable plans, and managing requirements.
 */
export class PMAgent extends BaseAgent {
  private pmConfig: PMAgentConfig;

  constructor(config: Partial<PMAgentConfig> = {}) {
    const baseConfig: BaseAgentConfig = {
      agentPhase: 'PM',
      enableMetrics: true,
      maxInteractions: 25,
      interactionTimeout: 300000, // 5 minutes
      enableContextValidation: true,
      enableResponseValidation: true,
      ...config
    };

    super(baseConfig);

    this.pmConfig = {
      methodology: 'agile',
      prioritizationFramework: 'moscow',
      scopeDefinitionDepth: 'detailed',
      userStoryFormat: 'standard',
      ...config
    };

    logger.debug('PM agent initialized', {
      methodology: this.pmConfig.methodology,
      prioritizationFramework: this.pmConfig.prioritizationFramework
    });
  }

  protected async validateContext(context: WorkflowContext): Promise<void> {
    if (!context.projectInput) {
      throw new Error('Project input is required for project management');
    }

    // Check for business analysis from previous phase
    if (!context.businessAnalysis && !this.hasBusinessAnalysisContext(context)) {
      throw new Error('Business analysis context is required for project management phase');
    }

    // Validate that we have sufficient information for scope definition
    if (this.pmConfig.scopeDefinitionDepth === 'comprehensive' && !this.hasSufficientContext(context)) {
      logger.warn('Limited context for comprehensive scope definition');
    }
  }

  protected async validateOutput(output: Record<string, any>): Promise<void> {
    const projectScope = output.projectScope as ProjectScopeResult;
    
    if (!projectScope) {
      throw new Error('Project scope result is required');
    }

    if (!projectScope.projectOverview || !projectScope.featurePrioritization || !projectScope.userStories) {
      throw new Error('Incomplete project scope - missing core components');
    }

    if (projectScope.userStories.length === 0) {
      throw new Error('At least one user story is required');
    }

    if (projectScope.featurePrioritization.mvpFeatures.length === 0) {
      throw new Error('At least one MVP feature must be defined');
    }

    if (projectScope.confidence < 0.6) {
      logger.warn('Low confidence in project scope results', {
        confidence: projectScope.confidence
      });
    }
  }

  protected async executeAgentLogic(
    executionId: string,
    context: WorkflowContext,
    userInput?: string
  ): Promise<Record<string, any>> {
    
    logger.info('Starting project management analysis', {
      executionId,
      methodology: this.pmConfig.methodology,
      hasBusinessAnalysis: !!context.businessAnalysis
    });

    // Phase 1: Project Overview and Vision
    const projectOverview = await this.defineProjectOverview(context);

    // Phase 2: Feature Identification and Prioritization
    const featurePrioritization = await this.prioritizeFeatures(context, projectOverview);

    // Phase 3: User Story Creation
    const userStories = await this.createUserStories(context, featurePrioritization);

    // Phase 4: Project Planning
    const projectPlan = await this.createProjectPlan(context, featurePrioritization, userStories);

    // Phase 5: Generate PM Recommendations
    const recommendations = await this.generatePMRecommendations(
      projectOverview,
      featurePrioritization,
      userStories,
      projectPlan
    );

    // Compile project scope result
    const projectScope: ProjectScopeResult = {
      projectOverview,
      featurePrioritization,
      userStories,
      projectPlan,
      recommendations,
      confidence: this.calculatePMConfidence(projectOverview, featurePrioritization, userStories, projectPlan)
    };

    // Generate PM artifacts
    this.generatePMArtifacts(projectScope);

    // Provide summary
    await this.provideSummary(this.generatePMSummary(projectScope));

    return {
      projectScope,
      pmMetadata: {
        methodology: this.pmConfig.methodology,
        prioritizationFramework: this.pmConfig.prioritizationFramework,
        userStoryFormat: this.pmConfig.userStoryFormat,
        completedAt: new Date(),
        executionId
      }
    };
  }

  private async defineProjectOverview(context: WorkflowContext): Promise<ProjectScopeResult['projectOverview']> {
    await this.createInteraction(
      'QUESTION',
      'Now I\'ll help define the project scope and create a clear vision based on the business analysis.',
      undefined,
      { phase: 'project-overview' }
    );

    const visionQuestion = `Based on the business analysis, what is your vision for this project? What success looks like?`;
    const visionResponse = await this.askQuestion(visionQuestion, {
      phase: 'project-overview',
      analysisType: 'vision-definition'
    });

    const scopeQuestion = `What should be included in the initial version of this project? What are the boundaries?`;
    const scopeResponse = await this.askQuestion(scopeQuestion, {
      phase: 'project-overview',
      analysisType: 'scope-definition'
    });

    const outOfScopeQuestion = `What should explicitly be out of scope for the initial version?`;
    const outOfScopeResponse = await this.askQuestion(outOfScopeQuestion, {
      phase: 'project-overview',
      analysisType: 'scope-boundaries'
    });

    return {
      vision: this.refineVision(visionResponse, context),
      objectives: this.extractObjectives(context, visionResponse),
      successCriteria: this.defineSuccessCriteria(context, visionResponse),
      scope: this.defineScope(scopeResponse, context),
      outOfScope: this.defineOutOfScope(outOfScopeResponse)
    };
  }

  private async prioritizeFeatures(
    context: WorkflowContext,
    projectOverview: ProjectScopeResult['projectOverview']
  ): Promise<ProjectScopeResult['featurePrioritization']> {
    
    const featuresQuestion = `Based on the business analysis and project scope, what are the key features needed for the MVP?`;
    const featuresResponse = await this.askQuestion(featuresQuestion, {
      phase: 'feature-prioritization',
      framework: this.pmConfig.prioritizationFramework
    });

    const priorityQuestion = `Of these features, which are absolutely critical for launch vs nice-to-have?`;
    const priorityResponse = await this.askQuestion(priorityQuestion, {
      phase: 'feature-prioritization',
      analysisType: 'priority-assessment'
    });

    // Extract and categorize features
    const identifiedFeatures = this.extractFeatures(featuresResponse, context);
    const mvpFeatures = this.categorizeMVPFeatures(identifiedFeatures, priorityResponse);
    const futureFeatures = this.identifyFutureFeatures(identifiedFeatures, mvpFeatures);

    return {
      mvpFeatures,
      futureFeatures
    };
  }

  private async createUserStories(
    context: WorkflowContext,
    featurePrioritization: ProjectScopeResult['featurePrioritization']
  ): Promise<ProjectScopeResult['userStories']> {
    
    await this.createInteraction(
      'QUESTION',
      'Now I\'ll create user stories for the prioritized features using best practices.',
      undefined,
      { phase: 'user-story-creation' }
    );

    const userStories: ProjectScopeResult['userStories'] = [];
    let storyIdCounter = 1;

    for (const feature of featurePrioritization.mvpFeatures) {
      if (feature.priority === 'must-have' || feature.priority === 'should-have') {
        const stories = this.generateUserStoriesForFeature(feature, storyIdCounter, context);
        userStories.push(...stories);
        storyIdCounter += stories.length;
      }
    }

    // Validate and refine stories
    return this.validateAndRefineUserStories(userStories);
  }

  private async createProjectPlan(
    context: WorkflowContext,
    featurePrioritization: ProjectScopeResult['featurePrioritization'],
    userStories: ProjectScopeResult['userStories']
  ): Promise<ProjectScopeResult['projectPlan']> {
    
    const timelineQuestion = `What is your preferred timeline for this project? Any hard deadlines?`;
    const timelineResponse = await this.askQuestion(timelineQuestion, {
      phase: 'project-planning',
      analysisType: 'timeline-definition'
    });

    const resourceQuestion = `What resources do you have available? Team size, budget constraints?`;
    const resourceResponse = await this.askQuestion(resourceQuestion, {
      phase: 'project-planning',
      analysisType: 'resource-assessment'
    });

    return {
      phases: this.defineDevelopmentPhases(featurePrioritization, userStories),
      timeline: this.estimateTimeline(timelineResponse, userStories),
      resources: this.identifyRequiredResources(resourceResponse, featurePrioritization),
      risks: this.identifyProjectRisks(context, featurePrioritization)
    };
  }

  private async generatePMRecommendations(
    projectOverview: ProjectScopeResult['projectOverview'],
    featurePrioritization: ProjectScopeResult['featurePrioritization'],
    userStories: ProjectScopeResult['userStories'],
    projectPlan: ProjectScopeResult['projectPlan']
  ): Promise<string[]> {
    
    const recommendations: string[] = [];

    // Feature-based recommendations
    const mustHaveCount = featurePrioritization.mvpFeatures.filter(f => f.priority === 'must-have').length;
    if (mustHaveCount > 8) {
      recommendations.push('Consider reducing MVP scope - current must-have features may be too ambitious for initial release');
    }

    // User story recommendations
    if (userStories.length > 20) {
      recommendations.push('Large number of user stories detected - consider breaking into smaller epics');
    }

    // Timeline recommendations
    if (projectPlan.phases.length > 4) {
      recommendations.push('Consider consolidating development phases for faster time to market');
    }

    // Methodology recommendations
    recommendations.push(`Using ${this.pmConfig.methodology} methodology - ensure team is aligned on practices`);
    
    // General PM recommendations
    recommendations.push('Implement regular stakeholder reviews and feedback cycles');
    recommendations.push('Establish clear definition of done for each user story');
    recommendations.push('Plan for iterative user testing and validation');

    return recommendations;
  }

  private generatePMArtifacts(projectScope: ProjectScopeResult): void {
    // Generate Project Charter
    this.generateArtifact(
      'project-charter',
      'Project Charter',
      {
        vision: projectScope.projectOverview.vision,
        objectives: projectScope.projectOverview.objectives,
        scope: projectScope.projectOverview.scope,
        successCriteria: projectScope.projectOverview.successCriteria,
        timeline: projectScope.projectPlan.timeline,
        resources: projectScope.projectPlan.resources
      },
      'Comprehensive project charter defining vision, scope, and objectives'
    );

    // Generate User Stories Backlog
    this.generateArtifact(
      'user-stories-backlog',
      'Product Backlog',
      {
        totalStories: projectScope.userStories.length,
        userStories: projectScope.userStories,
        prioritizationFramework: this.pmConfig.prioritizationFramework,
        estimatedTotalEffort: this.calculateTotalEffort(projectScope.userStories)
      },
      'Prioritized user stories backlog with acceptance criteria'
    );

    // Generate Feature Roadmap
    this.generateArtifact(
      'feature-roadmap',
      'Product Feature Roadmap',
      {
        mvpFeatures: projectScope.featurePrioritization.mvpFeatures,
        futureFeatures: projectScope.featurePrioritization.futureFeatures,
        phases: projectScope.projectPlan.phases,
        methodology: this.pmConfig.methodology
      },
      'Feature roadmap showing MVP and future development phases'
    );

    // Generate Project Plan
    this.generateArtifact(
      'project-plan',
      'Detailed Project Plan',
      {
        phases: projectScope.projectPlan.phases,
        timeline: projectScope.projectPlan.timeline,
        risks: projectScope.projectPlan.risks,
        resources: projectScope.projectPlan.resources,
        recommendations: projectScope.recommendations
      },
      'Comprehensive project execution plan with timeline and resources'
    );
  }

  private generatePMSummary(projectScope: ProjectScopeResult): string {
    return `
Project Management Analysis Complete!

Project Overview:
• Vision: ${projectScope.projectOverview.vision.substring(0, 100)}...
• Key Objectives: ${projectScope.projectOverview.objectives.length} defined
• Success Criteria: ${projectScope.projectOverview.successCriteria.length} established

Feature Prioritization:
• MVP Features: ${projectScope.featurePrioritization.mvpFeatures.length} (${projectScope.featurePrioritization.mvpFeatures.filter(f => f.priority === 'must-have').length} must-have)
• Future Features: ${projectScope.featurePrioritization.futureFeatures.length} identified

User Stories:
• Total Stories: ${projectScope.userStories.length}
• High Priority: ${projectScope.userStories.filter(s => s.priority <= 3).length}
• Estimated Timeline: ${projectScope.projectPlan.timeline}

Confidence Level: ${Math.round(projectScope.confidence * 100)}%

Top Recommendations:
${projectScope.recommendations.slice(0, 3).map(r => `• ${r}`).join('\n')}

Ready to proceed to UX Expert phase.
    `.trim();
  }

  // Helper methods
  private hasBusinessAnalysisContext(context: WorkflowContext): boolean {
    return !!(context.businessAnalysis || 
             context.marketValidation || 
             context.userNeeds ||
             (context.enrichments && context.enrichments.some(e => e.agentPhase === 'ANALYST')));
  }

  private hasSufficientContext(context: WorkflowContext): boolean {
    return !!(context.businessAnalysis && 
             context.userNeeds && 
             context.businessRequirements);
  }

  private refineVision(visionResponse: string, context: WorkflowContext): string {
    // Enhance vision with business analysis context
    let refinedVision = visionResponse.trim();
    
    if (context.businessAnalysis && !refinedVision.toLowerCase().includes('user')) {
      refinedVision += '. The solution will address key user needs identified in the business analysis.';
    }
    
    return refinedVision;
  }

  private extractObjectives(context: WorkflowContext, visionResponse: string): string[] {
    const objectives: string[] = [];
    
    // Extract objectives from business analysis
    if (context.businessAnalysis?.userNeeds) {
      objectives.push('Address primary user needs identified in analysis');
    }
    
    if (context.businessAnalysis?.marketValidation) {
      objectives.push('Establish market presence in identified target segments');
    }
    
    // Extract from vision response
    const visionObjectives = this.extractObjectivesFromText(visionResponse);
    objectives.push(...visionObjectives);
    
    return objectives.length > 0 ? objectives : ['Deliver successful product launch', 'Achieve user adoption goals'];
  }

  private extractObjectivesFromText(text: string): string[] {
    // Simple objective extraction
    const sentences = text.split('.').map(s => s.trim()).filter(s => s.length > 0);
    return sentences.filter(s => s.toLowerCase().includes('goal') || s.toLowerCase().includes('objective')).slice(0, 3);
  }

  private defineSuccessCriteria(context: WorkflowContext, visionResponse: string): string[] {
    return [
      'User adoption meets target metrics',
      'Core functionality delivers expected value',
      'Performance meets technical requirements',
      'Stakeholder satisfaction achieved'
    ];
  }

  private defineScope(scopeResponse: string, context: WorkflowContext): string {
    let scope = scopeResponse.trim();
    
    if (context.businessAnalysis?.businessRequirements?.functionalRequirements) {
      scope += '. Includes core functional requirements identified in business analysis.';
    }
    
    return scope;
  }

  private defineOutOfScope(outOfScopeResponse: string): string[] {
    const outOfScope = outOfScopeResponse.split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
    
    if (outOfScope.length === 0) {
      return [
        'Advanced analytics and reporting',
        'Third-party integrations beyond core requirements',
        'Mobile applications (if web-focused)',
        'Multi-language support initially'
      ];
    }
    
    return outOfScope;
  }

  private extractFeatures(featuresResponse: string, context: WorkflowContext): Array<{name: string; description: string}> {
    const features = featuresResponse.split(/[,\n]/).map(f => f.trim()).filter(f => f.length > 0);
    
    return features.map(feature => ({
      name: feature.length > 50 ? feature.substring(0, 50) + '...' : feature,
      description: feature
    }));
  }

  private categorizeMVPFeatures(
    identifiedFeatures: Array<{name: string; description: string}>,
    priorityResponse: string
  ): ProjectScopeResult['featurePrioritization']['mvpFeatures'] {
    
    return identifiedFeatures.map(feature => ({
      name: feature.name,
      description: feature.description,
      priority: this.assessFeaturePriority(feature, priorityResponse),
      effort: this.estimateFeatureEffort(feature),
      impact: this.assessFeatureImpact(feature)
    }));
  }

  private assessFeaturePriority(
    feature: {name: string; description: string},
    priorityResponse: string
  ): 'must-have' | 'should-have' | 'could-have' | 'won\'t-have' {
    
    const featureText = feature.name.toLowerCase() + ' ' + feature.description.toLowerCase();
    const priorityText = priorityResponse.toLowerCase();
    
    if (priorityText.includes('critical') || priorityText.includes('essential') || priorityText.includes('must')) {
      return 'must-have';
    }
    if (priorityText.includes('important') || priorityText.includes('should')) {
      return 'should-have';
    }
    if (featureText.includes('authentication') || featureText.includes('security')) {
      return 'must-have';
    }
    if (featureText.includes('dashboard') || featureText.includes('core')) {
      return 'must-have';
    }
    
    return Math.random() > 0.6 ? 'should-have' : 'could-have';
  }

  private estimateFeatureEffort(feature: {name: string; description: string}): 'low' | 'medium' | 'high' {
    const complexityKeywords = ['integration', 'complex', 'advanced', 'machine learning', 'ai'];
    const featureText = (feature.name + ' ' + feature.description).toLowerCase();
    
    for (const keyword of complexityKeywords) {
      if (featureText.includes(keyword)) {
        return 'high';
      }
    }
    
    return feature.description.length > 100 ? 'medium' : 'low';
  }

  private assessFeatureImpact(feature: {name: string; description: string}): 'low' | 'medium' | 'high' {
    const highImpactKeywords = ['user', 'core', 'main', 'primary', 'essential'];
    const featureText = (feature.name + ' ' + feature.description).toLowerCase();
    
    for (const keyword of highImpactKeywords) {
      if (featureText.includes(keyword)) {
        return 'high';
      }
    }
    
    return 'medium';
  }

  private identifyFutureFeatures(
    identifiedFeatures: Array<{name: string; description: string}>,
    mvpFeatures: ProjectScopeResult['featurePrioritization']['mvpFeatures']
  ): ProjectScopeResult['featurePrioritization']['futureFeatures'] {
    
    return [
      {
        name: 'Advanced Analytics Dashboard',
        description: 'Comprehensive analytics and reporting capabilities',
        rationale: 'Valuable for growth phase but not essential for MVP'
      },
      {
        name: 'Mobile Application',
        description: 'Native mobile apps for iOS and Android',
        rationale: 'Extend reach after web platform is established'
      },
      {
        name: 'Third-party Integrations',
        description: 'Integration with popular external services',
        rationale: 'Add value after core functionality is proven'
      }
    ];
  }

  private generateUserStoriesForFeature(
    feature: ProjectScopeResult['featurePrioritization']['mvpFeatures'][0],
    startingId: number,
    context: WorkflowContext
  ): ProjectScopeResult['userStories'] {
    
    const stories: ProjectScopeResult['userStories'] = [];
    
    // Generate 1-3 user stories per feature
    const storyCount = Math.min(3, Math.max(1, Math.ceil(feature.name.length / 20)));
    
    for (let i = 0; i < storyCount; i++) {
      const storyId = `US-${String(startingId + i).padStart(3, '0')}`;
      
      stories.push({
        id: storyId,
        title: `${feature.name} - Story ${i + 1}`,
        story: this.generateUserStoryText(feature, i + 1),
        acceptanceCriteria: this.generateAcceptanceCriteria(feature),
        priority: this.convertPriorityToNumber(feature.priority),
        estimatedEffort: this.convertEffortToStoryPoints(feature.effort),
        dependencies: this.identifyStoryDependencies(feature, stories)
      });
    }
    
    return stories;
  }

  private generateUserStoryText(
    feature: ProjectScopeResult['featurePrioritization']['mvpFeatures'][0],
    storyNumber: number
  ): string {
    
    const userType = 'a user';
    const action = feature.name.toLowerCase();
    const benefit = feature.description;
    
    return `As ${userType}, I want to ${action} so that ${benefit}`;
  }

  private generateAcceptanceCriteria(
    feature: ProjectScopeResult['featurePrioritization']['mvpFeatures'][0]
  ): string[] {
    
    return [
      `Given the user accesses the ${feature.name.toLowerCase()} functionality`,
      `When they perform the expected actions`,
      `Then the system should respond appropriately`,
      `And the user should receive confirmation of success`
    ];
  }

  private convertPriorityToNumber(priority: string): number {
    const priorityMap = {
      'must-have': 1,
      'should-have': 2,
      'could-have': 3,
      'won\'t-have': 4
    };
    return priorityMap[priority as keyof typeof priorityMap] || 3;
  }

  private convertEffortToStoryPoints(effort: string): string {
    const effortMap = {
      'low': '3',
      'medium': '5',
      'high': '8'
    };
    return effortMap[effort as keyof typeof effortMap] || '5';
  }

  private identifyStoryDependencies(
    feature: ProjectScopeResult['featurePrioritization']['mvpFeatures'][0],
    existingStories: ProjectScopeResult['userStories']
  ): string[] {
    
    // Simple dependency identification
    if (feature.name.toLowerCase().includes('dashboard')) {
      return ['Authentication', 'Data retrieval'];
    }
    if (feature.name.toLowerCase().includes('profile')) {
      return ['User registration', 'Authentication'];
    }
    
    return [];
  }

  private validateAndRefineUserStories(userStories: ProjectScopeResult['userStories']): ProjectScopeResult['userStories'] {
    // Ensure stories meet quality criteria
    return userStories.map(story => ({
      ...story,
      story: story.story.charAt(0).toUpperCase() + story.story.slice(1),
      acceptanceCriteria: story.acceptanceCriteria.map(ac => 
        ac.charAt(0).toUpperCase() + ac.slice(1)
      )
    }));
  }

  private defineDevelopmentPhases(
    featurePrioritization: ProjectScopeResult['featurePrioritization'],
    userStories: ProjectScopeResult['userStories']
  ): ProjectScopeResult['projectPlan']['phases'] {
    
    const mustHaveFeatures = featurePrioritization.mvpFeatures.filter(f => f.priority === 'must-have');
    const shouldHaveFeatures = featurePrioritization.mvpFeatures.filter(f => f.priority === 'should-have');
    
    return [
      {
        name: 'Foundation Phase',
        duration: '4-6 weeks',
        deliverables: ['Project setup', 'Core infrastructure', 'Authentication system'],
        milestones: ['Development environment ready', 'Basic user management']
      },
      {
        name: 'Core Features Phase',
        duration: '6-8 weeks',
        deliverables: mustHaveFeatures.slice(0, 3).map(f => f.name),
        milestones: ['MVP core functionality complete', 'Initial user testing']
      },
      {
        name: 'Enhancement Phase',
        duration: '4-6 weeks',
        deliverables: shouldHaveFeatures.slice(0, 2).map(f => f.name),
        milestones: ['Feature complete', 'Performance optimization']
      },
      {
        name: 'Launch Phase',
        duration: '2-3 weeks',
        deliverables: ['Final testing', 'Deployment', 'Launch preparation'],
        milestones: ['Production ready', 'Go-live']
      }
    ];
  }

  private estimateTimeline(timelineResponse: string, userStories: ProjectScopeResult['userStories']): string {
    const totalStoryPoints = userStories.reduce((sum, story) => sum + parseInt(story.estimatedEffort), 0);
    const weeksEstimate = Math.ceil(totalStoryPoints / 10); // Assuming 10 story points per week
    
    if (timelineResponse.toLowerCase().includes('urgent') || timelineResponse.toLowerCase().includes('asap')) {
      return `${Math.max(8, weeksEstimate - 2)} weeks (accelerated)`;
    }
    
    return `${weeksEstimate} weeks`;
  }

  private identifyRequiredResources(
    resourceResponse: string,
    featurePrioritization: ProjectScopeResult['featurePrioritization']
  ): string[] {
    
    const resources = ['Project Manager', 'Frontend Developer', 'Backend Developer'];
    
    const hasComplexFeatures = featurePrioritization.mvpFeatures.some(f => f.effort === 'high');
    if (hasComplexFeatures) {
      resources.push('Senior Developer', 'DevOps Engineer');
    }
    
    if (resourceResponse.toLowerCase().includes('design')) {
      resources.push('UX/UI Designer');
    }
    
    if (resourceResponse.toLowerCase().includes('test')) {
      resources.push('QA Tester');
    }
    
    return resources;
  }

  private identifyProjectRisks(
    context: WorkflowContext,
    featurePrioritization: ProjectScopeResult['featurePrioritization']
  ): string[] {
    
    const risks = ['Scope creep during development', 'Resource availability'];
    
    if (featurePrioritization.mvpFeatures.filter(f => f.effort === 'high').length > 2) {
      risks.push('Technical complexity may impact timeline');
    }
    
    if (context.businessAnalysis?.riskAssessment) {
      risks.push('Market risks identified in business analysis');
    }
    
    return risks;
  }

  private calculateTotalEffort(userStories: ProjectScopeResult['userStories']): string {
    const totalPoints = userStories.reduce((sum, story) => sum + parseInt(story.estimatedEffort), 0);
    return `${totalPoints} story points`;
  }

  private calculatePMConfidence(
    projectOverview: ProjectScopeResult['projectOverview'],
    featurePrioritization: ProjectScopeResult['featurePrioritization'],
    userStories: ProjectScopeResult['userStories'],
    projectPlan: ProjectScopeResult['projectPlan']
  ): number {
    
    let confidence = 0.6; // Base confidence
    
    if (projectOverview.objectives.length > 0) confidence += 0.1;
    if (featurePrioritization.mvpFeatures.filter(f => f.priority === 'must-have').length > 0) confidence += 0.1;
    if (userStories.length > 0 && userStories.every(s => s.acceptanceCriteria.length > 0)) confidence += 0.1;
    if (projectPlan.phases.length >= 3) confidence += 0.1;
    
    return Math.min(0.95, confidence);
  }
}

// Export singleton instance
export const pmAgent = new PMAgent();