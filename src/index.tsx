import React from 'react';
import { render } from 'ink';
import { logInfo } from './core/logger.js';
import AppBootstrap from './screens/AppBootstrap.js';

export function startJarvis() {
  logInfo('app.render.start');
  render(<AppBootstrap />, { exitOnCtrlC: false });
}
