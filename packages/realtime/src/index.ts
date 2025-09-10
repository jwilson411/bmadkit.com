#!/usr/bin/env node

import { RealtimeServer } from './server';
import { logger } from './utils/logger';

async function main() {
  try {
    const server = new RealtimeServer();
    await server.start();
  } catch (error) {
    logger.error('Failed to start realtime server', { error });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}