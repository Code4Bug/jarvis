import React from 'react';
import { render } from 'ink';
import REPL from './screens/repl.js';

export function startJarvis() {
  render(<REPL />, { exitOnCtrlC: false });
}
