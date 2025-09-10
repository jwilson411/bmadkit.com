import { BaseAgent, BaseAgentConfig } from './base-agent';
import { WorkflowContext } from '../models/workflow-models';
import { logger } from '../utils/logger';

export interface AnalystAgentConfig extends Omit<BaseAgentConfig, 'agentPhase'> {
  focusAreas?: string[];
  analysisDepth?: 'surface' | 'comprehensive' | 'deep';
  marketValidationRequired?: boolean;
  competitorAnalysisEnabled?: boolean;
}

export interface BusinessAnalysisResult {
  marketValidation: {
    marketSize: string;
    targetAudience: string[];
    marketTrends: string[];
    competitiveLandscape: string[];
  };
  userNeeds: {
    primaryNeeds: string[];
    secondaryNeeds: string[];
    painPoints: string[];
    desiredOutcomes: string[];
  };
  businessRequirements: {
    functionalRequirements: string[];
    nonFunctionalRequirements: string[];
    constraints: string[];
    assumptions: string[];
  };
  riskAssessment: {
    technicalRisks: string[];
    businessRisks: string[];
    marketRisks: string[];
    mitigation: string[];
  };
  recommendations: string[];
  confidence: number;
}

/**
 * Business Analyst Agent
 * 
 * Specializes in business analysis, market validation, and requirements gathering.
 * Focuses on understanding the business context, market opportunity, and user needs.
 */
export class AnalystAgent extends BaseAgent {
  private analystConfig: AnalystAgentConfig;

  constructor(config: Partial<AnalystAgentConfig> = {}) {
    const baseConfig: BaseAgentConfig = {
      agentPhase: 'ANALYST',
      enableMetrics: true,
      maxInteractions: 20,
      interactionTimeout: 300000, // 5 minutes
      enableContextValidation: true,
      enableResponseValidation: true,
      ...config
    };

    super(baseConfig);

    this.analystConfig = {
      focusAreas: ['market validation', 'user needs', 'business requirements'],
      analysisDepth: 'comprehensive',
      marketValidationRequired: true,
      competitorAnalysisEnabled: true,
      ...config
    };

    logger.debug('Analyst agent initialized', {
      focusAreas: this.analystConfig.focusAreas,
      analysisDepth: this.analystConfig.analysisDepth
    });
  }

  protected async validateContext(context: WorkflowContext): Promise<void> {
    if (!context.projectInput || context.projectInput.trim().length === 0) {
      throw new Error('Project input is required for business analysis');
    }

    if (context.projectInput.length < 10) {
      throw new Error('Project input too short for meaningful analysis');
    }

    // Additional analyst-specific validation
    if (this.analystConfig.marketValidationRequired && 
        !context.industryContext && 
        !this.extractIndustryFromProject(context.projectInput)) {
      logger.warn('Industry context not provided - market validation may be limited');
    }
  }

  protected async validateOutput(output: Record<string, any>): Promise<void> {
    const businessAnalysis = output.businessAnalysis as BusinessAnalysisResult;
    
    if (!businessAnalysis) {
      throw new Error('Business analysis result is required');
    }

    if (!businessAnalysis.marketValidation || 
        !businessAnalysis.userNeeds || 
        !businessAnalysis.businessRequirements) {
      throw new Error('Incomplete business analysis - missing core components');
    }

    if (businessAnalysis.confidence < 0.5) {
      logger.warn('Low confidence in business analysis results', {
        confidence: businessAnalysis.confidence
      });
    }
  }

