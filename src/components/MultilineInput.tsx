import React, { useState, useEffect, useRef } from 'react';
import { useInput, useStdin } from 'ink';
import { disableBracketedPaste, enableBracketedPaste } from '../terminal/cursor.js';
import { useMultilineInputStream } from '../hooks/useMultilineInputStream.js';
import { useTerminalCursorSync } from '../hooks/useTerminalCursorSync.js';
import InputTextView from './InputTextView.js';
import {
  expandPlaceholders as expandPastedPlaceholders,
  findPlaceholderBeforeCursor,
  getCursorRowCol,
  insertTextAtCursor,
  removeTextRange,
  rowColToOffset,
} from './inputEditing.js';

/** 粘贴检测的时间窗口（ms），在此窗口内连续到达的数据视为一次粘贴 */
const PASTE_DETECT_WINDOW_MS = 8;

/**
 * IME composing 检测时间窗口（ms）。
 * 在此窗口内连续到达的可打印字符视为 IME composing 输入，
 * 延迟渲染以避免拼音字母逐个触发 re-render 导致 TUI 偏移。
 */
const IME_COMPOSE_WINDOW_MS = 80;

/** 判断字符串是否全部为 ASCII 小写字母（拼音输入的典型特征） */
const isAsciiLowerAlpha = (s: string) => /^[a-z]+$/.test(s);

/** 判断字符串是否包含非 ASCII 字符（中文、日文等 CJK 字符） */
const hasNonAscii = (s: string) => /[^\x00-\x7F]/.test(s);

interface PastedChunk {
  id: number;
  content: string;
  lineCount: number;
}

interface MultilineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onUpArrow?: () => void;
  onDownArrow?: () => void;
  placeholder?: string;
  isActive?: boolean;
  showCursor?: boolean;
  /** 斜杠命令菜单：是否处于激活状态 */
  slashMenuActive?: boolean;
  /** 斜杠命令菜单：选中项上移 */
  onSlashMenuUp?: () => void;
  /** 斜杠命令菜单：选中项下移 */
  onSlashMenuDown?: () => void;
  /** 斜杠命令菜单：确认选中 */
  onSlashMenuSelect?: () => void;
  /** 斜杠命令菜单：关闭菜单 */
  onSlashMenuClose?: () => void;
  /** 输入为空时按 Tab 的回调（用于填入 placeholder） */
  onTabFillPlaceholder?: () => void;
  /**
   * 输入框下方的行数（分隔线 + StatusBar 等），用于将终端物理光标
   * 上移到输入框行，使 IME composing 显示在正确位置而非状态栏上。
   * 默认值 2（底部分隔线 1 行 + StatusBar 1 行）。
   */
  rowsBelow?: number;
}

/**
 * 多行文本输入组件，支持光标移动和粘贴折叠。
 *
 * - Enter: 提交（占位符会被展开为真实内容）
 * - Alt/Option+Enter: 换行
 * - ←→: 左右移动光标
 * - ↑↓: 上下行移动光标（单行时触发 onUpArrow/onDownArrow）
 * - Backspace: 删除光标前一个字符（占位符整体删除）
 * - 粘贴多行内容: 折叠为 [Pasted text #N +X lines] 占位符
 */
