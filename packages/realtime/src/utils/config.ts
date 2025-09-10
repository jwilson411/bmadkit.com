import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the package root
dotenv.config({ path: path.join(__dirname, '../../.env.local') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const ConfigSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3002'),
  
  // Redis Configuration
  REDIS_URL: z.string().optional(),
  
  // Security Configuration
  JWT_SECRET: z.string().min(32).optional(),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  
  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug']).default('info'),
  
  // Socket.IO Configuration
  SOCKET_IO_CORS_ORIGINS: z.string().optional(),
  SOCKET_IO_PING_TIMEOUT: z.string().transform(Number).default('60000'),
  SOCKET_IO_PING_INTERVAL: z.string().transform(Number).default('25000'),
  
  // Rate Limiting Configuration
  RATE_LIMIT_CONNECTIONS_PER_IP: z.string().transform(Number).default('10'),
  RATE_LIMIT_MESSAGES_PER_SECOND: z.string().transform(Number).default('30'),
  
  // Performance Configuration
  MAX_CONNECTIONS: z.string().transform(Number).default('1000'),
  CONNECTION_TIMEOUT: z.string().transform(Number).default('30000'),
});

export type Config = z.infer<typeof ConfigSchema>;

let config: Config;

export const getConfig = (): Config => {
  if (!config) {
    const result = ConfigSchema.safeParse(process.env);
    
    if (!result.success) {
      console.error('Realtime service configuration validation failed:', result.error.format());
      throw new Error('Invalid realtime service configuration');
    }
    
    config = result.data;
  }
  
  return config;
};

export const isDevelopment = () => getConfig().NODE_ENV === 'development';
export const isProduction = () => getConfig().NODE_ENV === 'production';
export const isStaging = () => getConfig().NODE_ENV === 'staging';