  protected async executeAgentLogic(
    executionId: string,
    context: WorkflowContext,
    userInput?: string
  ): Promise<Record<string, any>> {
    
    logger.info('Starting business analysis', {
      executionId,
      projectInput: context.projectInput.substring(0, 100) + '...',
      hasUserInput: !!userInput
    });

    // Phase 1: Initial Analysis
    const initialAnalysis = await this.conductInitialAnalysis(context);

    // Phase 2: Market Validation
    const marketValidation = await this.conductMarketValidation(context, initialAnalysis);

    // Phase 3: User Needs Analysis
    const userNeeds = await this.analyzeUserNeeds(context, userInput);

    // Phase 4: Requirements Gathering
    const businessRequirements = await this.gatherBusinessRequirements(context, userNeeds);

    // Phase 5: Risk Assessment
    const riskAssessment = await this.assessRisks(context, businessRequirements);

    // Phase 6: Generate Recommendations
    const recommendations = await this.generateRecommendations(
      marketValidation,
      userNeeds,
      businessRequirements,
      riskAssessment
    );

    // Compile business analysis result
    const businessAnalysis: BusinessAnalysisResult = {
      marketValidation,
      userNeeds,
      businessRequirements,
      riskAssessment,
      recommendations,
      confidence: this.calculateConfidence(marketValidation, userNeeds, businessRequirements)
    };

    // Generate artifacts
    this.generateAnalysisArtifacts(businessAnalysis);

    // Provide summary
    await this.provideSummary(this.generateAnalysisSummary(businessAnalysis));

    return {
      businessAnalysis,
      analystMetadata: {
        analysisDepth: this.analystConfig.analysisDepth,
        focusAreas: this.analystConfig.focusAreas,
        completedAt: new Date(),
        executionId
      }
    };
  }

  private async conductInitialAnalysis(context: WorkflowContext): Promise<any> {
    await this.createInteraction(
      'QUESTION',
      'Let me analyze your project idea. I\'ll start by understanding the core concept and business opportunity.',
      undefined,
      { phase: 'initial-analysis' }
    );

    // Extract key information from project input
    const projectType = this.identifyProjectType(context.projectInput);
    const domain = this.identifyDomain(context.projectInput);
    const scope = this.identifyScope(context.projectInput);

    return {
      projectType,
      domain,
      scope,
      extractedKeywords: this.extractKeywords(context.projectInput)
    };
  }

  private async conductMarketValidation(
    context: WorkflowContext,
    initialAnalysis: any
  ): Promise<BusinessAnalysisResult['marketValidation']> {
    
    const marketQuestion = `Based on your project "${context.projectInput}", I need to understand the market context. What industry or market are you targeting?`;
    
    const marketResponse = await this.askQuestion(marketQuestion, {
      phase: 'market-validation',
      analysisType: 'market-sizing'
    });

    // Analyze competitive landscape
    const competitorQuestion = `What existing solutions or competitors are you aware of in this space?`;
    const competitorResponse = await this.askQuestion(competitorQuestion, {
      phase: 'market-validation',
      analysisType: 'competitive-analysis'
    });

    const marketValidation = {
      marketSize: this.analyzeMarketSize(context, marketResponse),
      targetAudience: this.identifyTargetAudience(context, marketResponse),
      marketTrends: this.identifyMarketTrends(context, marketResponse),
      competitiveLandscape: this.analyzeCompetitors(competitorResponse)
    };

    return marketValidation;
  }

  private async analyzeUserNeeds(
    context: WorkflowContext,
    userInput?: string
  ): Promise<BusinessAnalysisResult['userNeeds']> {
    
    const needsQuestion = `What specific problems does your solution solve for users? What are their main pain points?`;
    const needsResponse = await this.askQuestion(needsQuestion, {
      phase: 'user-needs-analysis',
      analysisType: 'needs-identification'
    });

    const outcomesQuestion = `What successful outcomes do users want to achieve with your solution?`;
    const outcomesResponse = await this.askQuestion(outcomesQuestion, {
      phase: 'user-needs-analysis',
      analysisType: 'outcomes-analysis'
    });

    return {
      primaryNeeds: this.extractPrimaryNeeds(needsResponse),
      secondaryNeeds: this.extractSecondaryNeeds(needsResponse),
      painPoints: this.extractPainPoints(needsResponse),
      desiredOutcomes: this.extractDesiredOutcomes(outcomesResponse)
    };
  }

