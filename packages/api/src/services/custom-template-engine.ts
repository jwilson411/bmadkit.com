import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { subscriptionValidator, UserSubscriptionContext } from './subscription-validator';
import { featureFlagManager, FeatureFlag, UserTier } from './feature-flag-manager';

export interface CustomTemplate {
  templateId: string;
  userId: string;
  organizationId?: string;
  name: string;
  description?: string;
  category: 'personal' | 'team' | 'organization' | 'public';
  format: 'html' | 'markdown' | 'text' | 'xml' | 'latex';
  template: string; // Handlebars template content
  variables: TemplateVariable[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    version: string;
    author: string;
    tags: string[];
    usageCount: number;
    rating?: number;
    reviews?: number;
  };
  validation: {
    schema?: any; // JSON schema for data validation
    requiredFields: string[];
    optionalFields: string[];
    customValidators?: string[]; // Custom validation function names
  };
  permissions: {
    isPublic: boolean;
    isShared: boolean;
    sharedWith: string[];
    editPermissions: string[];
    viewPermissions: string[];
  };
  settings: {
    allowComments: boolean;
    allowForks: boolean;
    allowRatings: boolean;
    autoUpdate: boolean;
  };
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  description: string;
  required: boolean;
  defaultValue?: any;
  validation?: {
    pattern?: string; // regex pattern
    min?: number;
    max?: number;
    enum?: any[];
  };
  displayOptions?: {
    label: string;
    placeholder: string;
    helpText: string;
    inputType: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number';
    options?: Array<{ label: string; value: any }>;
  };
}

export interface TemplatePreview {
  templateId: string;
  previewHtml: string;
  previewUrl: string;
  sampleData: any;
  generatedAt: Date;
  expiresAt: Date;
}

export interface TemplateValidationResult {
  isValid: boolean;
  errors: Array<{
    type: 'syntax' | 'security' | 'performance' | 'data';
    message: string;
    line?: number;
    column?: number;
    severity: 'error' | 'warning' | 'info';
  }>;
  warnings: Array<{
    type: string;
    message: string;
    suggestion?: string;
  }>;
  performance: {
    renderTime: number;
    complexityScore: number;
    resourceUsage: string;
  };
  security: {
    hasUnsafeOperations: boolean;
    blockedHelpers: string[];
    sanitizationNeeded: string[];
  };
}

export interface TemplateLibrary {
  templates: CustomTemplate[];
  categories: string[];
  totalCount: number;
  featured: CustomTemplate[];
  recent: CustomTemplate[];
  popular: CustomTemplate[];
  userTemplates?: CustomTemplate[];
}

export interface TemplateRenderContext {
  templateId: string;
  userId: string;
  data: any;
  variables?: Record<string, any>;
  options?: {
    format: string;
    minify?: boolean;
    includeComments?: boolean;
    customHelpers?: Record<string, Function>;
  };
}

class CustomTemplateEngine extends EventEmitter {
  private templates: Map<string, CustomTemplate> = new Map();
  private compiledTemplates: Map<string, HandlebarsTemplateDelegate> = new Map();
  private templateCache: Map<string, { content: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 15; // 15 minutes
  private readonly MAX_TEMPLATE_SIZE = 1024 * 1024; // 1MB
  private readonly MAX_RENDER_TIME = 30000; // 30 seconds

  constructor() {
    super();
    this.setupSecurityHelpers();
    this.loadBuiltinTemplates();
  }

  async createTemplate(userId: string, templateData: Partial<CustomTemplate>): Promise<string> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      // Check template creation limits
      await this.validateTemplateCreationLimits(userContext);

      const templateId = this.generateTemplateId();
      const template: CustomTemplate = {
        templateId,
        userId,
        organizationId: userContext.organizationId,
        name: templateData.name || 'Untitled Template',
        description: templateData.description,
        category: templateData.category || 'personal',
        format: templateData.format || 'html',
        template: templateData.template || '',
        variables: templateData.variables || [],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          version: '1.0.0',
          author: userId,
          tags: templateData.metadata?.tags || [],
          usageCount: 0,
          ...templateData.metadata
        },
        validation: {
          requiredFields: [],
          optionalFields: [],
          ...templateData.validation
        },
        permissions: {
          isPublic: false,
          isShared: false,
          sharedWith: [],
          editPermissions: [userId],
          viewPermissions: [userId],
          ...templateData.permissions
        },
        settings: {
          allowComments: true,
          allowForks: true,
          allowRatings: true,
          autoUpdate: false,
          ...templateData.settings
        }
      };

