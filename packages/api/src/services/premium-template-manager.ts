import { promises as fs } from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { EventEmitter } from 'events';
import { featureFlagManager, FeatureFlag } from './feature-flag-manager';
import { subscriptionValidator, UserSubscriptionContext } from './subscription-validator';
import { UserTier } from './feature-flag-manager';

export interface TemplateAccessLevel {
  tier: UserTier;
  features: FeatureFlag[];
}

export interface PremiumTemplateConfig {
  templateId: string;
  name: string;
  description: string;
  category: 'architecture' | 'planning' | 'implementation' | 'analysis' | 'enterprise';
  accessLevel: TemplateAccessLevel;
  templatePath: string;
  dataSchema?: any;
  processingTime: {
    basic: number; // milliseconds
    detailed: number;
    comprehensive: number;
  };
  requiredContextFields: string[];
  supportedOutputFormats: string[];
}

export interface TemplateGenerationParams {
  templateId: string;
  userId: string;
  projectData: any;
  analysisDepth: 'basic' | 'detailed' | 'comprehensive';
  customization?: {
    branding?: {
      logo?: string;
      colorScheme?: string;
      companyName?: string;
    };
    sections?: string[];
    additionalContext?: Record<string, any>;
  };
  outputFormat: 'markdown' | 'html' | 'pdf' | 'docx';
}

export interface TemplateGenerationResult {
  templateId: string;
  generatedContent: string;
  metadata: {
    generatedAt: string;
    processingTimeMs: number;
    analysisDepth: string;
    outputFormat: string;
    templateVersion: string;
    userTier: UserTier;
  };
  analytics: {
    contentLength: number;
    sectionsGenerated: number;
    complexityScore: number;
    resourcesUsed: string[];
  };
}

