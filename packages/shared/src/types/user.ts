import { z } from 'zod';

export enum SubscriptionTier {
  FREE = 'FREE',
  EMAIL_CAPTURED = 'EMAIL_CAPTURED',
  PREMIUM = 'PREMIUM'
}

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  subscriptionTier: z.nativeEnum(SubscriptionTier),
  stripeCustomerId: z.string().optional(),
  createdAt: z.date(),
  lastLogin: z.date().optional(),
  preferences: z.record(z.unknown()).optional()
});

export type User = z.infer<typeof UserSchema>;