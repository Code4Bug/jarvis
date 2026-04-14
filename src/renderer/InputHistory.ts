/**
 * 输入历史管理
 *
 * 管理用户输入历史的加载、保存和浏览。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const HISTORY_DIR = path.join(os.homedir(), '.jarvis');
const HISTORY_FILE = path.join(HISTORY_DIR, '.input_history');
const MAX_HISTORY = 20;

function decodeLegacyLine(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === 'n') { result += '\n'; i++; continue; }
      if (next === '\\') { result += '\\'; i++; continue; }
    }
    result += s[i];
  }
  return result;
}

function loadHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8').trim();
    if (!content) return [];
    if (content.startsWith('[')) {
      try {
        const arr = JSON.parse(content);
        if (Array.isArray(arr)) return arr.filter((s): s is string => typeof s === 'string').slice(-MAX_HISTORY);
      } catch { /* fallback */ }
    }
    return content.split('\n').filter(Boolean).slice(-MAX_HISTORY).map(decodeLegacyLine);
  } catch { return []; }
}

function saveHistory(history: string[]): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-MAX_HISTORY)), 'utf-8');
  } catch { /* silent */ }
}

export class InputHistory {
  private history: string[];
  private historyIndex = -1;
  private draft = '';

  constructor() {
    this.history = loadHistory();
  }

  push(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) return;
    this.history = [...this.history.filter((h) => h !== trimmed), trimmed].slice(-MAX_HISTORY);
    saveHistory(this.history);
    this.historyIndex = -1;
    this.draft = '';
  }

  navigateUp(currentInput: string): string | null {
    if (this.history.length === 0) return null;
    if (this.historyIndex === -1) {
      this.draft = currentInput;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      return null;
    }
    return this.history[this.historyIndex];
  }

  navigateDown(): string | null {
    if (this.historyIndex === -1) return null;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      return this.history[this.historyIndex];
    }
    this.historyIndex = -1;
    return this.draft;
  }

  resetIndex(): void {
    this.historyIndex = -1;
  }
}