export default function MultilineInput({
  value,
  onChange,
  onSubmit,
  onUpArrow,
  onDownArrow,
  placeholder = '',
  isActive = true,
  showCursor = true,
  slashMenuActive = false,
  onSlashMenuUp,
  onSlashMenuDown,
  onSlashMenuSelect,
  onSlashMenuClose,
  onTabFillPlaceholder,
  rowsBelow = 2,
}: MultilineInputProps) {
  const { stdin } = useStdin();
  const [cursor, setCursor] = useState(value.length);

  // 粘贴内容存储
  const pasteCountRef = useRef(0);
  const pastedChunksRef = useRef<Map<number, PastedChunk>>(new Map());

  // IME composing 缓冲：积累拼音字母，等 composing 结束后再一次性更新
  // imeBufferRef: 当前正在 composing 的拼音字母
  // imeTimerRef: composing 超时定时器，超时后将拼音作为普通文本提交
  // imeInsertedLen: 已经临时插入到 value 中的 composing 文本长度（用于替换）
  const imeBufferRef = useRef('');
  const imeInsertedLenRef = useRef(0);

  // 启用 bracketed paste mode，并在激活时清空 stdin 缓冲区
  useEffect(() => {
    if (!stdin || !isActive) return;
    // 清空 stdin 缓冲区，丢弃 processing 期间积累的输入
    if (typeof (stdin as any).read === 'function') {
      while ((stdin as any).read() !== null) { /* drain */ }
    }
    enableBracketedPaste();
    return () => {
      disableBracketedPaste();
    };
  }, [stdin, isActive]);

  // 标记内部触发的 value 变更，避免 useEffect 覆盖光标位置
  const internalChangeRef = useRef(false);

  // 外部 value 变化时，将光标移到末尾（仅外部变更时）
  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      return;
    }
    setCursor(value.length);
  }, [value]);

  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** 内部触发 onChange，标记为内部变更避免光标跳转 */
  const emitChange = (val: string) => {
    internalChangeRef.current = true;
    onChangeRef.current(val);
  };
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onUpArrowRef = useRef(onUpArrow);
  onUpArrowRef.current = onUpArrow;
  const onDownArrowRef = useRef(onDownArrow);
  onDownArrowRef.current = onDownArrow;

  // 斜杠菜单相关 ref
  const slashMenuActiveRef = useRef(slashMenuActive);
  slashMenuActiveRef.current = slashMenuActive;
  const onSlashMenuUpRef = useRef(onSlashMenuUp);
  onSlashMenuUpRef.current = onSlashMenuUp;
  const onSlashMenuDownRef = useRef(onSlashMenuDown);
  onSlashMenuDownRef.current = onSlashMenuDown;
  const onSlashMenuSelectRef = useRef(onSlashMenuSelect);
  onSlashMenuSelectRef.current = onSlashMenuSelect;
  const onSlashMenuCloseRef = useRef(onSlashMenuClose);
  onSlashMenuCloseRef.current = onSlashMenuClose;
  const onTabFillPlaceholderRef = useRef(onTabFillPlaceholder);
  onTabFillPlaceholderRef.current = onTabFillPlaceholder;

  /** 将粘贴的多行内容折叠为占位符，插入到当前光标位置 */
  const insertPaste = (pastedText: string) => {
    const v = valueRef.current;
    const c = cursorRef.current;
    const cleaned = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lineCount = cleaned.split('\n').length;

    // 单行粘贴直接插入，不折叠
    if (lineCount <= 1) {
      const result = insertTextAtCursor(v, c, cleaned);
      emitChange(result.value);
      setCursor(result.cursor);
      return;
    }

    // 多行 → 生成占位符
    const id = ++pasteCountRef.current;
    pastedChunksRef.current.set(id, { id, content: cleaned, lineCount });
    const tag = `[Pasted text #${id} +${lineCount} lines]`;
    const result = insertTextAtCursor(v, c, tag);
    emitChange(result.value);
    setCursor(result.cursor);
  };

  /** 展开 value 中所有占位符为真实内容 */
  const expandPlaceholders = (text: string): string => {
    return expandPastedPlaceholders(text, (id) => pastedChunksRef.current.get(id)?.content);
  };

  /** 处理单个普通输入字符/按键（非粘贴） */
  const handleNormalInput = (raw: string) => {
    const v = valueRef.current;
    const c = cursorRef.current;

    // Alt+Enter → 插入换行
    if (raw === '\x1B\r' || raw === '\x1B\n') {
      const result = insertTextAtCursor(v, c, '\n');
      emitChange(result.value);
      setCursor(result.cursor);
      return;
    }

    // Enter → 提交（展开占位符）
    if (raw === '\r' || raw === '\n') {
      // 斜杠菜单激活时，回车 = 选中当前项
      if (slashMenuActiveRef.current) {
        onSubmitRef.current(v);
        return;
      }
      const expanded = expandPlaceholders(v);
      onSubmitRef.current(expanded);
      return;
    }

    // Backspace
    if (raw === '\x7F' || raw === '\x08') {
      if (c > 0) {
        const ph = findPlaceholderBeforeCursor(v, c);
        if (ph) {
          const match = v.slice(ph.start, ph.end).match(/\[Pasted text #(\d+)/);
          if (match) pastedChunksRef.current.delete(parseInt(match[1], 10));
          const result = removeTextRange(v, ph.start, ph.end);
          emitChange(result.value);
          setCursor(result.cursor);
        } else {
          const result = removeTextRange(v, c - 1, c);
          emitChange(result.value);
          setCursor(result.cursor);
        }
      }
      return;
    }

    // ← 左移光标
    if (raw === '\x1B[D') { setCursor(prev => Math.max(0, prev - 1)); return; }
    // → 右移光标
    if (raw === '\x1B[C') { setCursor(prev => Math.min(v.length, prev + 1)); return; }

    // ↑ 上移光标
    if (raw === '\x1B[A') {
      // 斜杠菜单激活时，上箭头 = 选中上一项
      if (slashMenuActiveRef.current) {
        onSlashMenuUpRef.current?.();
        return;
      }
      const lines = v.split('\n');
      if (lines.length <= 1) { onUpArrowRef.current?.(); return; }
      const { row, col } = getCursorRowCol(v, c);
      if (row === 0) { onUpArrowRef.current?.(); return; }
      setCursor(rowColToOffset(v, row - 1, col));
      return;
    }

    // ↓ 下移光标
    if (raw === '\x1B[B') {
      // 斜杠菜单激活时，下箭头 = 选中下一项
      if (slashMenuActiveRef.current) {
        onSlashMenuDownRef.current?.();
        return;
      }
      const lines = v.split('\n');
      if (lines.length <= 1) { onDownArrowRef.current?.(); return; }
      const { row, col } = getCursorRowCol(v, c);
      if (row >= lines.length - 1) { onDownArrowRef.current?.(); return; }
      setCursor(rowColToOffset(v, row + 1, col));
      return;
    }

    // Ctrl+C → 不在此处处理，交给上层 useInput 的双击退出逻辑
    if (raw === '\x03') return;
    // 忽略控制字符和转义序列
    if (raw === '\t') {
      // 斜杠菜单激活时，Tab = 补全当前项到输入框
      if (slashMenuActiveRef.current) {
        onSlashMenuSelectRef.current?.();
      } else if (valueRef.current.length === 0) {
        // 输入为空时，Tab = 填入 placeholder
        onTabFillPlaceholderRef.current?.();
      }
      return;
    }
    if (raw === '\x1B') {
      // 斜杠菜单激活时，ESC = 关闭菜单
      if (slashMenuActiveRef.current) {
        onSlashMenuCloseRef.current?.();
      }
      return;
    }
    if (raw.length === 1 && raw.charCodeAt(0) < 32) return;
    if (raw.startsWith('\x1B[') || raw.startsWith('\x1B]') || raw.startsWith('\x1BO')) return;

    // 可打印字符 → 在光标位置插入
    const result = insertTextAtCursor(v, c, raw);
    emitChange(result.value);
    setCursor(result.cursor);
  };

  /** 提交 IME 缓冲区中的拼音为普通文本（composing 超时或被打断时调用） */
  const commitImeBuffer = () => {
    const buf = imeBufferRef.current;
    const insertedLen = imeInsertedLenRef.current;
    imeBufferRef.current = '';
    imeInsertedLenRef.current = 0;
    if (!buf) return;
    // 需要插入的是 buf 中尚未被临时插入的部分
    const remaining = buf.slice(insertedLen);
    if (remaining.length > 0) {
      handleNormalInput(remaining);
    }
  };

  /** IME composing 超时：将积累的拼音作为普通文本提交 */
  const flushImeBuffer = () => {
    commitImeBuffer();
  };

  const clearImeBufferWithInsertedLenRollback = () => {
    const insertedLen = imeInsertedLenRef.current;
    imeBufferRef.current = '';
    imeInsertedLenRef.current = 0;
    if (insertedLen <= 0) return;
    const v = valueRef.current;
    const c = cursorRef.current;
    const result = removeTextRange(v, c - insertedLen, c);
    emitChange(result.value);
    setCursor(result.cursor);
  };

  useMultilineInputStream({
    stdin: stdin ?? undefined,
    isActive,
    pasteDetectWindowMs: PASTE_DETECT_WINDOW_MS,
    imeComposeWindowMs: IME_COMPOSE_WINDOW_MS,
    isAsciiLowerAlpha,
    hasNonAscii,
    insertPaste,
    handleNormalInput,
    commitImeBuffer,
    flushImeBuffer,
    appendImeBuffer: (text) => {
      imeBufferRef.current += text;
    },
    getImeBuffer: () => imeBufferRef.current,
    clearImeBufferWithInsertedLenRollback,
  });

  useInput(() => {}, { isActive });
  useTerminalCursorSync({ showCursor, isActive, rowsBelow });

  return (
    <InputTextView
      value={value}
      cursor={cursor}
      placeholder={placeholder}
      showCursor={showCursor}
      onResetPastedChunks={() => {
        if (pasteCountRef.current > 0) {
          pasteCountRef.current = 0;
          pastedChunksRef.current.clear();
        }
      }}
    />
  );
}
