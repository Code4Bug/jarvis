#!/usr/bin/env node

import { APP_VERSION } from './config/constants.js';
import { startJarvis } from './index.js';

const arg = process.argv[2];

if (arg === '--version' || arg === '-v' || arg === 'version') {
  console.log(APP_VERSION);
  process.exit(0);
}

startJarvis();