      // Validate template syntax and security
      const validation = await this.validateTemplate(template);
      if (!validation.isValid) {
        throw new Error(`Template validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Save template
      await this.saveTemplate(template);
      this.templates.set(templateId, template);

      // Compile template for faster rendering
      try {
        const compiledTemplate = Handlebars.compile(template.template, {
          noEscape: template.format === 'html', // Escape by default except for HTML
          strict: true,
          assumeObjects: true
        });
        this.compiledTemplates.set(templateId, compiledTemplate);
      } catch (compileError) {
        console.warn(`Failed to precompile template ${templateId}:`, compileError);
      }

      this.emit('templateCreated', {
        userId,
        templateId,
        name: template.name,
        category: template.category,
        tier: userContext.tier
      });

      return templateId;

    } catch (error) {
      this.emit('templateCreationError', { userId, error: error.message });
      throw error;
    }
  }

  async updateTemplate(templateId: string, userId: string, updates: Partial<CustomTemplate>): Promise<void> {
    try {
      const template = await this.getTemplate(templateId, userId);
      if (!template) {
        throw new Error('Template not found or access denied');
      }

      // Check edit permissions
      if (!template.permissions.editPermissions.includes(userId) && template.userId !== userId) {
        throw new Error('Insufficient permissions to edit this template');
      }

      // Update template
      const updatedTemplate: CustomTemplate = {
        ...template,
        ...updates,
        templateId, // Ensure ID doesn't change
        userId: template.userId, // Ensure owner doesn't change
        metadata: {
          ...template.metadata,
          ...updates.metadata,
          updatedAt: new Date(),
          version: this.incrementVersion(template.metadata.version)
        }
      };

      // Validate updated template
      const validation = await this.validateTemplate(updatedTemplate);
      if (!validation.isValid) {
        throw new Error(`Template validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Save updated template
      await this.saveTemplate(updatedTemplate);
      this.templates.set(templateId, updatedTemplate);

      // Recompile template
      this.compiledTemplates.delete(templateId);
      try {
        const compiledTemplate = Handlebars.compile(updatedTemplate.template, {
          noEscape: updatedTemplate.format === 'html',
          strict: true,
          assumeObjects: true
        });
        this.compiledTemplates.set(templateId, compiledTemplate);
      } catch (compileError) {
        console.warn(`Failed to recompile template ${templateId}:`, compileError);
      }

      // Clear cache
      this.clearTemplateCache(templateId);

      this.emit('templateUpdated', {
        userId,
        templateId,
        version: updatedTemplate.metadata.version
      });

    } catch (error) {
      this.emit('templateUpdateError', { userId, templateId, error: error.message });
      throw error;
    }
  }

  async getTemplate(templateId: string, userId: string): Promise<CustomTemplate | null> {
    try {
      // Check cache first
      let template = this.templates.get(templateId);

      if (!template) {
        // Load from database
        template = await this.loadTemplate(templateId);
        if (template) {
          this.templates.set(templateId, template);
        }
      }

      if (!template) {
        return null;
      }

      // Check view permissions
      if (!await this.hasViewAccess(template, userId)) {
        return null;
      }

      return template;

    } catch (error) {
      this.emit('templateAccessError', { userId, templateId, error: error.message });
      return null;
    }
  }

