import { z } from 'zod';

export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    message: z.string(),
    code: z.string(),
    correlationId: z.string(),
    timestamp: z.string()
  }).optional()
});

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    correlationId: string;
    timestamp: string;
  };
};

export const CreateSessionRequestSchema = z.object({
  projectInput: z.string().min(10).max(5000),
  userPreferences: z.record(z.unknown()).optional()
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;