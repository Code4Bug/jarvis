import fs from 'fs';
import os from 'os';
import path from 'path';

export const MEMORY_FILE_PATH = path.join(os.homedir(), '.jarvis', 'MEMORY.md');

const MEMORY_FILE_HEADER = [
  '# Jarvis 长期记忆',
  '',
  '> 这里沉淀可复用的经验、技能、偏好、约束与稳定环境事实。',
  '> 避免写入一次性闲聊、临时输出、密钥或其它敏感信息。',
  '',
].join('\n');

export function ensureMemoryHomeDir(): string {
  const dir = path.dirname(MEMORY_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureMemoryFile(): string {
  ensureMemoryHomeDir();
  if (!fs.existsSync(MEMORY_FILE_PATH)) {
    fs.writeFileSync(MEMORY_FILE_PATH, MEMORY_FILE_HEADER, 'utf-8');
  }
  return MEMORY_FILE_PATH;
}

export function readPersistentMemory(): string {
  try {
    ensureMemoryFile();
    return fs.readFileSync(MEMORY_FILE_PATH, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function readPersistentMemoryForPrompt(maxChars = 12000): string {
  const content = readPersistentMemory();
  if (!content) return '';
  if (content.length <= maxChars) return content;
  return `...[已截断，仅保留最近 ${maxChars} 字符]\n${content.slice(-maxChars)}`;
}

export function appendPersistentMemory(content: string): void {
  const normalized = content.trim();
  if (!normalized) return;
  ensureMemoryFile();
  const current = fs.readFileSync(MEMORY_FILE_PATH, 'utf-8');
  const suffix = current.endsWith('\n\n') ? '' : (current.endsWith('\n') ? '\n' : '\n\n');
  fs.appendFileSync(MEMORY_FILE_PATH, `${suffix}${normalized}\n`, 'utf-8');
}

export function replacePersistentMemory(content: string): void {
  ensureMemoryFile();
  fs.writeFileSync(MEMORY_FILE_PATH, `${content.trimEnd()}\n`, 'utf-8');
}
