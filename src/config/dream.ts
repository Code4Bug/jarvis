import fs from 'fs';
import os from 'os';
import path from 'path';

export const DREAM_FILE_PATH = path.join(os.homedir(), '.jarvis', 'DREAM.md');

const DREAM_FILE_HEADER = [
  '# Jarvis 梦境',
  '',
  '> 这里记录 Jarvis 在闲置时对当前会话、用户画像与长期记忆的回顾与发散。',
  '> 内容用于塑造更稳定的表达气质、关注点与人格倾向，不应包含敏感信息或伪造事实。',
  '',
].join('\n');

let cachedDream = '';

export function ensureDreamHomeDir(): string {
  const dir = path.dirname(DREAM_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureDreamFile(): string {
  ensureDreamHomeDir();
  if (!fs.existsSync(DREAM_FILE_PATH)) {
    fs.writeFileSync(DREAM_FILE_PATH, DREAM_FILE_HEADER, 'utf-8');
  }
  return DREAM_FILE_PATH;
}

export function readDream(): string {
  try {
    ensureDreamFile();
    return fs.readFileSync(DREAM_FILE_PATH, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function readDreamForPrompt(maxChars = 8000): string {
  const content = readDream();
  if (!content) return '';
  if (content.length <= maxChars) return content;
  return `...[已截断，仅保留最近 ${maxChars} 字符]\n${content.slice(-maxChars)}`;
}

export function initializeDreamCache(): string {
  cachedDream = readDreamForPrompt();
  return cachedDream;
}

export function getCachedDream(): string {
  return cachedDream;
}

export function replaceDream(content: string, options?: { updateCache?: boolean }): void {
  ensureDreamFile();
  const normalized = content.trim();
  const finalContent = normalized || DREAM_FILE_HEADER.trimEnd();
  fs.writeFileSync(DREAM_FILE_PATH, `${finalContent}\n`, 'utf-8');
  if (options?.updateCache) {
    cachedDream = readDreamForPrompt();
  }
}

initializeDreamCache();
