import { createApp } from './app';
import { getConfig } from './utils/config';
import { logger } from './utils/logger';
import { performStartupChecks } from './utils/startup';

const startServer = async () => {
  try {
    const config = getConfig();
    
    // Perform startup checks
    await performStartupChecks();
    
    const app = createApp();
    
    const server = app.listen(config.PORT, () => {
      logger.info('BMAD API Server started', {
        port: config.PORT,
        environment: config.NODE_ENV,
        version: '1.0.0'
      });
    });

    // Graceful shutdown handling
    const shutdown = () => {
      logger.info('Shutting down server...');
      server.close(() => {
        logger.info('Server shut down successfully');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
};

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}