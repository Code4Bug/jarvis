/**
 * 原生终端输入处理器
 *
 * 直接监听 stdin，处理按键事件，不依赖 Ink 的 useInput。
 * 支持：光标移动、历史浏览、粘贴检测、IME composing、斜杠菜单。
 */

import {
  expandPlaceholders as expandPastedPlaceholders,
  findPlaceholderBeforeCursor,
  getCursorRowCol,
  insertTextAtCursor,
  removeTextRange,
  rowColToOffset,
} from '../components/inputEditing.js';

const PASTE_DETECT_WINDOW_MS = 8;
const IME_COMPOSE_WINDOW_MS = 80;
const ESC_WAIT_MS = 50;

const isAsciiLowerAlpha = (s: string) => /^[a-z]+$/.test(s);
const hasNonAscii = (s: string) => /[^\x00-\x7F]/.test(s);

export interface InputCallbacks {
  onSubmit: (value: string) => void;
  onInputChange: (value: string, cursor: number) => void;
  onUpArrow: () => void;
  onDownArrow: () => void;
  onCtrlC: () => void;
  onEscape: () => void;
  onCtrlO: () => void;
  onCtrlL: () => void;
  onTab: () => void;
  /** 斜杠菜单回调 */
  onSlashMenuUp: () => void;
  onSlashMenuDown: () => void;
  onSlashMenuSelect: () => void;
  onSlashMenuClose: () => void;
  /** 危险确认回调 */
  onDangerConfirmUp?: () => void;
  onDangerConfirmDown?: () => void;
  onDangerConfirmSelect?: () => void;
  onDangerConfirmCancel?: () => void;
}

export class NativeInputHandler {
  private value = '';
  private cursor = 0;
  private callbacks: InputCallbacks;
  private isActive = true;
  private isProcessing = false;
  private slashMenuActive = false;
  private dangerConfirmActive = false;

  // 粘贴
  private pasteBuffer: string | null = null;
  private pasteCount = 0;
  private pastedChunks = new Map<number, { id: number; content: string; lineCount: number }>();

  // 批量输入检测
  private batchBuffer = '';
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  // IME
  private imeBuffer = '';
  private imeInsertedLen = 0;
  private imeTimer: ReturnType<typeof setTimeout> | null = null;

  // ESC 延迟
  private escTimer: ReturnType<typeof setTimeout> | null = null;

  // stdin listener
  private dataListener: ((data: Buffer) => void) | null = null;

  constructor(callbacks: InputCallbacks) {
    this.callbacks = callbacks;
  }

  getValue(): string { return this.value; }
  getCursor(): number { return this.cursor; }

  setValue(value: string, cursor?: number): void {
    this.value = value;
    this.cursor = cursor ?? value.length;
  }

  setActive(active: boolean): void { this.isActive = active; }
  setProcessing(processing: boolean): void { this.isProcessing = processing; }
  setSlashMenuActive(active: boolean): void { this.slashMenuActive = active; }
  setDangerConfirmActive(active: boolean): void { this.dangerConfirmActive = active; }

  /** 开始监听 stdin */
  start(): void {
    if (this.dataListener) return;

    // 确保 stdin 处于 raw mode
    if (process.stdin.isTTY && !process.stdin.isRaw) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    this.dataListener = (data: Buffer) => {
      const raw = data.toString('utf-8');
      this.handleRawInput(raw);
    };

    process.stdin.on('data', this.dataListener);
  }

