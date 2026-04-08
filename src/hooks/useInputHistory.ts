import { useState, useEffect, useCallback, useRef } from 'react';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HISTORY_DIR = path.join(os.homedir(), '.jarvis');
const HISTORY_FILE = path.join(HISTORY_DIR, '.input_history');
const MAX_HISTORY = 20;

/** 从文件加载历史记录 */
function loadHistory(): string[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

/** 保存历史记录到文件 */
function saveHistory(history: string[]): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, history.slice(-MAX_HISTORY).join('\n') + '\n', 'utf-8');
  } catch {
    // 静默失败
  }
}

/**
 * 输入历史记录 hook
 *
 * - 上箭头：浏览更早的历史
 * - 下箭头：浏览更近的历史，到底回到当前输入
 * - 提交时自动追加到历史
 */
export function useInputHistory() {
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  // -1 表示当前输入（非历史浏览状态）
  const [historyIndex, setHistoryIndex] = useState(-1);
  // 保存用户正在编辑的内容，以便从历史返回时恢复
  const draftRef = useRef('');

  /** 添加一条历史记录 */
  const pushHistory = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      // 去重：移除已有的相同记录，再追加到末尾
      const filtered = prev.filter((h) => h !== trimmed);
      const next = [...filtered, trimmed].slice(-MAX_HISTORY);
      saveHistory(next);
      return next;
    });
    setHistoryIndex(-1);
    draftRef.current = '';
  }, []);

  /** 上箭头：向更早的历史移动，返回应显示的文本 */
  const navigateUp = useCallback((currentInput: string): string | null => {
    if (history.length === 0) return null;
    if (historyIndex === -1) {
      // 首次进入历史浏览，保存当前输入
      draftRef.current = currentInput;
      const newIndex = history.length - 1;
      setHistoryIndex(newIndex);
      return history[newIndex];
    }
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      return history[newIndex];
    }
    // 已经到最早的记录
    return null;
  }, [history, historyIndex]);

  /** 下箭头：向更近的历史移动，返回应显示的文本 */
  const navigateDown = useCallback((): string | null => {
    if (historyIndex === -1) return null;
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      return history[newIndex];
    }
    // 回到当前输入
    setHistoryIndex(-1);
    return draftRef.current;
  }, [history, historyIndex]);

  /** 重置浏览状态（用户开始编辑时调用） */
  const resetNavigation = useCallback(() => {
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      draftRef.current = '';
    }
  }, [historyIndex]);

  return { pushHistory, navigateUp, navigateDown, resetNavigation, historyIndex };
}