  private async gatherBusinessRequirements(
    context: WorkflowContext,
    userNeeds: BusinessAnalysisResult['userNeeds']
  ): Promise<BusinessAnalysisResult['businessRequirements']> {
    
    const requirementsQuestion = `Based on the user needs we've identified, what are the key features or capabilities your solution must have?`;
    const requirementsResponse = await this.askQuestion(requirementsQuestion, {
      phase: 'requirements-gathering',
      analysisType: 'functional-requirements'
    });

    const constraintsQuestion = `Are there any technical, budget, or timeline constraints I should be aware of?`;
    const constraintsResponse = await this.askQuestion(constraintsQuestion, {
      phase: 'requirements-gathering',
      analysisType: 'constraints-analysis'
    });

    return {
      functionalRequirements: this.extractFunctionalRequirements(requirementsResponse),
      nonFunctionalRequirements: this.extractNonFunctionalRequirements(context, userNeeds),
      constraints: this.extractConstraints(constraintsResponse),
      assumptions: this.identifyAssumptions(context, requirementsResponse)
    };
  }

  private async assessRisks(
    context: WorkflowContext,
    businessRequirements: BusinessAnalysisResult['businessRequirements']
  ): Promise<BusinessAnalysisResult['riskAssessment']> {
    
    await this.createInteraction(
      'QUESTION',
      'Let me assess the potential risks for this project.',
      undefined,
      { phase: 'risk-assessment' }
    );

    return {
      technicalRisks: this.identifyTechnicalRisks(context, businessRequirements),
      businessRisks: this.identifyBusinessRisks(context, businessRequirements),
      marketRisks: this.identifyMarketRisks(context),
      mitigation: this.generateRiskMitigation(context)
    };
  }

  private async generateRecommendations(
    marketValidation: BusinessAnalysisResult['marketValidation'],
    userNeeds: BusinessAnalysisResult['userNeeds'],
    businessRequirements: BusinessAnalysisResult['businessRequirements'],
    riskAssessment: BusinessAnalysisResult['riskAssessment']
  ): Promise<string[]> {
    
    const recommendations: string[] = [];

    // Market-based recommendations
    if (marketValidation.competitiveLandscape.length > 5) {
      recommendations.push('Focus on differentiation strategies given the competitive landscape');
    }

    // User needs-based recommendations
    if (userNeeds.primaryNeeds.length > 3) {
      recommendations.push('Prioritize core user needs for MVP to avoid feature creep');
    }

    // Requirements-based recommendations
    if (businessRequirements.functionalRequirements.length > 10) {
      recommendations.push('Consider phased implementation approach for complex requirements');
    }

    // Risk-based recommendations
    if (riskAssessment.technicalRisks.length > 0) {
      recommendations.push('Conduct technical feasibility study early in the project');
    }

    recommendations.push('Validate assumptions with user research and prototyping');
    recommendations.push('Establish clear success metrics and KPIs');

    return recommendations;
  }

  private generateAnalysisArtifacts(businessAnalysis: BusinessAnalysisResult): void {
    // Generate Business Analysis Report
    this.generateArtifact(
      'business-analysis-report',
      'Business Analysis Report',
      {
        marketValidation: businessAnalysis.marketValidation,
        executiveummary: `Analysis of business opportunity with ${businessAnalysis.confidence * 100}% confidence`,
        keyFindings: businessAnalysis.recommendations.slice(0, 3),
        nextSteps: ['Proceed to project management phase', 'Validate findings with stakeholders']
      },
      'Comprehensive business analysis findings and recommendations'
    );

    // Generate Requirements Document
    this.generateArtifact(
      'requirements-document',
      'Business Requirements Document',
      {
        functionalRequirements: businessAnalysis.businessRequirements.functionalRequirements,
        nonFunctionalRequirements: businessAnalysis.businessRequirements.nonFunctionalRequirements,
        constraints: businessAnalysis.businessRequirements.constraints,
        assumptions: businessAnalysis.businessRequirements.assumptions
      },
      'Detailed business and functional requirements'
    );

    // Generate Risk Assessment
    this.generateArtifact(
      'risk-assessment',
      'Risk Assessment Matrix',
      {
        risks: businessAnalysis.riskAssessment,
        mitigation: businessAnalysis.riskAssessment.mitigation,
        riskLevel: 'medium' // Simplified for now
      },
      'Identified risks and mitigation strategies'
    );
  }

