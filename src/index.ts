import { logInfo } from './core/logger.js';
import { checkBootstrapStatus } from './config/bootstrap.js';
import { NativeREPL } from './renderer/NativeREPL.js';
import { NativeSetupWizard } from './renderer/NativeSetupWizard.js';

export interface StartJarvisOptions {
  initialResumeSessionId?: string;
}

export function startJarvis(options: StartJarvisOptions = {}) {
  logInfo('app.render.start', { initialResumeSessionId: options.initialResumeSessionId });

  const status = checkBootstrapStatus();
  if (status.ok) {
    const repl = new NativeREPL(options.initialResumeSessionId);
    repl.start();
    return;
  }

  // Setup 完成后清屏并启动原生 REPL
  const wizard = new NativeSetupWizard(status, () => {
    process.stdout.write('\x1B[2J\x1B[H');
    const repl = new NativeREPL(options.initialResumeSessionId);
    repl.start();
  });
  wizard.start();
}
