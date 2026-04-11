import fs from 'fs';
import os from 'os';
import path from 'path';

export const USER_PROFILE_PATH = path.join(os.homedir(), '.jarvis', 'USER.md');
let cachedUserProfile = '';

export function ensureJarvisHomeDir(): string {
  const dir = path.dirname(USER_PROFILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function readUserProfile(): string {
  try {
    if (!fs.existsSync(USER_PROFILE_PATH)) return '';
    return fs.readFileSync(USER_PROFILE_PATH, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function initializeUserProfileCache(): string {
  cachedUserProfile = readUserProfile();
  return cachedUserProfile;
}

export function getCachedUserProfile(): string {
  return cachedUserProfile;
}

export function writeUserProfile(content: string, options?: { updateCache?: boolean }): void {
  ensureJarvisHomeDir();
  const normalizedContent = content.trimEnd();
  fs.writeFileSync(USER_PROFILE_PATH, normalizedContent + '\n', 'utf-8');
  if (options?.updateCache) {
    cachedUserProfile = normalizedContent;
  }
}

initializeUserProfileCache();
