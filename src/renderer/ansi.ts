/**
 * ANSI 转义序列工具集
 *
 * 提供终端控制所需的底层 ANSI 操作，包括颜色、光标移动、清除等。
 */

const ESC = '\x1B[';

// ===== 光标控制 =====

export function cursorUp(n = 1): string { return n > 0 ? `${ESC}${n}A` : ''; }
export function cursorDown(n = 1): string { return n > 0 ? `${ESC}${n}B` : ''; }
export function cursorForward(n = 1): string { return n > 0 ? `${ESC}${n}C` : ''; }
export function cursorBack(n = 1): string { return n > 0 ? `${ESC}${n}D` : ''; }
export function cursorTo(col: number): string { return `${ESC}${col}G`; }
export function cursorPosition(row: number, col: number): string { return `${ESC}${row};${col}H`; }
export function saveCursor(): string { return `${ESC}s`; }
export function restoreCursor(): string { return `${ESC}u`; }
export function hideCursor(): string { return `${ESC}?25l`; }
export function showCursor(): string { return `${ESC}?25h`; }

// ===== 清除 =====

export function clearLine(): string { return `${ESC}2K`; }
export function clearLineFromCursor(): string { return `${ESC}0K`; }
export function clearDown(): string { return `${ESC}J`; }
export function clearScreen(): string { return `${ESC}2J`; }

// ===== 颜色 =====

export const RESET = '\x1B[0m';
export const BOLD = '\x1B[1m';
export const DIM = '\x1B[2m';
export const ITALIC = '\x1B[3m';
export const UNDERLINE = '\x1B[4m';
export const INVERSE = '\x1B[7m';

// 前景色
export function fg(color: string): string {
  const map: Record<string, string> = {
    black: '30', red: '31', green: '32', yellow: '33',
    blue: '34', magenta: '35', cyan: '36', white: '37',
    gray: '90', grey: '90',
    brightRed: '91', brightGreen: '92', brightYellow: '93',
    brightBlue: '94', brightMagenta: '95', brightCyan: '96', brightWhite: '97',
  };
  const code = map[color];
  return code ? `\x1B[${code}m` : '';
}

// 背景色
export function bg(color: string): string {
  const map: Record<string, string> = {
    black: '40', red: '41', green: '42', yellow: '43',
    blue: '44', magenta: '45', cyan: '46', white: '47',
  };
  const code = map[color];
  return code ? `\x1B[${code}m` : '';
}

// 256 色
export function fg256(n: number): string { return `\x1B[38;5;${n}m`; }
export function bg256(n: number): string { return `\x1B[48;5;${n}m`; }

// ===== 辅助 =====

/** 去除 ANSI 转义序列，返回可见文本 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** 计算字符显示宽度（CJK 字符占 2 列） */
export function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    )
  ) return 2;
  return 1;
}

/** 计算字符串显示宽度 */
export function textWidth(text: string): number {
  const plain = stripAnsi(text);
  let w = 0;
  for (const ch of plain) w += charWidth(ch);
  return w;
}

/** 截断文本到指定显示宽度 */
export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  const plain = stripAnsi(text);
  if (textWidth(plain) <= maxWidth) return text;
  if (maxWidth === 1) return '…';
  let result = '';
  let w = 0;
  for (const ch of plain) {
    const cw = charWidth(ch);
    if (w + cw > maxWidth - 1) break;
    result += ch;
    w += cw;
  }
  return result + '…';
}

// ===== Bracketed Paste =====

export function enableBracketedPaste(): void {
  process.stdout.write(`${ESC}?2004h`);
}

export function disableBracketedPaste(): void {
  process.stdout.write(`${ESC}?2004l`);
}
