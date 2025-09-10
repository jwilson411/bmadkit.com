import { 
  AgentPrompt, 
  AgentPromptSchema,
  PromptValidationResult,
  PromptValidationResultSchema,
  AgentType 
} from '../models/agent-prompt.ts';
import { templateEngine } from './template-engine.ts';
import { logger } from '../utils/logger.ts';

export interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  validate: (prompt: AgentPrompt) => ValidationIssue[];
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
  value?: any;
}

export interface ValidationConfig {
  enableSemanticValidation: boolean;
  enableTemplateValidation: boolean;
  enableContentQualityChecks: boolean;
  strictMode: boolean;
  customRules: ValidationRule[];
}

export class PromptValidatorError extends Error {
  constructor(
    message: string,
    public code: string,
    public validationResult?: PromptValidationResult
  ) {
    super(message);
    this.name = 'PromptValidatorError';
  }
}

export class PromptValidator {
  private config: ValidationConfig;
  private builtinRules: ValidationRule[];

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = {
      enableSemanticValidation: true,
      enableTemplateValidation: true,
      enableContentQualityChecks: true,
      strictMode: false,
      customRules: [],
      ...config
    };

    this.builtinRules = this.createBuiltinRules();
  }

  /**
   * Validate a complete agent prompt
   */
  async validatePrompt(prompt: any): Promise<PromptValidationResult> {
    const result: PromptValidationResult = {
      valid: true,
      version: prompt?.version || 'unknown',
      agent_type: prompt?.agent_type || 'UNKNOWN' as AgentType,
      errors: [],
      warnings: [],
      metrics: {
        completeness_score: 0,
        complexity_score: 0,
        template_variables_count: 0,
        question_templates_count: 0,
        handoff_procedures_count: 0,
      },
      recommendations: [],
    };

    try {
      // 1. Schema validation
      await this.validateSchema(prompt, result);

      // 2. Semantic validation
      if (this.config.enableSemanticValidation && result.valid) {
        await this.validateSemantics(prompt, result);
      }

      // 3. Template validation
      if (this.config.enableTemplateValidation && result.valid) {
        await this.validateTemplates(prompt, result);
      }

      // 4. Content quality checks
      if (this.config.enableContentQualityChecks) {
        await this.validateContentQuality(prompt, result);
      }

      // 5. Apply custom rules
      await this.applyCustomRules(prompt, result);

      // 6. Calculate metrics
      this.calculateMetrics(prompt, result);

      // 7. Generate recommendations
      this.generateRecommendations(prompt, result);

      // Final validation status
      result.valid = result.errors.length === 0;

      logger.debug('Prompt validation completed', {
        agentType: result.agent_type,
        version: result.version,
        valid: result.valid,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        completenessScore: result.metrics.completeness_score
      });

    } catch (error) {
      logger.error('Prompt validation failed', {
        agentType: prompt?.agent_type,
        version: prompt?.version,
        error: error instanceof Error ? error.message : String(error)
      });

      result.valid = false;
      result.errors.push({
        field: 'validation',
        message: `Validation process failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
      });
    }

    return result;
  }

  /**
   * Validate multiple prompts
   */
  async validatePrompts(prompts: any[]): Promise<Map<string, PromptValidationResult>> {
    const results = new Map<string, PromptValidationResult>();

    const validationPromises = prompts.map(async (prompt) => {
      const key = `${prompt?.agent_type || 'unknown'}_${prompt?.version || 'unknown'}`;
      try {
        const result = await this.validatePrompt(prompt);
        results.set(key, result);
      } catch (error) {
        logger.error('Failed to validate prompt', { key, error });
        results.set(key, {
          valid: false,
          version: prompt?.version || 'unknown',
          agent_type: prompt?.agent_type || 'UNKNOWN' as AgentType,
          errors: [{
            field: 'validation',
            message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'error',
          }],
          warnings: [],
          metrics: {
            completeness_score: 0,
            complexity_score: 0,
            template_variables_count: 0,
            question_templates_count: 0,
            handoff_procedures_count: 0,
          },
          recommendations: [],
        });
      }
    });

    await Promise.all(validationPromises);

    logger.info('Batch prompt validation completed', {
      totalPrompts: prompts.length,
      validPrompts: Array.from(results.values()).filter(r => r.valid).length,
      invalidPrompts: Array.from(results.values()).filter(r => !r.valid).length,
    });

    return results;
  }

  /**
   * Validate prompt completeness against requirements
   */
  async validateCompleteness(prompt: AgentPrompt): Promise<{
    score: number;
    missing: string[];
    optional: string[];
  }> {
    const required = [
      'identity.role',
      'identity.expertise',
      'system_prompt',
      'user_prompt_template',
      'output_format',
      'handoff_procedures',
    ];

    const optional = [
      'identity.communication_style',
      'identity.personality_traits',
      'question_templates',
      'error_handling',
      'test_cases',
    ];

    const missing = required.filter(field => !this.hasField(prompt, field));
    const missingOptional = optional.filter(field => !this.hasField(prompt, field));

    const score = Math.round(((required.length - missing.length) / required.length) * 100);

    return {
      score,
      missing,
      optional: missingOptional,
    };
  }

  /**
   * Add custom validation rule
   */
  addRule(rule: ValidationRule): void {
    this.config.customRules.push(rule);
  }

  /**
   * Remove custom validation rule
   */
  removeRule(ruleName: string): void {
    this.config.customRules = this.config.customRules.filter(rule => rule.name !== ruleName);
  }

  /**
   * Get all validation rules (builtin + custom)
   */
  getRules(): ValidationRule[] {
    return [...this.builtinRules, ...this.config.customRules];
  }

  // Private validation methods

  private async validateSchema(prompt: any, result: PromptValidationResult): Promise<void> {
    try {
      AgentPromptSchema.parse(prompt);
    } catch (error: any) {
      result.valid = false;
      
      if (error.errors) {
        for (const err of error.errors) {
          result.errors.push({
            field: err.path.join('.'),
            message: err.message,
            severity: 'error',
            suggestion: this.getSuggestionForSchemaError(err),
          });
        }
      } else {
        result.errors.push({
          field: 'schema',
          message: `Schema validation failed: ${error.message}`,
          severity: 'error',
        });
      }
    }
  }

  private async validateSemantics(prompt: AgentPrompt, result: PromptValidationResult): Promise<void> {
    const rules = this.builtinRules.filter(rule => rule.name.includes('semantic'));
    
    for (const rule of rules) {
      try {
        const issues = rule.validate(prompt);
        this.addIssues(result, issues);
      } catch (error) {
        logger.warn('Rule validation failed', { rule: rule.name, error });
      }
    }
  }

  private async validateTemplates(prompt: AgentPrompt, result: PromptValidationResult): Promise<void> {
    try {
      // Validate user prompt template
      const templateValidation = await templateEngine.validateTemplate(
        prompt.user_prompt_template,
        prompt.template_variables
      );

      if (!templateValidation.valid) {
        for (const error of templateValidation.errors) {
          result.errors.push({
            field: 'user_prompt_template',
            message: error.message,
            severity: 'error',
            suggestion: 'Check template syntax and variable definitions',
          });
        }
        result.valid = false;
      }

      for (const warning of templateValidation.warnings) {
        result.warnings.push({
          field: 'user_prompt_template',
          message: warning.message,
          impact: 'Template may not work as expected',
          suggestion: warning.suggestion || 'Review template structure',
        });
      }

    } catch (error) {
      logger.error('Template validation failed', { error });
      result.errors.push({
        field: 'user_prompt_template',
        message: `Template validation error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
      });
      result.valid = false;
    }
  }

  private async validateContentQuality(prompt: AgentPrompt, result: PromptValidationResult): Promise<void> {
    const qualityRules = this.builtinRules.filter(rule => rule.name.includes('quality'));
    
    for (const rule of qualityRules) {
      try {
        const issues = rule.validate(prompt);
        this.addIssues(result, issues);
      } catch (error) {
        logger.warn('Quality rule validation failed', { rule: rule.name, error });
      }
    }
  }

  private async applyCustomRules(prompt: AgentPrompt, result: PromptValidationResult): Promise<void> {
    for (const rule of this.config.customRules) {
      try {
        const issues = rule.validate(prompt);
        this.addIssues(result, issues);
      } catch (error) {
        logger.warn('Custom rule validation failed', { rule: rule.name, error });
      }
    }
  }

  private calculateMetrics(prompt: AgentPrompt, result: PromptValidationResult): void {
    // Completeness score
    const completeness = this.calculateCompletenessScore(prompt);
    result.metrics.completeness_score = completeness;

    // Complexity score
    result.metrics.complexity_score = this.calculateComplexityScore(prompt);

    // Count metrics
    result.metrics.template_variables_count = prompt.template_variables?.length || 0;
    result.metrics.question_templates_count = prompt.question_templates?.length || 0;
    result.metrics.handoff_procedures_count = prompt.handoff_procedures?.length || 0;
  }

  private generateRecommendations(prompt: AgentPrompt, result: PromptValidationResult): void {
    const recommendations: string[] = [];

    if (result.metrics.completeness_score < 80) {
      recommendations.push('Consider adding more comprehensive prompt content to improve completeness');
    }

    if (result.metrics.template_variables_count === 0) {
      recommendations.push('Add template variables to make the prompt more dynamic and reusable');
    }

    if (!prompt.question_templates || prompt.question_templates.length === 0) {
      recommendations.push('Add question templates to improve user interaction capabilities');
    }

    if (!prompt.test_cases || prompt.test_cases.length === 0) {
      recommendations.push('Add test cases to validate prompt behavior and quality');
    }

    if (result.warnings.length > 5) {
      recommendations.push('Address warnings to improve prompt quality and reliability');
    }

    result.recommendations = recommendations;
  }

  private createBuiltinRules(): ValidationRule[] {
    return [
      {
        name: 'semantic_identity_completeness',
        description: 'Validates that agent identity is complete and meaningful',
        severity: 'error',
        validate: (prompt: AgentPrompt): ValidationIssue[] => {
          const issues: ValidationIssue[] = [];

          if (!prompt.identity.role || prompt.identity.role.length < 10) {
            issues.push({
              field: 'identity.role',
              message: 'Agent role description is too short or missing',
              severity: 'error',
              suggestion: 'Provide a detailed role description (at least 10 characters)',
            });
          }

          if (!prompt.identity.expertise || prompt.identity.expertise.length === 0) {
            issues.push({
              field: 'identity.expertise',
              message: 'Agent expertise areas are missing',
              severity: 'error',
              suggestion: 'Define at least 3-5 areas of expertise',
            });
          }

          if (prompt.identity.expertise && prompt.identity.expertise.length < 3) {
            issues.push({
              field: 'identity.expertise',
              message: 'Agent should have at least 3 areas of expertise',
              severity: 'warning',
              suggestion: 'Add more expertise areas to establish credibility',
            });
          }

          return issues;
        },
      },

      {
        name: 'semantic_template_variables_consistency',
        description: 'Validates that template variables are used consistently',
        severity: 'warning',
        validate: (prompt: AgentPrompt): ValidationIssue[] => {
          const issues: ValidationIssue[] = [];

          // Check if required variables are actually used in the template
          const requiredVars = prompt.template_variables.filter(v => v.required);
          const templateContent = prompt.user_prompt_template;

          for (const variable of requiredVars) {
            const varPattern = new RegExp(`\\{\\{\\{?\\s*${variable.name}`, 'g');
            if (!varPattern.test(templateContent)) {
              issues.push({
                field: 'template_variables',
                message: `Required variable '${variable.name}' is not used in template`,
                severity: 'warning',
                suggestion: `Either use {{${variable.name}}} in the template or mark as optional`,
              });
            }
          }

          return issues;
        },
      },

      {
        name: 'quality_prompt_clarity',
        description: 'Validates prompt clarity and instruction quality',
        severity: 'warning',
        validate: (prompt: AgentPrompt): ValidationIssue[] => {
          const issues: ValidationIssue[] = [];

          if (prompt.system_prompt.length < 200) {
            issues.push({
              field: 'system_prompt',
              message: 'System prompt is quite short and may lack detail',
              severity: 'warning',
              suggestion: 'Provide more detailed instructions and context',
            });
          }

          if (prompt.user_prompt_template.length < 100) {
            issues.push({
              field: 'user_prompt_template',
              message: 'User prompt template is very short',
              severity: 'warning',
              suggestion: 'Consider adding more structure and guidance',
            });
          }

          // Check for common prompt engineering best practices
          if (!prompt.system_prompt.includes('RESPONSIBILITIES') && !prompt.system_prompt.includes('responsibilities')) {
            issues.push({
              field: 'system_prompt',
              message: 'System prompt should clearly define agent responsibilities',
              severity: 'info',
              suggestion: 'Add a RESPONSIBILITIES section to clarify agent duties',
            });
          }

          return issues;
        },
      },

      {
        name: 'quality_error_handling_coverage',
        description: 'Validates error handling completeness',
        severity: 'warning',
        validate: (prompt: AgentPrompt): ValidationIssue[] => {
          const issues: ValidationIssue[] = [];

          if (!prompt.error_handling || prompt.error_handling.length === 0) {
            issues.push({
              field: 'error_handling',
              message: 'No error handling instructions defined',
              severity: 'warning',
              suggestion: 'Add error handling for common failure scenarios',
            });
          } else if (prompt.error_handling.length < 3) {
            issues.push({
              field: 'error_handling',
              message: 'Error handling coverage seems limited',
              severity: 'info',
              suggestion: 'Consider adding error handling for more scenarios',
            });
          }

          return issues;
        },
      },

      {
        name: 'quality_handoff_completeness',
        description: 'Validates handoff procedure completeness',
        severity: 'error',
        validate: (prompt: AgentPrompt): ValidationIssue[] => {
          const issues: ValidationIssue[] = [];

          if (!prompt.handoff_procedures || prompt.handoff_procedures.length === 0) {
            issues.push({
              field: 'handoff_procedures',
              message: 'No handoff procedures defined',
              severity: 'error',
              suggestion: 'Define at least one handoff procedure to next agent',
            });
            return issues;
          }

          for (const handoff of prompt.handoff_procedures) {
            if (!handoff.required_outputs || handoff.required_outputs.length === 0) {
              issues.push({
                field: 'handoff_procedures',
                message: `Handoff to ${handoff.next_agent} has no required outputs`,
                severity: 'warning',
                suggestion: 'Define what outputs are required for successful handoff',
              });
            }

            if (!handoff.context_to_pass || handoff.context_to_pass.length === 0) {
              issues.push({
                field: 'handoff_procedures',
                message: `Handoff to ${handoff.next_agent} defines no context to pass`,
                severity: 'warning',
                suggestion: 'Define what context should be passed to the next agent',
              });
            }
          }

          return issues;
        },
      },
    ];
  }

  private addIssues(result: PromptValidationResult, issues: ValidationIssue[]): void {
    for (const issue of issues) {
      if (issue.severity === 'error') {
        result.errors.push({
          field: issue.field,
          message: issue.message,
          severity: issue.severity,
          suggestion: issue.suggestion,
        });
        result.valid = false;
      } else {
        result.warnings.push({
          field: issue.field,
          message: issue.message,
          impact: issue.severity === 'warning' ? 'May affect prompt performance' : 'Minor issue',
          suggestion: issue.suggestion || 'Consider addressing this issue',
        });
      }
    }
  }

  private hasField(obj: any, path: string): boolean {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return false;
      }
      
      if (!(part in current)) {
        return false;
      }
      
      current = current[part];
    }

    return current != null && (typeof current !== 'string' || current.length > 0);
  }

  private getSuggestionForSchemaError(error: any): string | undefined {
    switch (error.code) {
      case 'invalid_type':
        return `Expected ${error.expected}, got ${error.received}`;
      case 'too_small':
        return `Minimum length is ${error.minimum}`;
      case 'too_big':
        return `Maximum length is ${error.maximum}`;
      case 'invalid_enum_value':
        return `Valid values are: ${error.options?.join(', ')}`;
      default:
        return undefined;
    }
  }

  private calculateCompletenessScore(prompt: AgentPrompt): number {
    const fields = [
      'identity.role',
      'identity.expertise',
      'identity.communication_style',
      'identity.personality_traits',
      'system_prompt',
      'user_prompt_template',
      'template_variables',
      'question_templates',
      'output_format',
      'handoff_procedures',
      'error_handling',
      'settings',
    ];

    const presentFields = fields.filter(field => this.hasField(prompt, field));
    return Math.round((presentFields.length / fields.length) * 100);
  }

  private calculateComplexityScore(prompt: AgentPrompt): number {
    let score = 0;

    // Template variables complexity
    score += (prompt.template_variables?.length || 0) * 5;

    // Question templates complexity
    score += (prompt.question_templates?.length || 0) * 3;

    // Handoff procedures complexity
    score += (prompt.handoff_procedures?.length || 0) * 4;

    // Error handling complexity
    score += (prompt.error_handling?.length || 0) * 3;

    // Template complexity (rough estimate based on length and Handlebars usage)
    const templateComplexity = Math.min(
      Math.floor((prompt.user_prompt_template?.length || 0) / 100) +
      (prompt.user_prompt_template?.match(/\{\{/g)?.length || 0),
      50
    );
    score += templateComplexity;

    return Math.min(score, 100);
  }
}

// Export singleton instance
export const promptValidator = new PromptValidator();