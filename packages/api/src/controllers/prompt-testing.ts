import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { 
  AgentType, 
  PromptExecutionContext,
  PromptExecutionResult,
  PromptExecutionContextSchema 
} from '../models/agent-prompt.ts';
import { promptLoader } from '../services/agent-prompt-loader.ts';
import { templateEngine } from '../services/template-engine.ts';
import { promptValidator } from '../services/prompt-validator.ts';
import { promptVersionManager } from '../services/prompt-version-manager.ts';
import { logger } from '../utils/logger.ts';
import { validateRequest } from '../middleware/validation.ts';

// Request schemas for validation
const TestPromptRequestSchema = z.object({
  agentType: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  version: z.string().optional(),
  context: PromptExecutionContextSchema,
  dryRun: z.boolean().default(true),
  includeMetrics: z.boolean().default(true),
});

const ValidatePromptRequestSchema = z.object({
  agentType: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  version: z.string().optional(),
  includeRecommendations: z.boolean().default(true),
});

const CompareVersionsRequestSchema = z.object({
  agentType: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  version1: z.string(),
  version2: z.string(),
  includeTemplateComparison: z.boolean().default(true),
});

export interface PromptTestResult {
  success: boolean;
  agentType: AgentType;
  version: string;
  testId: string;
  timestamp: string;
  executionTime: number;
  templateOutput?: string;
  validationResult?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metrics?: {
    templateVariablesUsed: number;
    templateSize: number;
    outputSize: number;
    cacheHit: boolean;
  };
}

export interface PromptComparisonResult {
  agentType: AgentType;
  version1: string;
  version2: string;
  differences: {
    templateChanges: string[];
    variableChanges: string[];
    handoffChanges: string[];
    breakingChanges: boolean;
  };
  compatibility: {
    backwardCompatible: boolean;
    migrationRequired: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}

export class PromptTestingController {
  /**
   * Test a prompt with provided context
   * POST /api/prompts/test
   */
  async testPrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const testId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const { agentType, version, context, dryRun, includeMetrics } = 
        TestPromptRequestSchema.parse(req.body);

      logger.info('Starting prompt test', {
        testId,
        agentType,
        version,
        dryRun,
        sessionId: context.session_id
      });

      // Load the prompt
      const prompt = await promptLoader.loadPrompt(agentType, {
        version,
        useCache: true,
        validateSchema: true,
      });

      const result: PromptTestResult = {
        success: false,
        agentType,
        version: prompt.version,
        testId,
        timestamp: new Date().toISOString(),
        executionTime: 0,
      };

