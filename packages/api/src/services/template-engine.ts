import Handlebars from 'handlebars';
import { 
  AgentPrompt, 
  PromptExecutionContext, 
  TemplateVariable 
} from '../models/agent-prompt.ts';
import { logger } from '../utils/logger.ts';

export interface TemplateCompilationOptions {
  strict?: boolean;
  noEscape?: boolean;
  preventIndent?: boolean;
  explicitPartialContext?: boolean;
}

export interface TemplateExecutionContext {
  variables: Record<string, any>;
  partials?: Record<string, string>;
  helpers?: Record<string, Handlebars.HelperDelegate>;
}

export interface CompiledTemplate {
  id: string;
  template: HandlebarsTemplateDelegate;
  originalTemplate: string;
  compiledAt: Date;
  variables: TemplateVariable[];
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{
    type: 'missing_variable' | 'invalid_syntax' | 'undefined_helper' | 'security_violation';
    message: string;
    variable?: string;
    line?: number;
    column?: number;
  }>;
  warnings: Array<{
    type: 'unused_variable' | 'deprecated_helper' | 'performance_issue';
    message: string;
    suggestion?: string;
  }>;
  usedVariables: string[];
  usedHelpers: string[];
}

export class TemplateEngineError extends Error {
  constructor(
    message: string,
    public code: string,
    public templateId?: string,
    public context?: any
  ) {
    super(message);
    this.name = 'TemplateEngineError';
  }
}

export class TemplateEngine {
  private compiledTemplates: Map<string, CompiledTemplate>;
  private handlebarsInstance: typeof Handlebars;
  private securityConfig: {
    allowCodeExecution: boolean;
    allowFileSystem: boolean;
    maxRecursionDepth: number;
    maxIterations: number;
  };

  constructor() {
    this.compiledTemplates = new Map();
    this.handlebarsInstance = Handlebars.create();
    
    this.securityConfig = {
      allowCodeExecution: false,
      allowFileSystem: false,
      maxRecursionDepth: 10,
      maxIterations: 1000,
    };

    this.registerBuiltinHelpers();
    this.setupSecurityMeasures();
  }

  /**
   * Compile a template with caching
   */
  async compileTemplate(
    templateId: string,
    templateString: string,
    variables: TemplateVariable[] = [],
    options: TemplateCompilationOptions = {}
  ): Promise<CompiledTemplate> {
    try {
      // Check if already compiled and cached
      const existing = this.compiledTemplates.get(templateId);
      if (existing && existing.originalTemplate === templateString) {
        return existing;
      }

      // Validate template syntax
      this.validateTemplateSyntax(templateString);

      // Compile with Handlebars
      const template = this.handlebarsInstance.compile(templateString, {
        strict: options.strict ?? false,
        noEscape: options.noEscape ?? false,
        preventIndent: options.preventIndent ?? false,
        explicitPartialContext: options.explicitPartialContext ?? false,
      });

      const compiled: CompiledTemplate = {
        id: templateId,
        template,
        originalTemplate: templateString,
        compiledAt: new Date(),
        variables,
      };

      this.compiledTemplates.set(templateId, compiled);

      logger.debug('Template compiled successfully', {
        templateId,
        variableCount: variables.length,
        templateLength: templateString.length
      });

      return compiled;
    } catch (error) {
      logger.error('Template compilation failed', {
        templateId,
        error: error instanceof Error ? error.message : String(error)
      });

      throw new TemplateEngineError(
        `Failed to compile template: ${error instanceof Error ? error.message : String(error)}`,
        'COMPILATION_ERROR',
        templateId,
        { originalError: error }
      );
    }
  }

