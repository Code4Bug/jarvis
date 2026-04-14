import React from 'react';
import { render } from 'ink';
import { logInfo } from './core/logger.js';
import AppBootstrap from './screens/AppBootstrap.js';

export interface StartJarvisOptions {
  initialResumeSessionId?: string;
}

export function startJarvis(options: StartJarvisOptions = {}) {
  logInfo('app.render.start', { initialResumeSessionId: options.initialResumeSessionId });
  render(<AppBootstrap initialResumeSessionId={options.initialResumeSessionId} />, { exitOnCtrlC: false });
}