      try {
        // Execute template rendering
        const templateOutput = await templateEngine.processAgentPrompt(prompt, context);
        result.templateOutput = templateOutput;

        // Validate the prompt if requested
        if (!dryRun) {
          const validationResult = await promptValidator.validatePrompt(prompt);
          result.validationResult = validationResult;
          
          if (!validationResult.valid) {
            result.error = {
              code: 'VALIDATION_FAILED',
              message: 'Prompt validation failed',
              details: validationResult.errors,
            };
          }
        }

        // Collect metrics if requested
        if (includeMetrics) {
          const cacheStats = templateEngine.getCacheStats();
          const templateId = `${agentType}_${prompt.version}`;
          const templateInCache = cacheStats.templates.find(t => t.id === templateId);

          result.metrics = {
            templateVariablesUsed: prompt.template_variables.length,
            templateSize: prompt.user_prompt_template.length,
            outputSize: templateOutput.length,
            cacheHit: !!templateInCache,
          };
        }

        result.success = !result.error;
        result.executionTime = Date.now() - startTime;

        logger.info('Prompt test completed', {
          testId,
          success: result.success,
          executionTime: result.executionTime,
          outputSize: result.templateOutput?.length || 0
        });

        res.status(200).json({
          success: true,
          data: result,
          meta: {
            testId,
            timestamp: new Date().toISOString(),
          },
        });

      } catch (executionError) {
        result.error = {
          code: 'EXECUTION_ERROR',
          message: executionError instanceof Error ? executionError.message : 'Unknown execution error',
          details: executionError,
        };
        result.executionTime = Date.now() - startTime;

        logger.error('Prompt test execution failed', {
          testId,
          error: result.error,
          executionTime: result.executionTime
        });

        res.status(400).json({
          success: false,
          error: result.error,
          data: result,
        });
      }

    } catch (error) {
      logger.error('Prompt test failed', {
        testId,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'TEST_ERROR',
          message: error instanceof Error ? error.message : 'Unknown test error',
        },
        meta: {
          testId,
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
        },
      });
    }
  }

  /**
   * Validate a prompt structure and content
   * POST /api/prompts/validate
   */
  async validatePrompt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { agentType, version, includeRecommendations } = 
        ValidatePromptRequestSchema.parse(req.body);

      logger.info('Starting prompt validation', {
        agentType,
        version,
        includeRecommendations
      });

      // Load the prompt
      const prompt = await promptLoader.loadPrompt(agentType, {
        version,
        useCache: true,
        validateSchema: true,
      });

      // Perform validation
      const validationResult = await promptValidator.validatePrompt(prompt);

      // Add version compatibility check
      const compatibility = await promptVersionManager.getCompatibility(agentType);
      const isCurrentVersion = compatibility.current_version === prompt.version;

      const response = {
        success: true,
        data: {
          ...validationResult,
          versionInfo: {
            current: prompt.version,
            latest: compatibility.current_version,
            isLatest: isCurrentVersion,
            compatibleVersions: compatibility.compatible_versions,
          },
          ...(includeRecommendations && {
            recommendations: validationResult.recommendations,
          }),
        },
        meta: {
          timestamp: new Date().toISOString(),
          validationRules: promptValidator.getRules().length,
        },
      };

      logger.info('Prompt validation completed', {
        agentType,
        version: prompt.version,
        valid: validationResult.valid,
        errorCount: validationResult.errors.length,
        warningCount: validationResult.warnings.length
      });

      res.status(200).json(response);

    } catch (error) {
      logger.error('Prompt validation failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown validation error',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Compare two versions of a prompt
   * POST /api/prompts/compare
   */
  async compareVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { agentType, version1, version2, includeTemplateComparison } = 
        CompareVersionsRequestSchema.parse(req.body);

      logger.info('Starting version comparison', {
        agentType,
        version1,
        version2,
        includeTemplateComparison
      });

      // Load both versions
      const [prompt1, prompt2] = await Promise.all([
        promptLoader.loadPrompt(agentType, { version: version1, useCache: true }),
        promptLoader.loadPrompt(agentType, { version: version2, useCache: true }),
      ]);

      const comparison: PromptComparisonResult = {
        agentType,
        version1,
        version2,
        differences: {
          templateChanges: [],
          variableChanges: [],
          handoffChanges: [],
          breakingChanges: false,
        },
        compatibility: {
          backwardCompatible: true,
          migrationRequired: false,
          riskLevel: 'LOW',
        },
      };

      // Compare templates
      if (prompt1.user_prompt_template !== prompt2.user_prompt_template) {
        comparison.differences.templateChanges.push('User prompt template content changed');
      }

      if (prompt1.system_prompt !== prompt2.system_prompt) {
        comparison.differences.templateChanges.push('System prompt content changed');
      }

      // Compare template variables
      const vars1 = prompt1.template_variables.map(v => `${v.name}:${v.type}:${v.required}`);
      const vars2 = prompt2.template_variables.map(v => `${v.name}:${v.type}:${v.required}`);
      
      const addedVars = vars2.filter(v => !vars1.includes(v));
      const removedVars = vars1.filter(v => !vars2.includes(v));
      
      if (addedVars.length > 0) {
        comparison.differences.variableChanges.push(`Added variables: ${addedVars.join(', ')}`);
      }
      
      if (removedVars.length > 0) {
        comparison.differences.variableChanges.push(`Removed variables: ${removedVars.join(', ')}`);
        comparison.differences.breakingChanges = true;
        comparison.compatibility.backwardCompatible = false;
      }

      // Compare handoff procedures
      const handoffs1 = prompt1.handoff_procedures.map(h => h.next_agent);
      const handoffs2 = prompt2.handoff_procedures.map(h => h.next_agent);
      
      if (JSON.stringify(handoffs1.sort()) !== JSON.stringify(handoffs2.sort())) {
        comparison.differences.handoffChanges.push('Handoff procedures changed');
        comparison.compatibility.migrationRequired = true;
      }

      // Assess risk level
      if (comparison.differences.breakingChanges) {
        comparison.compatibility.riskLevel = 'HIGH';
      } else if (!comparison.compatibility.backwardCompatible || comparison.compatibility.migrationRequired) {
        comparison.compatibility.riskLevel = 'MEDIUM';
      }

      // Get migration plan if needed
      let migrationPlan;
      if (comparison.compatibility.migrationRequired) {
        migrationPlan = await promptVersionManager.getMigrationPlan(agentType, version1, version2);
      }

      logger.info('Version comparison completed', {
        agentType,
        version1,
        version2,
        breakingChanges: comparison.differences.breakingChanges,
        riskLevel: comparison.compatibility.riskLevel
      });

      res.status(200).json({
        success: true,
        data: {
          comparison,
          ...(migrationPlan && { migrationPlan }),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });

    } catch (error) {
      logger.error('Version comparison failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'COMPARISON_ERROR',
          message: error instanceof Error ? error.message : 'Unknown comparison error',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Get all available prompts and their versions
   * GET /api/prompts/list
   */
  async listPrompts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const includeMetrics = req.query.includeMetrics === 'true';
      const includeVersions = req.query.includeVersions === 'true';

      const agentTypes: AgentType[] = ['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'];
      const promptList = [];

      for (const agentType of agentTypes) {
        try {
          const prompt = await promptLoader.loadPrompt(agentType, { useCache: true });
          
          const promptInfo: any = {
            agentType,
            version: prompt.version,
            name: prompt.name,
            description: prompt.description,
            lastUpdated: prompt.updated_at,
            author: prompt.author,
          };

          if (includeVersions) {
            promptInfo.availableVersions = await promptVersionManager.getVersions(agentType);
            promptInfo.latestVersion = await promptVersionManager.getLatestVersion(agentType);
          }

          if (includeMetrics) {
            const metrics = promptLoader.getMetrics(agentType);
            promptInfo.loadMetrics = metrics;

            const validationResult = await promptValidator.validatePrompt(prompt);
            promptInfo.validationMetrics = validationResult.metrics;
          }

          promptList.push(promptInfo);

        } catch (error) {
          logger.warn('Failed to load prompt info', { agentType, error });
          promptList.push({
            agentType,
            error: 'Failed to load prompt',
            errorDetails: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Get overall system metrics
      const cacheStats = templateEngine.getCacheStats();
      
      logger.info('Listed prompts', {
        totalPrompts: promptList.length,
        successfulLoads: promptList.filter(p => !p.error).length,
        failedLoads: promptList.filter(p => p.error).length
      });

      res.status(200).json({
        success: true,
        data: {
          prompts: promptList,
          systemMetrics: {
            templateCacheSize: cacheStats.size,
            templateCacheEntries: cacheStats.templates.length,
          },
        },
        meta: {
          timestamp: new Date().toISOString(),
          totalAgentTypes: agentTypes.length,
        },
      });

    } catch (error) {
      logger.error('Failed to list prompts', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'LIST_ERROR',
          message: error instanceof Error ? error.message : 'Unknown list error',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Get prompt loading and template metrics
   * GET /api/prompts/metrics
   */
  async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const agentType = req.query.agentType as AgentType;

      const metrics: any = {
        timestamp: new Date().toISOString(),
        templateEngine: templateEngine.getCacheStats(),
      };

      if (agentType) {
        metrics.promptLoader = promptLoader.getMetrics(agentType);
      } else {
        metrics.promptLoader = promptLoader.getMetrics();
      }

      // Get validation rule count
      metrics.validation = {
        totalRules: promptValidator.getRules().length,
        builtinRules: promptValidator.getRules().filter(r => !r.name.startsWith('custom_')).length,
        customRules: promptValidator.getRules().filter(r => r.name.startsWith('custom_')).length,
      };

      logger.debug('Retrieved metrics', {
        agentType,
        templateCacheSize: metrics.templateEngine.size,
        totalRules: metrics.validation.totalRules
      });

      res.status(200).json({
        success: true,
        data: metrics,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });

    } catch (error) {
      logger.error('Failed to get metrics', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'METRICS_ERROR',
          message: error instanceof Error ? error.message : 'Unknown metrics error',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Clear caches for testing and development
   * POST /api/prompts/clear-cache
   */
  async clearCache(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { agentType, templateCache, promptCache, compatibilityCache } = req.body;

      let clearedItems = [];

      if (templateCache !== false) {
        templateEngine.clearCache(agentType);
        clearedItems.push('template cache');
      }

      if (promptCache !== false) {
        promptLoader.clearCache(agentType);
        clearedItems.push('prompt cache');
      }

      if (compatibilityCache !== false) {
        promptVersionManager.clearCompatibilityCache(agentType);
        clearedItems.push('compatibility cache');
      }

      logger.info('Caches cleared', {
        agentType: agentType || 'all',
        clearedItems,
        requestedBy: req.ip
      });

      res.status(200).json({
        success: true,
        data: {
          cleared: clearedItems,
          agentType: agentType || 'all',
          timestamp: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });

    } catch (error) {
      logger.error('Failed to clear cache', {
        error: error instanceof Error ? error.message : String(error)
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'CACHE_CLEAR_ERROR',
          message: error instanceof Error ? error.message : 'Unknown cache clear error',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  }
}

// Create controller instance
export const promptTestingController = new PromptTestingController();

// Export route handlers
export const testPrompt = [
  validateRequest(TestPromptRequestSchema),
  (req: Request, res: Response, next: NextFunction) => promptTestingController.testPrompt(req, res, next)
];

export const validatePrompt = [
  validateRequest(ValidatePromptRequestSchema),
  (req: Request, res: Response, next: NextFunction) => promptTestingController.validatePrompt(req, res, next)
];

export const compareVersions = [
  validateRequest(CompareVersionsRequestSchema),
  (req: Request, res: Response, next: NextFunction) => promptTestingController.compareVersions(req, res, next)
];

export const listPrompts = (req: Request, res: Response, next: NextFunction) => 
  promptTestingController.listPrompts(req, res, next);

export const getMetrics = (req: Request, res: Response, next: NextFunction) => 
  promptTestingController.getMetrics(req, res, next);

export const clearCache = (req: Request, res: Response, next: NextFunction) => 
  promptTestingController.clearCache(req, res, next);