  /**
   * Execute a compiled template with context
   */
  async executeTemplate(
    templateId: string,
    context: TemplateExecutionContext
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const compiled = this.compiledTemplates.get(templateId);
      if (!compiled) {
        throw new TemplateEngineError(
          `Template not found: ${templateId}`,
          'TEMPLATE_NOT_FOUND',
          templateId
        );
      }

      // Validate context against template variables
      this.validateExecutionContext(compiled, context);

      // Register any custom helpers for this execution
      if (context.helpers) {
        this.registerTemporaryHelpers(context.helpers);
      }

      // Register partials if provided
      if (context.partials) {
        this.registerPartials(context.partials);
      }

      // Execute template
      const result = compiled.template(context.variables, {
        helpers: context.helpers,
        partials: context.partials,
      });

      const executionTime = Date.now() - startTime;

      logger.debug('Template executed successfully', {
        templateId,
        executionTime,
        resultLength: result.length,
        variableCount: Object.keys(context.variables).length
      });

      return result;
    } catch (error) {
      logger.error('Template execution failed', {
        templateId,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      });

      if (error instanceof TemplateEngineError) {
        throw error;
      }

      throw new TemplateEngineError(
        `Template execution failed: ${error instanceof Error ? error.message : String(error)}`,
        'EXECUTION_ERROR',
        templateId,
        { context, originalError: error }
      );
    }
  }

  /**
   * Process agent prompt template with context
   */
  async processAgentPrompt(
    prompt: AgentPrompt,
    executionContext: PromptExecutionContext
  ): Promise<string> {
    const templateId = `${prompt.agent_type}_${prompt.version}`;
    
    // Compile the user prompt template
    const compiled = await this.compileTemplate(
      templateId,
      prompt.user_prompt_template,
      prompt.template_variables
    );

    // Prepare template context from execution context
    const templateContext = this.preparePromptContext(prompt, executionContext);

    // Execute template
    return this.executeTemplate(templateId, {
      variables: templateContext,
      helpers: this.getPromptHelpers(),
      partials: this.getPromptPartials(),
    });
  }

  /**
   * Validate template against variables and context
   */
  async validateTemplate(
    templateString: string,
    variables: TemplateVariable[],
    sampleContext?: Record<string, any>
  ): Promise<TemplateValidationResult> {
    const result: TemplateValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      usedVariables: [],
      usedHelpers: [],
    };

    try {
      // Extract variables used in template
      const usedVariables = this.extractVariablesFromTemplate(templateString);
      const usedHelpers = this.extractHelpersFromTemplate(templateString);

      result.usedVariables = usedVariables;
      result.usedHelpers = usedHelpers;

      // Check for missing required variables
      const requiredVariables = variables.filter(v => v.required).map(v => v.name);
      const missingRequired = requiredVariables.filter(v => !usedVariables.includes(v));
      
      if (missingRequired.length > 0) {
        result.errors.push({
          type: 'missing_variable',
          message: `Required variables not used in template: ${missingRequired.join(', ')}`
        });
        result.valid = false;
      }

      // Check for undefined variables
      const definedVariables = variables.map(v => v.name);
      const undefinedVariables = usedVariables.filter(v => !definedVariables.includes(v));
      
      if (undefinedVariables.length > 0) {
        result.errors.push({
          type: 'missing_variable',
          message: `Undefined variables used in template: ${undefinedVariables.join(', ')}`
        });
        result.valid = false;
      }

      // Check for unused variables
      const unusedVariables = definedVariables.filter(v => !usedVariables.includes(v) && !variables.find(vv => vv.name === v)?.required);
      if (unusedVariables.length > 0) {
        result.warnings.push({
          type: 'unused_variable',
          message: `Variables defined but not used: ${unusedVariables.join(', ')}`,
          suggestion: 'Consider removing unused variables or adding them to the template'
        });
      }

      // Validate syntax by attempting compilation
      try {
        this.handlebarsInstance.compile(templateString);
      } catch (syntaxError) {
        result.errors.push({
          type: 'invalid_syntax',
          message: `Template syntax error: ${syntaxError instanceof Error ? syntaxError.message : String(syntaxError)}`
        });
        result.valid = false;
      }

      // Test execution if sample context provided
      if (sampleContext && result.valid) {
        try {
          const testTemplate = this.handlebarsInstance.compile(templateString);
          testTemplate(sampleContext);
        } catch (executionError) {
          result.warnings.push({
            type: 'performance_issue',
            message: `Template may fail with provided sample context: ${executionError instanceof Error ? executionError.message : String(executionError)}`
          });
        }
      }

    } catch (error) {
      result.errors.push({
        type: 'invalid_syntax',
        message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
      });
      result.valid = false;
    }

    return result;
  }

  /**
   * Get template compilation cache statistics
   */
  getCacheStats(): {
    size: number;
    templates: Array<{ id: string; compiledAt: Date; variableCount: number }>;
  } {
    return {
      size: this.compiledTemplates.size,
      templates: Array.from(this.compiledTemplates.entries()).map(([id, template]) => ({
        id,
        compiledAt: template.compiledAt,
        variableCount: template.variables.length,
      })),
    };
  }

  /**
   * Clear template cache
   */
  clearCache(templateId?: string): void {
    if (templateId) {
      this.compiledTemplates.delete(templateId);
    } else {
      this.compiledTemplates.clear();
    }
  }

  // Private helper methods

  private validateTemplateSyntax(template: string): void {
    // Basic security checks
    const dangerousPatterns = [
      /\{\{\{.*eval.*\}\}\}/gi,
      /\{\{\{.*function.*\}\}\}/gi,
      /\{\{\{.*constructor.*\}\}\}/gi,
      /\{\{\{.*prototype.*\}\}\}/gi,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(template)) {
        throw new TemplateEngineError(
          'Template contains potentially dangerous code execution patterns',
          'SECURITY_VIOLATION'
        );
      }
    }
  }

  private validateExecutionContext(compiled: CompiledTemplate, context: TemplateExecutionContext): void {
    // Check required variables
    const requiredVariables = compiled.variables.filter(v => v.required);
    const missingRequired = requiredVariables.filter(v => !(v.name in context.variables));

    if (missingRequired.length > 0) {
      throw new TemplateEngineError(
        `Missing required variables: ${missingRequired.map(v => v.name).join(', ')}`,
        'MISSING_REQUIRED_VARIABLES',
        compiled.id,
        { missingVariables: missingRequired.map(v => v.name) }
      );
    }

    // Validate variable types
    for (const variable of compiled.variables) {
      const value = context.variables[variable.name];
      if (value !== undefined && value !== null) {
        if (!this.validateVariableType(value, variable)) {
          throw new TemplateEngineError(
            `Variable '${variable.name}' has invalid type. Expected: ${variable.type}, Got: ${typeof value}`,
            'INVALID_VARIABLE_TYPE',
            compiled.id,
            { variable: variable.name, expectedType: variable.type, actualType: typeof value }
          );
        }
      }
    }
  }

  private validateVariableType(value: any, variable: TemplateVariable): boolean {
    switch (variable.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true; // Unknown type, allow it
    }
  }

  private preparePromptContext(prompt: AgentPrompt, executionContext: PromptExecutionContext): Record<string, any> {
    const context: Record<string, any> = {
      // Session data
      project_input: executionContext.session_data.project_input,
      session_id: executionContext.session_id,
      user_id: executionContext.user_id,
      current_phase: executionContext.session_data.current_phase,
      
      // Agent context
      agent_type: prompt.agent_type,
      iteration_count: executionContext.agent_context.iteration_count || 1,
      previous_agent_output: executionContext.agent_context.previous_agent_output,
      
      // User preferences
      user_preferences: executionContext.session_data.user_preferences || {},
      
      // Runtime variables
      ...executionContext.runtime_variables,
    };

    // Add default values for undefined variables
    for (const variable of prompt.template_variables) {
      if (!(variable.name in context) && variable.default !== undefined) {
        context[variable.name] = variable.default;
      }
    }

    return context;
  }

  private extractVariablesFromTemplate(template: string): string[] {
    const variableRegex = /\{\{\{?\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\}?\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variableRegex.exec(template)) !== null) {
      variables.add(match[1].split('.')[0]); // Get root variable name
    }

    return Array.from(variables);
  }

  private extractHelpersFromTemplate(template: string): string[] {
    const helperRegex = /\{\{\{?\s*#([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const helpers = new Set<string>();
    let match;

    while ((match = helperRegex.exec(template)) !== null) {
      helpers.add(match[1]);
    }

    return Array.from(helpers);
  }

  private registerBuiltinHelpers(): void {
    // Conditional helpers
    this.handlebarsInstance.registerHelper('eq', function(a: any, b: any) {
      return a === b;
    });

    this.handlebarsInstance.registerHelper('ne', function(a: any, b: any) {
      return a !== b;
    });

    this.handlebarsInstance.registerHelper('gt', function(a: any, b: any) {
      return a > b;
    });

    this.handlebarsInstance.registerHelper('lt', function(a: any, b: any) {
      return a < b;
    });

    // String helpers
    this.handlebarsInstance.registerHelper('capitalize', function(str: string) {
      return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
    });

    this.handlebarsInstance.registerHelper('uppercase', function(str: string) {
      return str ? str.toUpperCase() : '';
    });

    this.handlebarsInstance.registerHelper('lowercase', function(str: string) {
      return str ? str.toLowerCase() : '';
    });

    // Array helpers
    this.handlebarsInstance.registerHelper('length', function(array: any[]) {
      return Array.isArray(array) ? array.length : 0;
    });

    this.handlebarsInstance.registerHelper('join', function(array: any[], separator: string = ', ') {
      return Array.isArray(array) ? array.join(separator) : '';
    });

    // Date helpers
    this.handlebarsInstance.registerHelper('now', function() {
      return new Date().toISOString();
    });

    this.handlebarsInstance.registerHelper('formatDate', function(date: string | Date, format: string = 'short') {
      const d = date instanceof Date ? date : new Date(date);
      switch (format) {
        case 'short':
          return d.toLocaleDateString();
        case 'long':
          return d.toLocaleDateString('en-US', { 
            year: 'numeric', month: 'long', day: 'numeric' 
          });
        case 'time':
          return d.toLocaleTimeString();
        default:
          return d.toISOString();
      }
    });
  }

  private getPromptHelpers(): Record<string, Handlebars.HelperDelegate> {
    return {
      // Agent-specific helpers can be added here
      'agentName': function(agentType: string) {
        const names: Record<string, string> = {
          'ANALYST': 'Business Analyst',
          'PM': 'Product Manager',
          'UX_EXPERT': 'UX Expert',
          'ARCHITECT': 'Technical Architect',
        };
        return names[agentType] || agentType;
      },
    };
  }

  private getPromptPartials(): Record<string, string> {
    return {
      // Common prompt partials
      'userContext': `
**User Information:**
{{#if user_id}}User ID: {{user_id}}{{/if}}
{{#if user_preferences}}
**Preferences:**
{{#each user_preferences}}
- {{@key}}: {{this}}
{{/each}}
{{/if}}
      `.trim(),
    };
  }

  private registerTemporaryHelpers(helpers: Record<string, Handlebars.HelperDelegate>): void {
    for (const [name, helper] of Object.entries(helpers)) {
      this.handlebarsInstance.registerHelper(name, helper);
    }
  }

  private registerPartials(partials: Record<string, string>): void {
    for (const [name, template] of Object.entries(partials)) {
      this.handlebarsInstance.registerPartial(name, template);
    }
  }

  private setupSecurityMeasures(): void {
    // Override potentially dangerous helpers
    this.handlebarsInstance.registerHelper('eval', function() {
      throw new TemplateEngineError('eval helper is not allowed for security reasons', 'SECURITY_VIOLATION');
    });

    this.handlebarsInstance.registerHelper('require', function() {
      throw new TemplateEngineError('require helper is not allowed for security reasons', 'SECURITY_VIOLATION');
    });
  }
}

// Export singleton instance
export const templateEngine = new TemplateEngine();