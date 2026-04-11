import React from 'react';
import { render } from 'ink';
import { logInfo } from './core/logger.js';
import REPL from './screens/repl.js';

export function startJarvis() {
  logInfo('app.render.start');
  render(<REPL />, { exitOnCtrlC: false });
}