  private generateAnalysisSummary(businessAnalysis: BusinessAnalysisResult): string {
    return `
Business Analysis Complete!

Key Findings:
• Market Size: ${businessAnalysis.marketValidation.marketSize}
• Primary User Needs: ${businessAnalysis.userNeeds.primaryNeeds.length} identified
• Functional Requirements: ${businessAnalysis.businessRequirements.functionalRequirements.length} defined
• Risk Level: ${businessAnalysis.riskAssessment.technicalRisks.length + businessAnalysis.riskAssessment.businessRisks.length} risks identified

Confidence Level: ${Math.round(businessAnalysis.confidence * 100)}%

Top Recommendations:
${businessAnalysis.recommendations.slice(0, 3).map(r => `• ${r}`).join('\n')}

Ready to proceed to Project Management phase.
    `.trim();
  }

  // Helper methods for analysis
  private identifyProjectType(projectInput: string): string {
    const keywords = projectInput.toLowerCase();
    if (keywords.includes('mobile') || keywords.includes('app')) return 'mobile-application';
    if (keywords.includes('web') || keywords.includes('website')) return 'web-application';
    if (keywords.includes('platform') || keywords.includes('system')) return 'platform';
    if (keywords.includes('api') || keywords.includes('service')) return 'service';
    return 'application';
  }

  private identifyDomain(projectInput: string): string {
    const keywords = projectInput.toLowerCase();
    if (keywords.includes('ecommerce') || keywords.includes('shopping')) return 'ecommerce';
    if (keywords.includes('social') || keywords.includes('community')) return 'social';
    if (keywords.includes('fintech') || keywords.includes('finance')) return 'fintech';
    if (keywords.includes('health') || keywords.includes('medical')) return 'healthcare';
    if (keywords.includes('education') || keywords.includes('learning')) return 'education';
    return 'general';
  }

  private identifyScope(projectInput: string): string {
    const length = projectInput.length;
    if (length > 500) return 'large';
    if (length > 200) return 'medium';
    return 'small';
  }