class PremiumTemplateManager extends EventEmitter {
  private templates: Map<string, PremiumTemplateConfig> = new Map();
  private compiledTemplates: Map<string, HandlebarsTemplateDelegate> = new Map();
  private templateCache: Map<string, { content: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes

  constructor() {
    super();
    this.initializeTemplates();
    this.setupHelpers();
  }

  private async initializeTemplates() {
    const templateConfigs: PremiumTemplateConfig[] = [
      // Basic templates (available to all tiers)
      {
        templateId: 'project-brief',
        name: 'Project Brief',
        description: 'High-level project overview and requirements',
        category: 'planning',
        accessLevel: { tier: UserTier.FREE, features: [] },
        templatePath: 'templates/project-brief.hbs',
        processingTime: { basic: 2000, detailed: 4000, comprehensive: 6000 },
        requiredContextFields: ['projectName', 'description', 'objectives'],
        supportedOutputFormats: ['markdown', 'html', 'pdf']
      },
      {
        templateId: 'basic-architecture',
        name: 'Basic Architecture Overview',
        description: 'Simple system architecture documentation',
        category: 'architecture',
        accessLevel: { tier: UserTier.EMAIL_CAPTURED, features: [] },
        templatePath: 'templates/architecture.hbs',
        processingTime: { basic: 3000, detailed: 6000, comprehensive: 10000 },
        requiredContextFields: ['technicalArchitecture'],
        supportedOutputFormats: ['markdown', 'html', 'pdf']
      },
      
      // Premium templates
      {
        templateId: 'detailed-architecture',
        name: 'Detailed Technical Architecture',
        description: 'Comprehensive architecture with security, scalability, and performance analysis',
        category: 'architecture',
        accessLevel: { 
          tier: UserTier.PREMIUM, 
          features: [FeatureFlag.TECHNICAL_ARCHITECTURE_TEMPLATES] 
        },
        templatePath: 'templates/premium/detailed-architecture.hbs',
        processingTime: { basic: 8000, detailed: 15000, comprehensive: 25000 },
        requiredContextFields: ['technicalArchitecture', 'securityRequirements', 'performanceTargets'],
        supportedOutputFormats: ['markdown', 'html', 'pdf', 'docx']
      },
      {
        templateId: 'implementation-roadmap',
        name: 'Implementation Roadmap',
        description: 'Detailed development timeline with resource planning and risk analysis',
        category: 'implementation',
        accessLevel: { 
          tier: UserTier.PREMIUM, 
          features: [FeatureFlag.IMPLEMENTATION_ROADMAP_TEMPLATES] 
        },
        templatePath: 'templates/premium/implementation-roadmap.hbs',
        processingTime: { basic: 6000, detailed: 12000, comprehensive: 20000 },
        requiredContextFields: ['implementationPlan', 'resourceRequirements', 'timeline'],
        supportedOutputFormats: ['markdown', 'html', 'pdf', 'docx']
      },
      {
        templateId: 'risk-analysis',
        name: 'Risk Analysis & Mitigation',
        description: 'Comprehensive risk assessment with mitigation strategies',
        category: 'analysis',
        accessLevel: { 
          tier: UserTier.PREMIUM, 
          features: [FeatureFlag.PREMIUM_TEMPLATE_LIBRARY] 
        },
        templatePath: 'templates/premium/risk-analysis.hbs',
        processingTime: { basic: 5000, detailed: 10000, comprehensive: 16000 },
        requiredContextFields: ['riskAssessment', 'mitigationStrategies'],
        supportedOutputFormats: ['markdown', 'html', 'pdf', 'docx']
      },
      {
        templateId: 'competitive-analysis',
        name: 'Competitive Analysis',
        description: 'Market positioning and competitive landscape analysis',
        category: 'analysis',
        accessLevel: { 
          tier: UserTier.PREMIUM, 
          features: [FeatureFlag.PREMIUM_TEMPLATE_LIBRARY] 
        },
        templatePath: 'templates/premium/competitive-analysis.hbs',
        processingTime: { basic: 7000, detailed: 14000, comprehensive: 22000 },
        requiredContextFields: ['competitiveAnalysis', 'marketPositioning'],
        supportedOutputFormats: ['markdown', 'html', 'pdf', 'docx']
      },

      // Enterprise templates
      {
        templateId: 'enterprise-architecture',
        name: 'Enterprise Architecture Blueprint',
        description: 'Enterprise-grade architecture with governance and compliance',
        category: 'enterprise',
        accessLevel: { 
          tier: UserTier.ENTERPRISE, 
          features: [FeatureFlag.CUSTOM_BRANDING, FeatureFlag.WHITE_LABEL_PLATFORM] 
        },
        templatePath: 'templates/enterprise/enterprise-architecture.hbs',
        processingTime: { basic: 15000, detailed: 30000, comprehensive: 45000 },
        requiredContextFields: ['enterpriseArchitecture', 'governance', 'compliance'],
        supportedOutputFormats: ['markdown', 'html', 'pdf', 'docx']
      },
      {
        templateId: 'technical-specification',
        name: 'Technical Specification Document',
        description: 'Detailed technical specs with API documentation and integration guides',
        category: 'enterprise',
        accessLevel: { 
          tier: UserTier.ENTERPRISE, 
          features: [FeatureFlag.CUSTOM_BRANDING] 
        },
        templatePath: 'templates/enterprise/technical-specification.hbs',
        processingTime: { basic: 12000, detailed: 24000, comprehensive: 36000 },
        requiredContextFields: ['technicalSpecification', 'apiDocumentation'],
        supportedOutputFormats: ['markdown', 'html', 'pdf', 'docx']
      }
    ];

    for (const config of templateConfigs) {
      this.templates.set(config.templateId, config);
    }

    // Load and compile templates
    await this.loadTemplates();
  }

  private async loadTemplates() {
    for (const [templateId, config] of this.templates) {
      try {
        const templatePath = path.join(process.cwd(), 'packages/api/src', config.templatePath);
        const templateContent = await fs.readFile(templatePath, 'utf8');
        const compiledTemplate = Handlebars.compile(templateContent);
        this.compiledTemplates.set(templateId, compiledTemplate);
      } catch (error) {
        console.warn(`Failed to load template ${templateId}:`, error);
        // Create a fallback template
        const fallbackTemplate = Handlebars.compile(`
# {{templateName}} (Premium Template)

*This premium template is currently being updated. Please try again later.*

Generated for: {{userName}}
Tier: {{userTier}}
Date: {{generatedAt}}
        `);
        this.compiledTemplates.set(templateId, fallbackTemplate);
      }
    }
  }

  private setupHelpers() {
    // Enhanced Handlebars helpers for premium templates
    Handlebars.registerHelper('formatDate', (date: string | Date) => {
      return new Date(date).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    });

    Handlebars.registerHelper('formatDuration', (duration: string) => {
      // Convert duration strings like "2 weeks" to human-readable format
      return duration.replace(/(\d+)/, '$1');
    });

    Handlebars.registerHelper('bulletList', (items: string[]) => {
      if (!Array.isArray(items) || items.length === 0) return '';
      return items.map(item => `- ${item}`).join('\n');
    });

    Handlebars.registerHelper('numberedList', (items: string[]) => {
      if (!Array.isArray(items) || items.length === 0) return '';
      return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    });

    Handlebars.registerHelper('capitalize', (text: string) => {
      return text.charAt(0).toUpperCase() + text.slice(1);
    });

    Handlebars.registerHelper('json', (context: any) => {
      return JSON.stringify(context, null, 2);
    });

    Handlebars.registerHelper('tableRow', (columns: string[]) => {
      return `| ${columns.join(' | ')} |`;
    });

    Handlebars.registerHelper('progressBar', (completed: number, total: number) => {
      const percentage = Math.round((completed / total) * 100);
      const bars = Math.round(percentage / 5); // 20 bars total
      const filledBars = '█'.repeat(bars);
      const emptyBars = '░'.repeat(20 - bars);
      return `${filledBars}${emptyBars} ${percentage}%`;
    });

    // Premium-specific helpers
    Handlebars.registerHelper('riskMatrix', (risks: any[]) => {
      if (!risks || risks.length === 0) return '';
      
      const matrix = risks.map(risk => 
        `| ${risk.category} | ${risk.probability} | ${risk.impact} | ${risk.severity} | ${risk.mitigation} |`
      ).join('\n');
      
      return `| Category | Probability | Impact | Severity | Mitigation |\n|----------|-------------|---------|-----------|------------|\n${matrix}`;
    });

    Handlebars.registerHelper('ganttChart', (timeline: any) => {
      // Generate ASCII Gantt chart for implementation timeline
      if (!timeline || !timeline.phases) return '';
      
      return timeline.phases.map((phase: any, index: number) => {
        const indent = '  '.repeat(index);
        return `${indent}├─ ${phase.name} (${phase.duration})`;
      }).join('\n');
    });
  }

  async getAvailableTemplates(userId: string): Promise<PremiumTemplateConfig[]> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      const availableTemplates: PremiumTemplateConfig[] = [];

      for (const [templateId, config] of this.templates) {
        if (await this.hasTemplateAccess(config, userContext)) {
          availableTemplates.push(config);
        }
      }

      return availableTemplates.sort((a, b) => {
        // Sort by access level (premium features first), then by category
        const tierOrder = { [UserTier.ENTERPRISE]: 0, [UserTier.PREMIUM]: 1, [UserTier.EMAIL_CAPTURED]: 2, [UserTier.FREE]: 3 };
        const aTierOrder = tierOrder[a.accessLevel.tier] || 99;
        const bTierOrder = tierOrder[b.accessLevel.tier] || 99;
        
        if (aTierOrder !== bTierOrder) {
          return aTierOrder - bTierOrder;
        }
        
        return a.category.localeCompare(b.category);
      });
    } catch (error) {
      console.error('Error getting available templates:', error);
      return [];
    }
  }

  async generateTemplate(params: TemplateGenerationParams): Promise<TemplateGenerationResult> {
    const startTime = Date.now();
    
    try {
      // Validate template access
      const template = this.templates.get(params.templateId);
      if (!template) {
        throw new Error(`Template ${params.templateId} not found`);
      }

      const userContext = await subscriptionValidator.validateUserSubscription(params.userId);
      if (!(await this.hasTemplateAccess(template, userContext))) {
        throw new Error(`User does not have access to template ${params.templateId}`);
      }

      // Get compiled template
      const compiledTemplate = this.compiledTemplates.get(params.templateId);
      if (!compiledTemplate) {
        throw new Error(`Template ${params.templateId} not compiled`);
      }

      // Prepare template context
      const templateContext = await this.prepareTemplateContext(params, userContext, template);

      // Generate content
      const generatedContent = compiledTemplate(templateContext);
      
      const processingTime = Date.now() - startTime;
      const expectedTime = template.processingTime[params.analysisDepth];
      
      // Create result
      const result: TemplateGenerationResult = {
        templateId: params.templateId,
        generatedContent,
        metadata: {
          generatedAt: new Date().toISOString(),
          processingTimeMs: processingTime,
          analysisDepth: params.analysisDepth,
          outputFormat: params.outputFormat,
          templateVersion: '1.0.0',
          userTier: userContext.tier
        },
        analytics: {
          contentLength: generatedContent.length,
          sectionsGenerated: this.countSections(generatedContent),
          complexityScore: this.calculateComplexityScore(params.projectData, params.analysisDepth),
          resourcesUsed: this.getResourcesUsed(template, params.analysisDepth)
        }
      };

      // Track usage
      this.emit('templateGenerated', {
        userId: params.userId,
        templateId: params.templateId,
        processingTime,
        expectedTime,
        userTier: userContext.tier,
        analysisDepth: params.analysisDepth
      });

      // Update analytics
      await subscriptionValidator.trackUsage(params.userId, 'documentsPerMonth', 1);

      return result;

    } catch (error) {
      this.emit('templateGenerationError', {
        userId: params.userId,
        templateId: params.templateId,
        error: error.message,
        processingTime: Date.now() - startTime
      });
      throw error;
    }
  }

  private async hasTemplateAccess(
    template: PremiumTemplateConfig, 
    userContext: UserSubscriptionContext
  ): Promise<boolean> {
    // Check tier access
    const tierHierarchy = {
      [UserTier.FREE]: 0,
      [UserTier.EMAIL_CAPTURED]: 1,
      [UserTier.PREMIUM]: 2,
      [UserTier.ENTERPRISE]: 3
    };

    if (tierHierarchy[userContext.tier] < tierHierarchy[template.accessLevel.tier]) {
      return false;
    }

    // Check required features
    for (const requiredFeature of template.accessLevel.features) {
      if (!userContext.features.includes(requiredFeature)) {
        return false;
      }
    }

    return true;
  }

  private async prepareTemplateContext(
    params: TemplateGenerationParams,
    userContext: UserSubscriptionContext,
    template: PremiumTemplateConfig
  ): Promise<any> {
    const baseContext = {
      ...params.projectData,
      templateName: template.name,
      userName: userContext.userId,
      userTier: userContext.tier,
      generatedAt: new Date().toISOString(),
      analysisDepth: params.analysisDepth,
      isPremium: userContext.tier === UserTier.PREMIUM || userContext.tier === UserTier.ENTERPRISE,
      isEnterprise: userContext.tier === UserTier.ENTERPRISE
    };

    // Add premium-specific enhancements based on analysis depth
    if (params.analysisDepth === 'detailed' || params.analysisDepth === 'comprehensive') {
      baseContext.detailedAnalysis = true;
      baseContext.extendedSections = true;
    }

    if (params.analysisDepth === 'comprehensive') {
      baseContext.comprehensiveAnalysis = true;
      baseContext.advancedMetrics = true;
      baseContext.riskAnalysis = true;
    }

    // Add enterprise customization
    if (params.customization?.branding && userContext.tier === UserTier.ENTERPRISE) {
      baseContext.branding = params.customization.branding;
      baseContext.customBranding = true;
    }

    // Add additional context
    if (params.customization?.additionalContext) {
      Object.assign(baseContext, params.customization.additionalContext);
    }

    // Validate required context fields
    for (const field of template.requiredContextFields) {
      if (!(field in baseContext) || baseContext[field] === undefined) {
        console.warn(`Missing required context field: ${field} for template ${template.templateId}`);
      }
    }

    return baseContext;
  }

  private countSections(content: string): number {
    // Count markdown headers
    const headerMatches = content.match(/^#{1,6}\s/gm);
    return headerMatches ? headerMatches.length : 0;
  }

  private calculateComplexityScore(projectData: any, analysisDepth: string): number {
    let score = 0;
    
    // Base complexity from project data
    if (projectData.features) score += projectData.features.length * 2;
    if (projectData.technicalArchitecture) score += 10;
    if (projectData.integrations) score += projectData.integrations.length * 3;
    
    // Analysis depth multiplier
    const depthMultiplier = {
      'basic': 1,
      'detailed': 1.5,
      'comprehensive': 2
    };
    
    return Math.round(score * depthMultiplier[analysisDepth as keyof typeof depthMultiplier]);
  }

  private getResourcesUsed(template: PremiumTemplateConfig, analysisDepth: string): string[] {
    const baseResources = ['Template Engine', 'Content Generation'];
    
    if (template.accessLevel.tier === UserTier.PREMIUM || template.accessLevel.tier === UserTier.ENTERPRISE) {
      baseResources.push('Premium Templates');
    }
    
    if (analysisDepth === 'detailed' || analysisDepth === 'comprehensive') {
      baseResources.push('Advanced Analysis Engine');
    }
    
    if (template.category === 'enterprise') {
      baseResources.push('Enterprise Features', 'Custom Branding');
    }
    
    return baseResources;
  }

  async getTemplateById(templateId: string): Promise<PremiumTemplateConfig | null> {
    return this.templates.get(templateId) || null;
  }

  async getTemplatesByCategory(category: string, userId: string): Promise<PremiumTemplateConfig[]> {
    const availableTemplates = await this.getAvailableTemplates(userId);
    return availableTemplates.filter(template => template.category === category);
  }

  async getTemplateAnalytics(templateId: string, timeRange: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    // This would connect to analytics service in a real implementation
    return {
      templateId,
      timeRange,
      totalGenerations: 0,
      averageProcessingTime: 0,
      popularityScore: 0,
      userFeedback: {
        rating: 0,
        comments: []
      }
    };
  }
}

export const premiumTemplateManager = new PremiumTemplateManager();