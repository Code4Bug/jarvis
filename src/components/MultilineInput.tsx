import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';

/** 粘贴占位符的正则，匹配 [Pasted text #N +X lines] */
const PASTE_PLACEHOLDER_RE = /\[Pasted text #(\d+) \+(\d+) lines\]/g;

/** 粘贴检测的时间窗口（ms），在此窗口内连续到达的数据视为一次粘贴 */
const PASTE_DETECT_WINDOW_MS = 8;

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
}: MultilineInputProps) {
  const { stdin } = useStdin();
  const [cursor, setCursor] = useState(value.length);

  // 粘贴内容存储
  const pasteCountRef = useRef(0);
  const pastedChunksRef = useRef<Map<number, PastedChunk>>(new Map());

  // bracketed paste 缓冲
  const pasteBufferRef = useRef<string | null>(null);

  // 时间窗口粘贴检测：收集短时间内连续到达的数据块
  const batchBufferRef = useRef('');
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 启用 bracketed paste mode
  useEffect(() => {
    if (!stdin || !isActive) return;
    process.stdout.write('\x1B[?2004h');
    return () => {
      process.stdout.write('\x1B[?2004l');
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

  // 辅助：根据光标偏移计算所在行号和行内列号
  const getCursorRowCol = (text: string, pos: number) => {
    const before = text.slice(0, pos);
    const row = (before.match(/\n/g) || []).length;
    const lastNewline = before.lastIndexOf('\n');
    const col = lastNewline === -1 ? pos : pos - lastNewline - 1;
    return { row, col };
  };

  // 辅助：根据行号和列号计算偏移
  const rowColToOffset = (text: string, row: number, col: number) => {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < row && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    const targetLine = lines[Math.min(row, lines.length - 1)] ?? '';
    return offset + Math.min(col, targetLine.length);
  };

  /** 将粘贴的多行内容折叠为占位符，插入到当前光标位置 */
  const insertPaste = (pastedText: string) => {
    const v = valueRef.current;
    const c = cursorRef.current;
    const cleaned = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lineCount = cleaned.split('\n').length;

    // 单行粘贴直接插入，不折叠
    if (lineCount <= 1) {
      const newVal = v.slice(0, c) + cleaned + v.slice(c);
      emitChange(newVal);
      setCursor(c + cleaned.length);
      return;
    }

    // 多行 → 生成占位符
    const id = ++pasteCountRef.current;
    pastedChunksRef.current.set(id, { id, content: cleaned, lineCount });
    const tag = `[Pasted text #${id} +${lineCount} lines]`;
    const newVal = v.slice(0, c) + tag + v.slice(c);
    emitChange(newVal);
    setCursor(c + tag.length);
  };

  /** 展开 value 中所有占位符为真实内容 */
  const expandPlaceholders = (text: string): string => {
    return text.replace(PASTE_PLACEHOLDER_RE, (match, idStr) => {
      const id = parseInt(idStr, 10);
      const chunk = pastedChunksRef.current.get(id);
      return chunk ? chunk.content : match;
    });
  };

  /** 检测光标前是否紧邻一个占位符 */
  const findPlaceholderBeforeCursor = (text: string, pos: number): { start: number; end: number } | null => {
    if (pos === 0 || text[pos - 1] !== ']') return null;
    const before = text.slice(0, pos);
    const idx = before.lastIndexOf('[Pasted text #');
    if (idx === -1) return null;
    const sub = before.slice(idx);
    const m = sub.match(/^\[Pasted text #\d+ \+\d+ lines\]$/);
    if (m) return { start: idx, end: pos };
    return null;
  };

  /** 处理单个普通输入字符/按键（非粘贴） */
  const handleNormalInput = (raw: string) => {
    const v = valueRef.current;
    const c = cursorRef.current;

    // Alt+Enter → 插入换行
    if (raw === '\x1B\r' || raw === '\x1B\n') {
      const newVal = v.slice(0, c) + '\n' + v.slice(c);
      emitChange(newVal);
      setCursor(c + 1);
      return;
    }

    // Enter → 提交（展开占位符）
    if (raw === '\r' || raw === '\n') {
      // 斜杠菜单激活时，回车 = 选中当前项
      if (slashMenuActiveRef.current) {
        onSlashMenuSelectRef.current?.();
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
          const newVal = v.slice(0, ph.start) + v.slice(ph.end);
          emitChange(newVal);
          setCursor(ph.start);
        } else {
          const newVal = v.slice(0, c - 1) + v.slice(c);
          emitChange(newVal);
          setCursor(c - 1);
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
      // 斜杠菜单激活时，Tab = 选中当前项
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
    const newVal = v.slice(0, c) + raw + v.slice(c);
    emitChange(newVal);
    setCursor(c + raw.length);
  };

  /**
   * 处理批量缓冲区中积累的数据。
   * 如果缓冲区包含换行（多行），视为粘贴；否则逐字符处理。
   */
  const flushBatchBuffer = () => {
    const buf = batchBufferRef.current;
    batchBufferRef.current = '';
    batchTimerRef.current = null;
    if (!buf) return;

    const cleaned = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // 多行 → 粘贴
    if (cleaned.includes('\n') && cleaned.length > 1) {
      insertPaste(cleaned);
    } else {
      // 单字符或单行短文本，按普通输入处理
      handleNormalInput(buf);
    }
  };

  // Alt+Enter 组合键检测：ESC 可能单独到达，需要等待后续字符
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ESC_WAIT_MS = 50; // 等待后续字符的时间窗口

  useEffect(() => {
    if (!stdin || !isActive) return;

    const onData = (data: Buffer) => {
      const raw = data.toString('utf-8');

      // === Bracketed paste 模式处理（优先级最高） ===
      if (raw.includes('\x1B[200~')) {
        const startIdx = raw.indexOf('\x1B[200~') + 6;
        const endIdx = raw.indexOf('\x1B[201~');
        if (endIdx !== -1) {
          insertPaste(raw.slice(startIdx, endIdx));
        } else {
          pasteBufferRef.current = raw.slice(startIdx);
        }
        return;
      }
      if (pasteBufferRef.current !== null) {
        const endIdx = raw.indexOf('\x1B[201~');
        if (endIdx !== -1) {
          pasteBufferRef.current += raw.slice(0, endIdx);
          insertPaste(pasteBufferRef.current);
          pasteBufferRef.current = null;
        } else {
          pasteBufferRef.current += raw;
        }
        return;
      }

      // === 处理 ESC 等待状态：上一次收到了单独的 ESC，现在看后续字符 ===
      if (escTimerRef.current !== null) {
        clearTimeout(escTimerRef.current);
        escTimerRef.current = null;
        if (raw === '\r' || raw === '\n') {
          // ESC + Enter = Alt+Enter → 插入换行
          handleNormalInput('\x1B\r');
          return;
        }
        // ESC + 其他字符：先处理 ESC 本身，再处理当前字符
        handleNormalInput('\x1B');
        // 继续往下处理当前 raw
      }

      // === 非 bracketed paste：用时间窗口检测 ===
      // 控制字符和转义序列不参与批量缓冲，直接处理
      const isSingleControl =
        raw === '\r' || raw === '\n' ||
        raw === '\x7F' || raw === '\x08' ||
        raw === '\t' || raw === '\x1B' ||
        raw === '\x1B\r' || raw === '\x1B\n' ||
        raw.startsWith('\x1B[') || raw.startsWith('\x1B]') || raw.startsWith('\x1BO');

      // Ctrl+C → 不拦截，让上层 useInput 处理双击退出
      if (raw === '\x03') return;

      // Ctrl+O → 不拦截，让上层 useInput 处理详情展开/折叠
      if (raw === '\x0F') return;

      // Ctrl+L → 拦截，不穿透到终端（避免清屏）
      if (raw === '\x0C') return;

      // 单独的 ESC：进入等待状态，看后续是否跟着 Enter（Alt+Enter 组合）
      if (raw === '\x1B') {
        escTimerRef.current = setTimeout(() => {
          escTimerRef.current = null;
          handleNormalInput('\x1B');
        }, ESC_WAIT_MS);
        return;
      }

      if (isSingleControl && batchBufferRef.current === '') {
        // 没有正在积累的缓冲，直接处理控制字符
        handleNormalInput(raw);
        return;
      }

      if (isSingleControl && batchBufferRef.current !== '') {
        // 有缓冲在积累中，控制字符也追加进去（可能是粘贴内容中的 \r）
        batchBufferRef.current += raw;
        return;
      }

      // 可打印字符：追加到批量缓冲，重置定时器
      batchBufferRef.current += raw;
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
      }
      batchTimerRef.current = setTimeout(flushBatchBuffer, PASTE_DETECT_WINDOW_MS);
    };

    stdin.prependListener('data', onData);
    return () => {
      stdin.off('data', onData);
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      if (escTimerRef.current !== null) {
        clearTimeout(escTimerRef.current);
        escTimerRef.current = null;
      }
    };
  }, [stdin, isActive]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
      }
      if (escTimerRef.current !== null) {
        clearTimeout(escTimerRef.current);
      }
    };
  }, []);

  useInput(() => {}, { isActive });

  // --- 渲染 ---
  const isEmpty = value.length === 0;

  if (isEmpty) {
    // value 清空时重置粘贴状态
    if (pasteCountRef.current > 0) {
      pasteCountRef.current = 0;
      pastedChunksRef.current.clear();
    }
    if (showCursor && placeholder.length > 0) {
      return (
        <Box>
          <Text inverse color="white">{placeholder[0]}</Text>
          <Text color="gray">{placeholder.slice(1)}</Text>
          <Text color="gray" dimColor>  [Tab]</Text>
        </Box>
      );
    }
    return (
      <Box>
        {showCursor && <Text inverse> </Text>}
        <Text color="gray">{placeholder}</Text>
      </Box>
    );
  }

  const lines = value.split('\n');
  const { row: cursorRow, col: cursorCol } = getCursorRowCol(value, cursor);

  /** 渲染一段文本，将其中的占位符高亮 */
  const renderWithPlaceholders = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const re = new RegExp(PASTE_PLACEHOLDER_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) {
        parts.push(<Text key={`${keyPrefix}-t-${lastIndex}`}>{text.slice(lastIndex, m.index)}</Text>);
      }
      parts.push(
        <Text key={`${keyPrefix}-p-${m.index}`} color="cyan" dimColor>{m[0]}</Text>
      );
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(<Text key={`${keyPrefix}-t-${lastIndex}`}>{text.slice(lastIndex)}</Text>);
    }
    return parts;
  };

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (!showCursor || i !== cursorRow) {
          const parts = renderWithPlaceholders(line, `l${i}`);
          return <Box key={i}>{parts.length > 0 ? parts : <Text> </Text>}</Box>;
        }

        // 光标所在行
        const before = line.slice(0, cursorCol);
        const cursorChar = line[cursorCol] ?? ' ';
        const after = line.slice(cursorCol + 1);

        return (
          <Box key={i}>
            {renderWithPlaceholders(before, 'b')}
            <Text inverse>{cursorChar}</Text>
            {renderWithPlaceholders(after, 'a')}
          </Box>
        );
      })}
    </Box>
  );
}
