import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the package root
dotenv.config({ path: path.join(__dirname, '../../.env.local') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const ConfigSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  
  // Database Configuration
  DATABASE_URL: z.string().optional(),
  
  // Redis Configuration
  REDIS_URL: z.string().optional(),
  
  // Security Configuration
  JWT_SECRET: z.string().min(32).optional(),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  
  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug']).default('info'),
  
  // External Services
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  
  // Email Configuration
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().email().optional()
});

export type Config = z.infer<typeof ConfigSchema>;

let config: Config;

export const getConfig = (): Config => {
  if (!config) {
    const result = ConfigSchema.safeParse(process.env);
    
    if (!result.success) {
      console.error('Configuration validation failed:', result.error.format());
      throw new Error('Invalid configuration');
    }
    
    config = result.data;
  }
  
  return config;
};

export const isDevelopment = () => getConfig().NODE_ENV === 'development';
export const isProduction = () => getConfig().NODE_ENV === 'production';
export const isStaging = () => getConfig().NODE_ENV === 'staging';