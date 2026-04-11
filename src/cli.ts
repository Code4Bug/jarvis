#!/usr/bin/env node

import { APP_VERSION } from './config/constants.js';
import { ensureLoggerReady, logError, logInfo } from './core/logger.js';
import { startJarvis } from './index.js';

const arg = process.argv[2];

ensureLoggerReady();
logInfo('cli.launch', {
  argv: process.argv.slice(2),
  version: APP_VERSION,
});

if (arg === '--version' || arg === '-v' || arg === 'version') {
  logInfo('cli.version', { version: APP_VERSION });
  console.log(APP_VERSION);
  process.exit(0);
}

process.on('uncaughtException', (error) => {
  logError('process.uncaught_exception', error);
});

process.on('unhandledRejection', (reason) => {
  logError('process.unhandled_rejection', reason);
});

startJarvis();