  async renderTemplate(context: TemplateRenderContext): Promise<string> {
    const startTime = Date.now();

    try {
      const template = await this.getTemplate(context.templateId, context.userId);
      if (!template) {
        throw new Error('Template not found or access denied');
      }

      // Get or compile template
      let compiledTemplate = this.compiledTemplates.get(context.templateId);
      if (!compiledTemplate) {
        compiledTemplate = Handlebars.compile(template.template, {
          noEscape: template.format === 'html',
          strict: true,
          assumeObjects: true
        });
        this.compiledTemplates.set(context.templateId, compiledTemplate);
      }

      // Prepare render context
      const renderData = this.prepareRenderData(template, context.data, context.variables);

      // Add custom helpers if provided
      if (context.options?.customHelpers) {
        Object.entries(context.options.customHelpers).forEach(([name, helper]) => {
          Handlebars.registerHelper(name, helper);
        });
      }

      // Render with timeout
      const renderPromise = new Promise<string>((resolve, reject) => {
        try {
          const result = compiledTemplate!(renderData);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('Template render timeout')), this.MAX_RENDER_TIME);
      });

      const rendered = await Promise.race([renderPromise, timeoutPromise]);

      // Post-process if needed
      let finalResult = rendered;
      if (context.options?.minify && template.format === 'html') {
        finalResult = this.minifyHtml(rendered);
      }

      // Update usage count
      template.metadata.usageCount++;
      await this.saveTemplate(template);

      const renderTime = Date.now() - startTime;
      
      this.emit('templateRendered', {
        userId: context.userId,
        templateId: context.templateId,
        renderTime,
        outputLength: finalResult.length
      });

      return finalResult;

    } catch (error) {
      const renderTime = Date.now() - startTime;
      this.emit('templateRenderError', {
        userId: context.userId,
        templateId: context.templateId,
        error: error.message,
        renderTime
      });
      throw error;
    }
  }

  async previewTemplate(templateId: string, userId: string, sampleData?: any): Promise<TemplatePreview> {
    try {
      const template = await this.getTemplate(templateId, userId);
      if (!template) {
        throw new Error('Template not found or access denied');
      }

      // Generate sample data if not provided
      const data = sampleData || this.generateSampleData(template);

      // Render preview
      const previewHtml = await this.renderTemplate({
        templateId,
        userId,
        data,
        options: { format: template.format }
      });

      const preview: TemplatePreview = {
        templateId,
        previewHtml,
        previewUrl: `/api/templates/${templateId}/preview`,
        sampleData: data,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + this.CACHE_TTL)
      };

      // Cache preview
      this.templateCache.set(`preview_${templateId}`, {
        content: JSON.stringify(preview),
        timestamp: Date.now()
      });

      return preview;

    } catch (error) {
      this.emit('templatePreviewError', { userId, templateId, error: error.message });
      throw error;
    }
  }

  async validateTemplate(template: CustomTemplate): Promise<TemplateValidationResult> {
    const errors: TemplateValidationResult['errors'] = [];
    const warnings: TemplateValidationResult['warnings'] = [];
    const startTime = Date.now();

    try {
      // Size validation
      if (template.template.length > this.MAX_TEMPLATE_SIZE) {
        errors.push({
          type: 'syntax',
          message: `Template size exceeds maximum allowed size (${this.MAX_TEMPLATE_SIZE} bytes)`,
          severity: 'error'
        });
      }

      // Syntax validation
      try {
        Handlebars.compile(template.template, { strict: true });
      } catch (syntaxError) {
        errors.push({
          type: 'syntax',
          message: `Template syntax error: ${syntaxError.message}`,
          severity: 'error'
        });
      }

      // Security validation
      const securityResult = this.validateTemplateSecurity(template.template);
      if (securityResult.hasUnsafeOperations) {
        errors.push({
          type: 'security',
          message: 'Template contains potentially unsafe operations',
          severity: 'error'
        });
      }

      securityResult.blockedHelpers.forEach(helper => {
        errors.push({
          type: 'security',
          message: `Blocked helper detected: ${helper}`,
          severity: 'error'
        });
      });

      // Performance validation
      const complexityScore = this.calculateComplexityScore(template.template);
      if (complexityScore > 100) {
        warnings.push({
          type: 'performance',
          message: 'Template complexity is high and may impact render performance',
          suggestion: 'Consider simplifying template logic or breaking into smaller templates'
        });
      }

      // Variable validation
      const missingVariables = this.validateTemplateVariables(template);
      missingVariables.forEach(variable => {
        warnings.push({
          type: 'data',
          message: `Template references undefined variable: ${variable}`,
          suggestion: 'Add variable definition or provide default value'
        });
      });

      const renderTime = Date.now() - startTime;

      const result: TemplateValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        performance: {
          renderTime,
          complexityScore,
          resourceUsage: this.assessResourceUsage(template.template)
        },
        security: securityResult
      };

      return result;

    } catch (error) {
      return {
        isValid: false,
        errors: [{
          type: 'syntax',
          message: `Validation error: ${error.message}`,
          severity: 'error'
        }],
        warnings: [],
        performance: {
          renderTime: Date.now() - startTime,
          complexityScore: 0,
          resourceUsage: 'unknown'
        },
        security: {
          hasUnsafeOperations: true,
          blockedHelpers: [],
          sanitizationNeeded: []
        }
      };
    }
  }

  async getTemplateLibrary(userId: string, options: {
    category?: string;
    search?: string;
    sortBy?: 'name' | 'created' | 'updated' | 'usage' | 'rating';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  } = {}): Promise<TemplateLibrary> {
    try {
      const userContext = await subscriptionValidator.validateUserSubscription(userId);
      
      // Get accessible templates
      const allTemplates = await this.getAccessibleTemplates(userId, userContext);
      
      // Filter by category
      let filteredTemplates = allTemplates;
      if (options.category) {
        filteredTemplates = filteredTemplates.filter(t => t.category === options.category);
      }

      // Search filter
      if (options.search) {
        const searchLower = options.search.toLowerCase();
        filteredTemplates = filteredTemplates.filter(t =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.metadata.tags.some(tag => tag.toLowerCase().includes(searchLower))
        );
      }

      // Sort templates
      const sortBy = options.sortBy || 'updated';
      const sortOrder = options.sortOrder || 'desc';
      filteredTemplates.sort((a, b) => {
        let comparison = 0;
        
        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'created':
            comparison = a.metadata.createdAt.getTime() - b.metadata.createdAt.getTime();
            break;
          case 'updated':
            comparison = a.metadata.updatedAt.getTime() - b.metadata.updatedAt.getTime();
            break;
          case 'usage':
            comparison = a.metadata.usageCount - b.metadata.usageCount;
            break;
          case 'rating':
            comparison = (a.metadata.rating || 0) - (b.metadata.rating || 0);
            break;
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });

      // Pagination
      const page = options.page || 1;
      const limit = options.limit || 20;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedTemplates = filteredTemplates.slice(startIndex, endIndex);

      // Get categories
      const categories = Array.from(new Set(allTemplates.map(t => t.category)));

      // Get featured, recent, and popular templates
      const featured = allTemplates
        .filter(t => t.metadata.rating && t.metadata.rating >= 4.5)
        .slice(0, 5);
      
      const recent = allTemplates
        .sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime())
        .slice(0, 10);
      
      const popular = allTemplates
        .sort((a, b) => b.metadata.usageCount - a.metadata.usageCount)
        .slice(0, 10);

      // Get user's own templates
      const userTemplates = allTemplates.filter(t => t.userId === userId);

      return {
        templates: paginatedTemplates,
        categories,
        totalCount: filteredTemplates.length,
        featured,
        recent,
        popular,
        userTemplates
      };

    } catch (error) {
      this.emit('templateLibraryError', { userId, error: error.message });
      throw error;
    }
  }

  // Private helper methods

  private async validateTemplateCreationLimits(userContext: UserSubscriptionContext): Promise<void> {
    const userTemplateCount = await this.getUserTemplateCount(userContext.userId);
    
    let maxTemplates = 5; // Free tier
    if (userContext.tier === UserTier.EMAIL_CAPTURED) {
      maxTemplates = 10;
    } else if (userContext.tier === UserTier.PREMIUM) {
      maxTemplates = 100;
    } else if (userContext.tier === UserTier.ENTERPRISE) {
      maxTemplates = 1000;
    }

    if (userTemplateCount >= maxTemplates) {
      throw new Error(`Template limit reached. Your tier allows up to ${maxTemplates} custom templates.`);
    }
  }

  private setupSecurityHelpers(): void {
    // Register safe helpers
    const safeHelpers = {
      'eq': (a: any, b: any) => a === b,
      'ne': (a: any, b: any) => a !== b,
      'lt': (a: any, b: any) => a < b,
      'gt': (a: any, b: any) => a > b,
      'and': (a: any, b: any) => a && b,
      'or': (a: any, b: any) => a || b,
      'not': (a: any) => !a,
      'length': (arr: any[]) => Array.isArray(arr) ? arr.length : 0,
      'uppercase': (str: string) => String(str).toUpperCase(),
      'lowercase': (str: string) => String(str).toLowerCase(),
      'truncate': (str: string, length: number) => String(str).substring(0, length),
      'date': (date: string | Date, format?: string) => {
        const d = new Date(date);
        return format === 'iso' ? d.toISOString() : d.toLocaleDateString();
      }
    };

    Object.entries(safeHelpers).forEach(([name, helper]) => {
      Handlebars.registerHelper(name, helper);
    });
  }

  private async loadBuiltinTemplates(): Promise<void> {
    // Load built-in templates
    const builtinTemplates = [
      {
        templateId: 'builtin_basic_report',
        name: 'Basic Report',
        category: 'public',
        format: 'html',
        template: `
<html>
<head><title>{{title}}</title></head>
<body>
  <h1>{{title}}</h1>
  <p>Generated on {{date generatedAt}}</p>
  {{#each sections}}
    <section>
      <h2>{{title}}</h2>
      <div>{{content}}</div>
    </section>
  {{/each}}
</body>
</html>`,
        variables: [
          { name: 'title', type: 'string', description: 'Report title', required: true },
          { name: 'generatedAt', type: 'date', description: 'Generation date', required: true },
          { name: 'sections', type: 'array', description: 'Report sections', required: true }
        ]
      }
    ];

    // Register built-in templates
    for (const templateData of builtinTemplates) {
      const template: CustomTemplate = {
        ...templateData,
        userId: 'system',
        description: 'Built-in template',
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          version: '1.0.0',
          author: 'system',
          tags: ['builtin'],
          usageCount: 0
        },
        validation: {
          requiredFields: templateData.variables?.filter(v => v.required).map(v => v.name) || [],
          optionalFields: templateData.variables?.filter(v => !v.required).map(v => v.name) || []
        },
        permissions: {
          isPublic: true,
          isShared: true,
          sharedWith: [],
          editPermissions: [],
          viewPermissions: ['*'] // Everyone can view
        },
        settings: {
          allowComments: false,
          allowForks: true,
          allowRatings: false,
          autoUpdate: false
        }
      } as CustomTemplate;

      this.templates.set(templateData.templateId, template);
    }
  }

  private validateTemplateSecurity(templateContent: string): {
    hasUnsafeOperations: boolean;
    blockedHelpers: string[];
    sanitizationNeeded: string[];
  } {
    const blockedHelpers = ['eval', 'require', 'import', 'process', 'global'];
    const unsafePatterns = [
      /\{\{\{\s*.*\s*\}\}\}/g, // Triple braces (unescaped)
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
      /javascript:/gi, // JavaScript protocol
      /on\w+\s*=/gi // Event handlers
    ];

    const foundBlockedHelpers = blockedHelpers.filter(helper =>
      templateContent.includes(`{{${helper}`) || templateContent.includes(`{{#${helper}`)
    );

    const hasUnsafePatterns = unsafePatterns.some(pattern => pattern.test(templateContent));

    const sanitizationNeeded: string[] = [];
    if (templateContent.includes('{{{')) {
      sanitizationNeeded.push('Unescaped output detected');
    }
    if (/<script/i.test(templateContent)) {
      sanitizationNeeded.push('Script tags detected');
    }

    return {
      hasUnsafeOperations: hasUnsafePatterns || foundBlockedHelpers.length > 0,
      blockedHelpers: foundBlockedHelpers,
      sanitizationNeeded
    };
  }

  private calculateComplexityScore(templateContent: string): number {
    let score = 0;
    
    // Count loops
    score += (templateContent.match(/\{\{#each/g) || []).length * 10;
    
    // Count conditionals
    score += (templateContent.match(/\{\{#if/g) || []).length * 5;
    
    // Count helper calls
    score += (templateContent.match(/\{\{[\w-]+\s+/g) || []).length * 2;
    
    // Count variables
    score += (templateContent.match(/\{\{[^#\/]/g) || []).length;

    return score;
  }

  private validateTemplateVariables(template: CustomTemplate): string[] {
    const definedVariables = new Set(template.variables.map(v => v.name));
    const usedVariables = new Set<string>();
    
    // Extract variable names from template
    const variablePattern = /\{\{\s*([^}\s#\/][^}\s]*)\s*\}\}/g;
    let match;
    
    while ((match = variablePattern.exec(template.template)) !== null) {
      const variableName = match[1].split(' ')[0]; // Get first word (variable name)
      if (!this.isBuiltinHelper(variableName)) {
        usedVariables.add(variableName);
      }
    }

    return Array.from(usedVariables).filter(varName => !definedVariables.has(varName));
  }

  private isBuiltinHelper(name: string): boolean {
    const builtinHelpers = ['if', 'unless', 'each', 'with', 'lookup', 'log', 'eq', 'ne', 'lt', 'gt'];
    return builtinHelpers.includes(name);
  }

  private assessResourceUsage(templateContent: string): string {
    const length = templateContent.length;
    const complexity = this.calculateComplexityScore(templateContent);
    
    if (length < 1000 && complexity < 20) return 'low';
    if (length < 10000 && complexity < 50) return 'medium';
    return 'high';
  }

  private prepareRenderData(template: CustomTemplate, data: any, variables?: Record<string, any>): any {
    const renderData = { ...data };

    // Apply variable defaults and validation
    for (const variable of template.variables) {
      const value = variables?.[variable.name] ?? data[variable.name] ?? variable.defaultValue;
      
      if (variable.required && (value === undefined || value === null)) {
        throw new Error(`Required variable '${variable.name}' is missing`);
      }
      
      if (value !== undefined) {
        renderData[variable.name] = this.validateAndCoerceValue(value, variable);
      }
    }

    return renderData;
  }

  private validateAndCoerceValue(value: any, variable: TemplateVariable): any {
    switch (variable.type) {
      case 'string':
        return String(value);
      case 'number':
        const num = Number(value);
        if (isNaN(num)) throw new Error(`Variable '${variable.name}' must be a number`);
        return num;
      case 'boolean':
        return Boolean(value);
      case 'date':
        const date = new Date(value);
        if (isNaN(date.getTime())) throw new Error(`Variable '${variable.name}' must be a valid date`);
        return date;
      case 'array':
        if (!Array.isArray(value)) throw new Error(`Variable '${variable.name}' must be an array`);
        return value;
      case 'object':
        if (typeof value !== 'object') throw new Error(`Variable '${variable.name}' must be an object`);
        return value;
      default:
        return value;
    }
  }

  private generateSampleData(template: CustomTemplate): any {
    const sampleData: any = {};

    for (const variable of template.variables) {
      switch (variable.type) {
        case 'string':
          sampleData[variable.name] = `Sample ${variable.name}`;
          break;
        case 'number':
          sampleData[variable.name] = 42;
          break;
        case 'boolean':
          sampleData[variable.name] = true;
          break;
        case 'date':
          sampleData[variable.name] = new Date();
          break;
        case 'array':
          sampleData[variable.name] = [`Sample item 1`, `Sample item 2`];
          break;
        case 'object':
          sampleData[variable.name] = { key: 'value' };
          break;
        default:
          sampleData[variable.name] = variable.defaultValue || null;
      }
    }

    return sampleData;
  }

  private async hasViewAccess(template: CustomTemplate, userId: string): Promise<boolean> {
    // System templates are public
    if (template.userId === 'system') return true;
    
    // Owner can always view
    if (template.userId === userId) return true;
    
    // Public templates
    if (template.permissions.isPublic) return true;
    
    // Explicitly shared
    if (template.permissions.viewPermissions.includes('*')) return true;
    if (template.permissions.viewPermissions.includes(userId)) return true;
    if (template.permissions.sharedWith.includes(userId)) return true;

    return false;
  }

  private minifyHtml(html: string): string {
    // Basic HTML minification
    return html
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2]++;
    return parts.join('.');
  }

  private clearTemplateCache(templateId: string): void {
    const keysToDelete = Array.from(this.templateCache.keys())
      .filter(key => key.includes(templateId));
    
    keysToDelete.forEach(key => this.templateCache.delete(key));
  }

  private generateTemplateId(): string {
    return `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Database operations (would be implemented with your chosen database)
  private async saveTemplate(template: CustomTemplate): Promise<void> {
    // Save to database
  }

  private async loadTemplate(templateId: string): Promise<CustomTemplate | null> {
    // Load from database
    return null;
  }

  private async getUserTemplateCount(userId: string): Promise<number> {
    // Count user templates from database
    return 0;
  }

  private async getAccessibleTemplates(userId: string, userContext: UserSubscriptionContext): Promise<CustomTemplate[]> {
    // Get templates user can access from database
    return Array.from(this.templates.values()).filter(template => 
      this.hasViewAccess(template, userId)
    );
  }
}

export const customTemplateEngine = new CustomTemplateEngine();