  /** 停止监听 */
  stop(): void {
    if (this.dataListener) {
      process.stdin.off('data', this.dataListener);
      this.dataListener = null;
    }
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.batchTimer) { clearTimeout(this.batchTimer); this.batchTimer = null; }
    if (this.imeTimer) { clearTimeout(this.imeTimer); this.imeTimer = null; }
    if (this.escTimer) { clearTimeout(this.escTimer); this.escTimer = null; }
  }

  private handleRawInput(raw: string): void {
    // 危险确认模式下只允许上下箭头、Enter、ESC、Ctrl+C
    if (this.dangerConfirmActive) {
      if (raw === '\x03') { this.callbacks.onCtrlC(); return; }
      if (raw === '\x1B') { this.callbacks.onDangerConfirmCancel?.(); return; }
      if (raw === '\x1B[A') { this.callbacks.onDangerConfirmUp?.(); return; }
      if (raw === '\x1B[B') { this.callbacks.onDangerConfirmDown?.(); return; }
      if (raw === '\r' || raw === '\n') { this.callbacks.onDangerConfirmSelect?.(); return; }
      return;
    }

    // processing 状态下只允许 Ctrl+C、ESC、Ctrl+O
    if (this.isProcessing) {
      if (raw === '\x03') { this.callbacks.onCtrlC(); return; }
      if (raw === '\x1B') { this.callbacks.onEscape(); return; }
      if (raw === '\x0F') { this.callbacks.onCtrlO(); return; }
      return;
    }

    // Ctrl+C
    if (raw === '\x03') { this.callbacks.onCtrlC(); return; }
    // Ctrl+O
    if (raw === '\x0F') { this.callbacks.onCtrlO(); return; }
    // Ctrl+L
    if (raw === '\x0C') { this.callbacks.onCtrlL(); return; }

    // Bracketed paste
    if (raw.includes('\x1B[200~')) {
      const startIdx = raw.indexOf('\x1B[200~') + 6;
      const endIdx = raw.indexOf('\x1B[201~');
      if (endIdx !== -1) {
        this.insertPaste(raw.slice(startIdx, endIdx));
      } else {
        this.pasteBuffer = raw.slice(startIdx);
      }
      return;
    }
    if (this.pasteBuffer !== null) {
      const endIdx = raw.indexOf('\x1B[201~');
      if (endIdx !== -1) {
        this.pasteBuffer += raw.slice(0, endIdx);
        this.insertPaste(this.pasteBuffer);
        this.pasteBuffer = null;
      } else {
        this.pasteBuffer += raw;
      }
      return;
    }

    // ESC 延迟处理
    if (this.escTimer !== null) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
      if (raw === '\r' || raw === '\n') {
        this.handleNormalInput('\x1B\r');
        return;
      }
      // ESC + [ 开头的序列
      if (raw.startsWith('[')) {
        this.handleNormalInput('\x1B' + raw);
        return;
      }
      this.handleNormalInput('\x1B');
    }

    // 单独的 ESC
    if (raw === '\x1B') {
      this.escTimer = setTimeout(() => {
        this.escTimer = null;
        this.callbacks.onEscape();
      }, ESC_WAIT_MS);
      return;
    }

    const isSingleControl =
      raw === '\r' || raw === '\n' ||
      raw === '\x7F' || raw === '\x08' ||
      raw === '\t' ||
      raw === '\x1B\r' || raw === '\x1B\n' ||
      raw.startsWith('\x1B[') || raw.startsWith('\x1B]') || raw.startsWith('\x1BO');

    // Focus reporting 序列，忽略
    if (raw === '\x1B[I' || raw === '\x1B[O') return;

    if (isSingleControl && this.batchBuffer === '') {
      if (this.imeBuffer.length > 0) this.commitImeBuffer();
      this.handleNormalInput(raw);
      return;
    }

    if (isSingleControl && this.batchBuffer !== '') {
      this.batchBuffer += raw;
      return;
    }

    // 可打印字符，积累到 batch buffer
    this.batchBuffer += raw;
    if (this.batchTimer !== null) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.flushBatchBuffer(), PASTE_DETECT_WINDOW_MS);
  }

  private flushBatchBuffer(): void {
    const buf = this.batchBuffer;
    this.batchBuffer = '';
    this.batchTimer = null;
    if (!buf) return;

    const cleaned = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (cleaned.includes('\n') && cleaned.length > 1) {
      this.insertPaste(cleaned);
      return;
    }

    if (isAsciiLowerAlpha(buf)) {
      this.imeBuffer += buf;
      if (this.imeTimer !== null) clearTimeout(this.imeTimer);
      this.imeTimer = setTimeout(() => this.flushImeBuffer(), IME_COMPOSE_WINDOW_MS);
      return;
    }

    if (hasNonAscii(buf) && this.imeBuffer.length > 0) {
      if (this.imeTimer !== null) { clearTimeout(this.imeTimer); this.imeTimer = null; }
      this.clearImeBufferWithRollback();
      this.handleNormalInput(buf);
      return;
    }

    if (this.imeBuffer.length > 0) this.commitImeBuffer();
    this.handleNormalInput(buf);
  }

  private commitImeBuffer(): void {
    const buf = this.imeBuffer;
    const insertedLen = this.imeInsertedLen;
    this.imeBuffer = '';
    this.imeInsertedLen = 0;
    if (!buf) return;
    const remaining = buf.slice(insertedLen);
    if (remaining.length > 0) this.handleNormalInput(remaining);
  }

  private flushImeBuffer(): void {
    this.commitImeBuffer();
  }

  private clearImeBufferWithRollback(): void {
    const insertedLen = this.imeInsertedLen;
    this.imeBuffer = '';
    this.imeInsertedLen = 0;
    if (insertedLen <= 0) return;
    const result = removeTextRange(this.value, this.cursor - insertedLen, this.cursor);
    this.value = result.value;
    this.cursor = result.cursor;
    this.emitChange();
  }

  private insertPaste(pastedText: string): void {
    const cleaned = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lineCount = cleaned.split('\n').length;

    if (lineCount <= 1) {
      const result = insertTextAtCursor(this.value, this.cursor, cleaned);
      this.value = result.value;
      this.cursor = result.cursor;
      this.emitChange();
      return;
    }

    const id = ++this.pasteCount;
    this.pastedChunks.set(id, { id, content: cleaned, lineCount });
    const tag = `[Pasted text #${id} +${lineCount} lines]`;
    const result = insertTextAtCursor(this.value, this.cursor, tag);
    this.value = result.value;
    this.cursor = result.cursor;
    this.emitChange();
  }

  private expandPlaceholders(text: string): string {
    return expandPastedPlaceholders(text, (id) => this.pastedChunks.get(id)?.content);
  }

  private handleNormalInput(raw: string): void {
    // Alt+Enter → 换行
    if (raw === '\x1B\r' || raw === '\x1B\n') {
      const result = insertTextAtCursor(this.value, this.cursor, '\n');
      this.value = result.value;
      this.cursor = result.cursor;
      this.emitChange();
      return;
    }

    // Enter → 提交
    if (raw === '\r' || raw === '\n') {
      if (this.slashMenuActive) {
        this.callbacks.onSubmit(this.value);
        return;
      }
      const expanded = this.expandPlaceholders(this.value);
      this.callbacks.onSubmit(expanded);
      return;
    }

    // Backspace
    if (raw === '\x7F' || raw === '\x08') {
      if (this.cursor > 0) {
        const ph = findPlaceholderBeforeCursor(this.value, this.cursor);
        if (ph) {
          const match = this.value.slice(ph.start, ph.end).match(/\[Pasted text #(\d+)/);
          if (match) this.pastedChunks.delete(parseInt(match[1], 10));
          const result = removeTextRange(this.value, ph.start, ph.end);
          this.value = result.value;
          this.cursor = result.cursor;
        } else {
          const result = removeTextRange(this.value, this.cursor - 1, this.cursor);
          this.value = result.value;
          this.cursor = result.cursor;
        }
        this.emitChange();
      }
      return;
    }

    // ← 左移
    if (raw === '\x1B[D') { this.cursor = Math.max(0, this.cursor - 1); this.emitChange(); return; }
    // → 右移
    if (raw === '\x1B[C') { this.cursor = Math.min(this.value.length, this.cursor + 1); this.emitChange(); return; }

    // ↑
    if (raw === '\x1B[A') {
      if (this.slashMenuActive) { this.callbacks.onSlashMenuUp(); return; }
      const lines = this.value.split('\n');
      if (lines.length <= 1) { this.callbacks.onUpArrow(); return; }
      const { row, col } = getCursorRowCol(this.value, this.cursor);
      if (row === 0) { this.callbacks.onUpArrow(); return; }
      this.cursor = rowColToOffset(this.value, row - 1, col);
      this.emitChange();
      return;
    }

    // ↓
    if (raw === '\x1B[B') {
      if (this.slashMenuActive) { this.callbacks.onSlashMenuDown(); return; }
      const lines = this.value.split('\n');
      if (lines.length <= 1) { this.callbacks.onDownArrow(); return; }
      const { row, col } = getCursorRowCol(this.value, this.cursor);
      if (row >= lines.length - 1) { this.callbacks.onDownArrow(); return; }
      this.cursor = rowColToOffset(this.value, row + 1, col);
      this.emitChange();
      return;
    }

    // Tab
    if (raw === '\t') {
      if (this.slashMenuActive) {
        this.callbacks.onSlashMenuSelect();
      } else if (this.value.length === 0) {
        this.callbacks.onTab();
      }
      return;
    }

    // 忽略控制字符和转义序列
    if (raw.length === 1 && raw.charCodeAt(0) < 32) return;
    if (raw.startsWith('\x1B[') || raw.startsWith('\x1B]') || raw.startsWith('\x1BO')) return;

    // 可打印字符
    const result = insertTextAtCursor(this.value, this.cursor, raw);
    this.value = result.value;
    this.cursor = result.cursor;
    this.emitChange();
  }

  private emitChange(): void {
    this.callbacks.onInputChange(this.value, this.cursor);
  }

  /** 重置粘贴状态 */
  resetPasteState(): void {
    this.pasteCount = 0;
    this.pastedChunks.clear();
  }
}
