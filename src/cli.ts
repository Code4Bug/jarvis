#!/usr/bin/env node

import { APP_VERSION } from './config/constants';
import { startJarvis } from './index';

const arg = process.argv[2];

if (arg === '--version' || arg === '-v' || arg === 'version') {
  console.log(APP_VERSION);
  process.exit(0);
}

startJarvis();
