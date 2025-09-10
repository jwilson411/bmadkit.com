import Handlebars from 'handlebars';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { DocumentTemplate, DocumentType, BMAD_DOCUMENT_TEMPLATES } from '../models/document';
import { WorkflowContext } from '../models/workflow-models';
import { EventEmitter } from 'events';

export interface TemplateProcessingResult {
  success: boolean;
  content: string;
  variables: Record<string, any>;
  errors?: Array<{
    code: string;
    message: string;
    line?: number;
    column?: number;
  }>;
  warnings?: string[];
  processingTime: number;
}

export interface TemplateContext {
  workflowContext: WorkflowContext;
  documentData: Record<string, any>;
  agentOutputs: Record<string, any>;
  metadata: {
    generatedAt: Date;
    documentType: DocumentType;
    version: string;
    projectName?: string;
  };
}

export class TemplateProcessor extends EventEmitter {
  private handlebars: typeof Handlebars;
  private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();
  private helperCache: Map<string, Handlebars.HelperDelegate> = new Map();

  constructor() {
    super();
    this.handlebars = Handlebars.create();
    this.registerHelpers();
    this.registerPartials();
  }

  /**
   * Process a template with given context data
   */
  async processTemplate(
    template: DocumentTemplate,
    context: TemplateContext
  ): Promise<TemplateProcessingResult> {
    const startTime = Date.now();

    try {
      logger.debug('Processing template', {
        templateId: template.id,
        type: template.type,
        contextKeys: Object.keys(context.workflowContext)
      });

      // Validate template before processing
      await this.validateTemplate(template);

      // Prepare template variables
      const templateVariables = await this.prepareTemplateVariables(template, context);

      // Compile template (with caching)
      const compiledTemplate = await this.getCompiledTemplate(template);

      // Process template with error handling
      const content = await this.executeTemplate(compiledTemplate, templateVariables);

      // Validate output
      const validationResults = await this.validateOutput(content, template);

      const processingTime = Date.now() - startTime;

      const result: TemplateProcessingResult = {
        success: true,
        content,
        variables: templateVariables,
        processingTime,
        warnings: validationResults.warnings
      };

      this.emit('template-processed', {
        templateId: template.id,
        success: true,
        processingTime,
        outputSize: content.length
      });

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.error('Template processing failed', {
        templateId: template.id,
        error: (error as Error).message,
        processingTime
      });

      const result: TemplateProcessingResult = {
        success: false,
        content: '',
        variables: {},
        errors: [{
          code: 'TEMPLATE_PROCESSING_ERROR',
          message: (error as Error).message
        }],
        processingTime
      };

      this.emit('template-error', {
        templateId: template.id,
        error: error as Error,
        processingTime
      });

      return result;
    }
  }

