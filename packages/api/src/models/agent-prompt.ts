import { z } from 'zod';

// Agent types supported by the system
export type AgentType = 'ANALYST' | 'PM' | 'UX_EXPERT' | 'ARCHITECT';

// Template variable schema
export const TemplateVariableSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  required: z.boolean().default(true),
  description: z.string(),
  default: z.any().optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    options: z.array(z.any()).optional(),
  }).optional(),
});

export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;

// Context requirements schema
export const ContextRequirementSchema = z.object({
  field: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
  source: z.enum(['session', 'user', 'previous_agent', 'external']),
  validation: z.object({
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
    constraints: z.record(z.any()).optional(),
  }).optional(),
});

export type ContextRequirement = z.infer<typeof ContextRequirementSchema>;

// Output format specification schema
export const OutputFormatSchema = z.object({
  type: z.enum(['json', 'markdown', 'text', 'structured']),
  schema: z.object({
    required_fields: z.array(z.string()),
    optional_fields: z.array(z.string()).optional(),
    format_rules: z.array(z.string()).optional(),
    examples: z.array(z.any()).optional(),
  }),
  validation_rules: z.array(z.string()).optional(),
});

export type OutputFormat = z.infer<typeof OutputFormatSchema>;

// Handoff procedure schema
export const HandoffProcedureSchema = z.object({
  next_agent: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT', 'USER']),
  conditions: z.array(z.string()),
  required_outputs: z.array(z.string()),
  handoff_message: z.string(),
  context_to_pass: z.array(z.string()),
});

export type HandoffProcedure = z.infer<typeof HandoffProcedureSchema>;

// Question generation template schema
export const QuestionTemplateSchema = z.object({
  category: z.enum(['clarification', 'scope', 'constraints', 'goals', 'technical', 'business']),
  priority: z.enum(['high', 'medium', 'low']),
  template: z.string(),
  conditions: z.array(z.string()).optional(),
  follow_up_rules: z.array(z.string()).optional(),
  max_questions: z.number().default(5),
});

export type QuestionTemplate = z.infer<typeof QuestionTemplateSchema>;

// Error handling instruction schema
export const ErrorHandlingSchema = z.object({
  error_type: z.string(),
  detection_criteria: z.array(z.string()),
  recovery_actions: z.array(z.string()),
  fallback_behavior: z.string(),
  user_message: z.string(),
});

export type ErrorHandling = z.infer<typeof ErrorHandlingSchema>;