  private extractKeywords(projectInput: string): string[] {
    // Simplified keyword extraction
    return projectInput
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 10);
  }

  private extractIndustryFromProject(projectInput: string): string | null {
    const industries = ['technology', 'healthcare', 'finance', 'education', 'retail', 'manufacturing'];
    const lowerInput = projectInput.toLowerCase();
    
    for (const industry of industries) {
      if (lowerInput.includes(industry)) {
        return industry;
      }
    }
    
    return null;
  }

  private analyzeMarketSize(context: WorkflowContext, marketResponse: string): string {
    // Simplified market size analysis
    if (marketResponse.toLowerCase().includes('large') || marketResponse.toLowerCase().includes('billion')) {
      return 'Large addressable market';
    }
    if (marketResponse.toLowerCase().includes('medium') || marketResponse.toLowerCase().includes('million')) {
      return 'Medium addressable market';
    }
    return 'Niche market opportunity';
  }

  private identifyTargetAudience(context: WorkflowContext, marketResponse: string): string[] {
    // Simplified audience identification
    const audiences = ['consumers', 'businesses', 'enterprises', 'developers', 'professionals'];
    return audiences.filter(audience => 
      marketResponse.toLowerCase().includes(audience) ||
      context.projectInput.toLowerCase().includes(audience)
    );
  }

  private identifyMarketTrends(context: WorkflowContext, marketResponse: string): string[] {
    return [
      'Digital transformation',
      'Remote work adoption',
      'Mobile-first approach',
      'Cloud migration'
    ];
  }

  private analyzeCompetitors(competitorResponse: string): string[] {
    // Extract competitor names or types
    const competitors = competitorResponse.split(/[,\n]/).map(c => c.trim()).filter(c => c.length > 0);
    return competitors.length > 0 ? competitors : ['Limited direct competition identified'];
  }

  private extractPrimaryNeeds(needsResponse: string): string[] {
    // Simplified needs extraction
    return needsResponse.split(/[,\n]/).map(n => n.trim()).filter(n => n.length > 0).slice(0, 3);
  }

  private extractSecondaryNeeds(needsResponse: string): string[] {
    return ['Enhanced user experience', 'Integration capabilities', 'Scalable solution'];
  }

  private extractPainPoints(needsResponse: string): string[] {
    const painKeywords = ['difficult', 'slow', 'expensive', 'complex', 'frustrating'];
    const painPoints: string[] = [];
    
    for (const keyword of painKeywords) {
      if (needsResponse.toLowerCase().includes(keyword)) {
        painPoints.push(`Current solutions are ${keyword}`);
      }
    }
    
    return painPoints.length > 0 ? painPoints : ['Manual processes', 'Lack of integration'];
  }

  private extractDesiredOutcomes(outcomesResponse: string): string[] {
    return outcomesResponse.split(/[,\n]/).map(o => o.trim()).filter(o => o.length > 0).slice(0, 3);
  }

  private extractFunctionalRequirements(requirementsResponse: string): string[] {
    return requirementsResponse.split(/[,\n]/).map(r => r.trim()).filter(r => r.length > 0);
  }

  private extractNonFunctionalRequirements(context: WorkflowContext, userNeeds: any): string[] {
    return [
      'High performance and responsiveness',
      'Scalable architecture',
      'Security and data protection',
      'Mobile-responsive design'
    ];
  }

  private extractConstraints(constraintsResponse: string): string[] {
    return constraintsResponse.split(/[,\n]/).map(c => c.trim()).filter(c => c.length > 0);
  }

  private identifyAssumptions(context: WorkflowContext, requirementsResponse: string): string[] {
    return [
      'Users have internet connectivity',
      'Target devices support modern web standards',
      'Integration APIs are available and stable'
    ];
  }

  private identifyTechnicalRisks(context: WorkflowContext, requirements: any): string[] {
    return [
      'Integration complexity with external systems',
      'Scalability challenges',
      'Technology stack compatibility'
    ];
  }

  private identifyBusinessRisks(context: WorkflowContext, requirements: any): string[] {
    return [
      'Market adoption rate uncertainty',
      'Competitive response',
      'Resource availability'
    ];
  }

  private identifyMarketRisks(context: WorkflowContext): string[] {
    return [
      'Changing market conditions',
      'Regulatory changes',
      'Economic factors'
    ];
  }

  private generateRiskMitigation(context: WorkflowContext): string[] {
    return [
      'Implement iterative development approach',
      'Conduct regular market validation',
      'Maintain technical flexibility',
      'Build strong partnerships'
    ];
  }

  private calculateConfidence(
    marketValidation: BusinessAnalysisResult['marketValidation'],
    userNeeds: BusinessAnalysisResult['userNeeds'],
    businessRequirements: BusinessAnalysisResult['businessRequirements']
  ): number {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on analysis depth
    if (marketValidation.targetAudience.length > 0) confidence += 0.1;
    if (userNeeds.primaryNeeds.length > 0) confidence += 0.1;
    if (businessRequirements.functionalRequirements.length > 0) confidence += 0.1;
    if (marketValidation.competitiveLandscape.length > 0) confidence += 0.1;
    
    return Math.min(0.95, confidence); // Cap at 95%
  }
}

// Export singleton instance
export const analystAgent = new AnalystAgent();