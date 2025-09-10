import winston from 'winston';
import { getConfig } from './config';

const config = getConfig();

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'bmad-realtime' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Add file transport in production
if (config.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/realtime-error.log',
    level: 'error'
  }));
  logger.add(new winston.transports.File({
    filename: 'logs/realtime-combined.log'
  }));
}

export { logger };