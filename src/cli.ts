#!/usr/bin/env node

import { APP_VERSION } from './config/constants.js';
import { ensureLoggerReady, logError, logInfo } from './core/logger.js';
import { startJarvis } from './index.js';

const args = process.argv.slice(2);
const arg = args[0];

function printCliUsage(): void {
  console.log([
    '用法:',
    '  jarvis',
    '  jarvis --version',
    '  jarvis --resume <sessionId>',
  ].join('\n'));
}

ensureLoggerReady();
logInfo('cli.launch', {
  argv: args,
  version: APP_VERSION,
});

if (arg === '--version' || arg === '-v' || arg === 'version') {
  logInfo('cli.version', { version: APP_VERSION });
  console.log(APP_VERSION);
  process.exit(0);
}

if (arg === '--resume') {
  const sessionId = args[1]?.trim();
  if (!sessionId) {
    logError('cli.resume.missing_session_id', new Error('missing session id'));
    printCliUsage();
    process.exit(1);
  }
  logInfo('cli.resume', { sessionId });
  startJarvis({ initialResumeSessionId: sessionId });
} else {
  startJarvis();
}

process.on('uncaughtException', (error) => {
  logError('process.uncaught_exception', error);
});

process.on('unhandledRejection', (reason) => {
  logError('process.unhandled_rejection', reason);
});
