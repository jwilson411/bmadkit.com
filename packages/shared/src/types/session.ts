import { z } from 'zod';

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum AgentType {
  ANALYST = 'ANALYST',
  PM = 'PM',
  UX_EXPERT = 'UX_EXPERT',
  ARCHITECT = 'ARCHITECT'
}

export const PlanningSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  status: z.nativeEnum(SessionStatus),
  currentAgent: z.nativeEnum(AgentType),
  projectInput: z.string(),
  sessionData: z.record(z.unknown()).optional(),
  progressPercentage: z.number().min(0).max(100),
  startedAt: z.date(),
  completedAt: z.date().optional(),
  expiresAt: z.date()
});

export type PlanningSession = z.infer<typeof PlanningSessionSchema>;