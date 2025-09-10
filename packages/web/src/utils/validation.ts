import { z } from 'zod';

// Project input validation schema
export const projectInputSchema = z.object({
  projectInput: z
    .string()
    .min(10, 'Please describe your project idea in at least 10 characters')
    .max(2000, 'Project description must be less than 2000 characters')
    .refine(
      (val) => val.trim().length > 0,
      'Project description cannot be empty'
    )
    .refine(
      (val) => val.split(' ').length >= 3,
      'Please provide more details about your project'
    ),
  userPreferences: z.object({
    industry: z.string().optional(),
    projectType: z.string().optional(),
    timeline: z.string().optional(),
    budget: z.string().optional(),
  }).optional(),
  anonymous: z.boolean().optional(),
});

export type ProjectInputFormData = z.infer<typeof projectInputSchema>;

// Validation helper functions
export const validateProjectInput = (input: string) => {
  const result = projectInputSchema.shape.projectInput.safeParse(input);
  
  if (!result.success) {
    return {
      isValid: false,
      errors: result.error.errors.map(err => err.message),
      warnings: []
    };
  }

  const warnings = [];
  
  // Add warnings for potentially low-quality input
  if (input.length < 50) {
    warnings.push('Consider adding more details for better analysis');
  }
  
  if (!input.includes('?') && input.length < 100) {
    warnings.push('Describing your goals or challenges will help our AI experts');
  }

  return {
    isValid: true,
    errors: [],
    warnings
  };
};

// Character count helper
export const getCharacterCount = (text: string) => {
  return {
    current: text.length,
    max: 2000,
    remaining: 2000 - text.length,
    percentage: (text.length / 2000) * 100
  };
};

// Word count helper
export const getWordCount = (text: string) => {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
};

// Check if input has good quality indicators
export const assessInputQuality = (input: string) => {
  const wordCount = getWordCount(input);
  const hasQuestions = input.includes('?');
  const hasGoals = /\b(want|need|goal|objective|achieve|build|create)\b/i.test(input);
  const hasConstraints = /\b(budget|timeline|deadline|limited|constraint)\b/i.test(input);
  const hasTechnicalTerms = /\b(app|website|platform|system|software|api|database)\b/i.test(input);
  
  let score = 0;
  const feedback = [];
  
  if (wordCount >= 20) {
    score += 20;
  } else {
    feedback.push('Consider adding more details about your project');
  }
  
  if (hasGoals) {
    score += 25;
  } else {
    feedback.push('Describe what you want to achieve');
  }
  
  if (hasQuestions) {
    score += 15;
  }
  
  if (hasConstraints) {
    score += 20;
  } else {
    feedback.push('Mention any constraints like budget or timeline');
  }
  
  if (hasTechnicalTerms) {
    score += 20;
  }
  
  return {
    score,
    quality: score >= 60 ? 'good' : score >= 30 ? 'fair' : 'needs-improvement',
    feedback
  };
};

// Session validation helpers
export const validateSessionId = (sessionId: string) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
};

// URL validation for WebSocket connections
export const validateWebSocketUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'ws:' || parsedUrl.protocol === 'wss:';
  } catch {
    return false;
  }
};

// Sanitization helpers
export const sanitizeInput = (input: string) => {
  return input
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .trim();
};

export const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
};