// Main agent prompt schema
export const AgentPromptSchema = z.object({
  // Metadata
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must follow semantic versioning (x.y.z)'),
  agent_type: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  name: z.string(),
  description: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  author: z.string(),
  
  // Agent identity and role
  identity: z.object({
    role: z.string(),
    expertise: z.array(z.string()),
    communication_style: z.string(),
    personality_traits: z.array(z.string()),
    introduction_message: z.string(),
  }),
  
  // Context intake requirements
  context_requirements: z.array(ContextRequirementSchema),
  
  // Core prompt content
  system_prompt: z.string(),
  user_prompt_template: z.string(),
  
  // Template variables for substitution
  template_variables: z.array(TemplateVariableSchema),
  
  // Question generation
  question_templates: z.array(QuestionTemplateSchema),
  
  // Output format specifications
  output_format: OutputFormatSchema,
  
  // Handoff procedures
  handoff_procedures: z.array(HandoffProcedureSchema),
  
  // Error handling instructions
  error_handling: z.array(ErrorHandlingSchema),
  
  // Performance and behavior settings
  settings: z.object({
    max_tokens: z.number().default(2000),
    temperature: z.number().min(0).max(1).default(0.7),
    timeout_seconds: z.number().default(30),
    retry_attempts: z.number().default(3),
    enable_streaming: z.boolean().default(true),
  }),
  
  // Dependencies and compatibility
  dependencies: z.object({
    required_models: z.array(z.string()),
    min_api_version: z.string(),
    compatible_agents: z.array(z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT'])),
  }),
  
  // Testing and validation
  test_cases: z.array(z.object({
    name: z.string(),
    input_context: z.record(z.any()),
    expected_output_type: z.string(),
    validation_criteria: z.array(z.string()),
  })).optional(),
});

export type AgentPrompt = z.infer<typeof AgentPromptSchema>;

// Prompt execution context schema
export const PromptExecutionContextSchema = z.object({
  session_id: z.string(),
  user_id: z.string().optional(),
  agent_type: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  
  // Session context
  session_data: z.object({
    project_input: z.string(),
    current_phase: z.string(),
    previous_outputs: z.record(z.any()),
    conversation_history: z.array(z.any()),
    user_preferences: z.record(z.any()).optional(),
  }),
  
  // Agent-specific context
  agent_context: z.object({
    previous_agent_output: z.any().optional(),
    next_agent_type: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT', 'USER']).optional(),
    iteration_count: z.number().default(1),
    time_constraints: z.object({
      max_duration_minutes: z.number().optional(),
      deadline: z.string().datetime().optional(),
    }).optional(),
  }),
  
  // Runtime variables
  runtime_variables: z.record(z.any()),
});

export type PromptExecutionContext = z.infer<typeof PromptExecutionContextSchema>;

// Prompt execution result schema
export const PromptExecutionResultSchema = z.object({
  success: z.boolean(),
  agent_type: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  execution_id: z.string(),
  timestamp: z.string().datetime(),
  
  // Execution metrics
  metrics: z.object({
    duration_ms: z.number(),
    tokens_used: z.number(),
    cost_estimate: z.number().optional(),
    model_used: z.string(),
  }),
  
  // Results
  output: z.any(),
  formatted_output: z.string(),
  follow_up_questions: z.array(z.object({
    question: z.string(),
    category: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })).optional(),
  
  // Handoff information
  handoff: z.object({
    next_agent: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT', 'USER']).optional(),
    context_to_pass: z.record(z.any()),
    status: z.enum(['ready', 'needs_input', 'error', 'completed']),
    message: z.string(),
  }),
  
  // Error information
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any(),
    recovery_suggestions: z.array(z.string()),
  }).optional(),
});

export type PromptExecutionResult = z.infer<typeof PromptExecutionResultSchema>;

// Version compatibility schema
export const VersionCompatibilitySchema = z.object({
  current_version: z.string(),
  compatible_versions: z.array(z.string()),
  breaking_changes: z.array(z.object({
    version: z.string(),
    changes: z.array(z.string()),
    migration_guide: z.string(),
  })),
  deprecated_features: z.array(z.object({
    feature: z.string(),
    deprecated_in: z.string(),
    removal_in: z.string(),
    replacement: z.string().optional(),
  })),
});

export type VersionCompatibility = z.infer<typeof VersionCompatibilitySchema>;

// Prompt validation result schema
export const PromptValidationResultSchema = z.object({
  valid: z.boolean(),
  version: z.string(),
  agent_type: z.enum(['ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT']),
  
  errors: z.array(z.object({
    field: z.string(),
    message: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    suggestion: z.string().optional(),
  })),
  
  warnings: z.array(z.object({
    field: z.string(),
    message: z.string(),
    impact: z.string(),
    suggestion: z.string(),
  })),
  
  metrics: z.object({
    completeness_score: z.number().min(0).max(100),
    complexity_score: z.number().min(0).max(100),
    template_variables_count: z.number(),
    question_templates_count: z.number(),
    handoff_procedures_count: z.number(),
  }),
  
  recommendations: z.array(z.string()),
});

export type PromptValidationResult = z.infer<typeof PromptValidationResultSchema>;

// Export all schemas for use in other modules
export const AgentPromptSchemas = {
  AgentPrompt: AgentPromptSchema,
  PromptExecutionContext: PromptExecutionContextSchema,
  PromptExecutionResult: PromptExecutionResultSchema,
  VersionCompatibility: VersionCompatibilitySchema,
  PromptValidationResult: PromptValidationResultSchema,
  TemplateVariable: TemplateVariableSchema,
  ContextRequirement: ContextRequirementSchema,
  OutputFormat: OutputFormatSchema,
  HandoffProcedure: HandoffProcedureSchema,
  QuestionTemplate: QuestionTemplateSchema,
  ErrorHandling: ErrorHandlingSchema,
};