  /**
   * Process multiple templates in batch
   */
  async processBatch(
    templates: DocumentTemplate[],
    contexts: TemplateContext[]
  ): Promise<TemplateProcessingResult[]> {
    
    if (templates.length !== contexts.length) {
      throw new Error('Templates and contexts arrays must have the same length');
    }

    logger.info('Processing template batch', { count: templates.length });

    const results = await Promise.allSettled(
      templates.map((template, index) => 
        this.processTemplate(template, contexts[index])
      )
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          content: '',
          variables: {},
          errors: [{
            code: 'BATCH_PROCESSING_ERROR',
            message: `Template ${templates[index].id}: ${result.reason.message}`
          }],
          processingTime: 0
        };
      }
    });
  }

  /**
   * Register custom Handlebars helpers for BMAD templates
   */
  private registerHelpers(): void {
    // Date formatting helper
    this.handlebars.registerHelper('formatDate', (date: Date, format?: string) => {
      if (!date) return '';
      
      const options: Intl.DateTimeFormatOptions = {};
      switch (format) {
        case 'short':
          options.dateStyle = 'short';
          break;
        case 'medium':
          options.dateStyle = 'medium';
          break;
        case 'long':
          options.dateStyle = 'long';
          break;
        default:
          options.dateStyle = 'medium';
      }
      
      return new Date(date).toLocaleDateString('en-US', options);
    });

    // Markdown formatting helpers
    this.handlebars.registerHelper('markdown', (text: string) => {
      if (!text) return '';
      return new this.handlebars.SafeString(text);
    });

    // List formatting helper
    this.handlebars.registerHelper('bulletList', (items: string[]) => {
      if (!Array.isArray(items)) return '';
      return items.map(item => `- ${item}`).join('\n');
    });

    // Number formatting helper
    this.handlebars.registerHelper('orderedList', (items: string[]) => {
      if (!Array.isArray(items)) return '';
      return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    });

    // Conditional helpers
    this.handlebars.registerHelper('ifEquals', function(arg1: any, arg2: any, options: any) {
      return (arg1 === arg2) ? options.fn(this) : options.inverse(this);
    });

    this.handlebars.registerHelper('ifContains', function(array: any[], item: any, options: any) {
      return Array.isArray(array) && array.includes(item) ? options.fn(this) : options.inverse(this);
    });

    // Text processing helpers
    this.handlebars.registerHelper('capitalize', (text: string) => {
      if (!text) return '';
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    });

    this.handlebars.registerHelper('uppercase', (text: string) => {
      return text ? text.toUpperCase() : '';
    });

    this.handlebars.registerHelper('lowercase', (text: string) => {
      return text ? text.toLowerCase() : '';
    });

    // BMAD-specific helpers
    this.handlebars.registerHelper('agentOutput', function(phase: string, key: string) {
      const agentOutputs = this.agentOutputs || {};
      return agentOutputs[phase]?.[key] || '';
    });

    this.handlebars.registerHelper('requirementsList', (requirements: Array<{title: string, description: string}>) => {
      if (!Array.isArray(requirements)) return '';
      
      return requirements.map(req => 
        `### ${req.title}\n\n${req.description}\n`
      ).join('\n');
    });

    this.handlebars.registerHelper('featureTable', (features: Array<{name: string, priority: string, complexity: string}>) => {
      if (!Array.isArray(features)) return '';
      
      let table = '| Feature | Priority | Complexity |\n|---------|----------|------------|\n';
      features.forEach(feature => {
        table += `| ${feature.name} | ${feature.priority} | ${feature.complexity} |\n`;
      });
      
      return new this.handlebars.SafeString(table);
    });

    this.handlebars.registerHelper('userStoryFormat', (story: {title: string, description: string, acceptanceCriteria: string[]}) => {
      if (!story) return '';
      
      let formatted = `**${story.title}**\n\n${story.description}\n\n**Acceptance Criteria:**\n`;
      if (Array.isArray(story.acceptanceCriteria)) {
        story.acceptanceCriteria.forEach((criteria, index) => {
          formatted += `${index + 1}. ${criteria}\n`;
        });
      }
      
      return new this.handlebars.SafeString(formatted);
    });

    logger.debug('Registered Handlebars helpers', { 
      helpersCount: Object.keys(this.handlebars.helpers).length 
    });
  }

  /**
   * Register Handlebars partials for reusable template components
   */
  private registerPartials(): void {
    const partials = {
      'header': `# {{title}}

**Generated:** {{formatDate metadata.generatedAt}}  
**Project:** {{metadata.projectName}}  
**Version:** {{metadata.version}}

---`,
      
      'footer': `---

*This document was automatically generated by the BMAD AI Planning Assistant on {{formatDate metadata.generatedAt}}.*`,
      
      'stakeholder-section': `## Stakeholders

{{#each stakeholders}}
- **{{name}}**: {{role}} - {{email}}
{{/each}}`,
      
      'requirements-section': `## Requirements

{{requirementsList requirements}}`,
      
      'features-section': `## Features

{{featureTable features}}`
    };

    Object.entries(partials).forEach(([name, template]) => {
      this.handlebars.registerPartial(name, template);
    });

    logger.debug('Registered Handlebars partials', { 
      partialsCount: Object.keys(partials).length 
    });
  }

  /**
   * Validate template syntax and structure
   */
  private async validateTemplate(template: DocumentTemplate): Promise<void> {
    try {
      // Try to compile the template to check for syntax errors
      this.handlebars.compile(template.template);
      
      // Validate template sections
      for (const section of template.sections) {
        this.handlebars.compile(section.template);
      }
      
    } catch (error) {
      throw new Error(`Template validation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Prepare variables for template processing
   */
  private async prepareTemplateVariables(
    template: DocumentTemplate,
    context: TemplateContext
  ): Promise<Record<string, any>> {
    
    const variables: Record<string, any> = {
      // Core context data
      ...context.workflowContext,
      ...context.documentData,
      
      // Agent outputs organized by phase
      agentOutputs: context.agentOutputs,
      
      // Document metadata
      metadata: context.metadata,
      
      // Template-specific variables with defaults
      ...this.applyVariableDefaults(template)
    };

    // Process nested object references
    return this.resolveVariableReferences(variables);
  }

  /**
   * Apply default values for template variables
   */
  private applyVariableDefaults(template: DocumentTemplate): Record<string, any> {
    const defaults: Record<string, any> = {};
    
    template.variables.forEach(variable => {
      if (variable.defaultValue !== undefined) {
        defaults[variable.name] = variable.defaultValue;
      }
    });
    
    return defaults;
  }

  /**
   * Resolve variable references and nested properties
   */
  private resolveVariableReferences(variables: Record<string, any>): Record<string, any> {
    // Deep clone to avoid mutations
    const resolved = JSON.parse(JSON.stringify(variables));
    
    // Add helper functions directly to context
    resolved.helpers = {
      formatCurrency: (amount: number) => `$${amount.toLocaleString()}`,
      formatPercentage: (value: number) => `${Math.round(value * 100)}%`,
      pluralize: (count: number, singular: string, plural?: string) => {
        return count === 1 ? singular : (plural || `${singular}s`);
      }
    };
    
    return resolved;
  }

  /**
   * Get compiled template with caching
   */
  private async getCompiledTemplate(template: DocumentTemplate): Promise<HandlebarsTemplateDelegate> {
    const cacheKey = `${template.id}_v${template.version}`;
    
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey)!;
    }
    
    const compiledTemplate = this.handlebars.compile(template.template);
    this.templateCache.set(cacheKey, compiledTemplate);
    
    logger.debug('Template compiled and cached', { 
      templateId: template.id,
      cacheSize: this.templateCache.size 
    });
    
    return compiledTemplate;
  }

  /**
   * Execute template with error handling
   */
  private async executeTemplate(
    compiledTemplate: HandlebarsTemplateDelegate,
    variables: Record<string, any>
  ): Promise<string> {
    
    try {
      return compiledTemplate(variables);
    } catch (error) {
      // Enhanced error reporting for template execution
      const errorMessage = (error as Error).message;
      
      // Try to extract helpful information from the error
      if (errorMessage.includes('Cannot read property')) {
        const match = errorMessage.match(/Cannot read property '([^']+)'/);
        const property = match ? match[1] : 'unknown';
        throw new Error(`Template variable '${property}' is undefined or null`);
      }
      
      throw new Error(`Template execution failed: ${errorMessage}`);
    }
  }

  /**
   * Validate template output
   */
  private async validateOutput(
    content: string,
    template: DocumentTemplate
  ): Promise<{warnings: string[]}> {
    
    const warnings: string[] = [];
    
    // Check for empty content
    if (!content.trim()) {
      warnings.push('Generated content is empty');
    }
    
    // Check for unresolved template variables
    const unresolvedVariables = content.match(/\{\{[^}]+\}\}/g);
    if (unresolvedVariables) {
      warnings.push(`Unresolved template variables: ${unresolvedVariables.join(', ')}`);
    }
    
    // Check minimum content length
    if (content.length < 100) {
      warnings.push('Generated content is unusually short');
    }
    
    // Check for common markdown issues
    if (content.includes('# ') && !content.startsWith('#')) {
      warnings.push('Document may be missing proper title structure');
    }
    
    return { warnings };
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear();
    this.helperCache.clear();
    logger.debug('Template cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {templateCacheSize: number, helperCacheSize: number} {
    return {
      templateCacheSize: this.templateCache.size,
      helperCacheSize: this.helperCache.size
    };
  }
}