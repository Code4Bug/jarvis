/**
 * Markdown 到 ANSI 终端文本渲染器
 *
 * 复用原有的 marked + marked-terminal 渲染逻辑，
 * 但不依赖 Ink 组件，直接返回 ANSI 字符串。
 */

import { Marked } from 'marked';
// @ts-ignore
import { markedTerminal } from 'marked-terminal';

// ===== ANSI 颜色常量 =====
const RESET = '\x1b[0m';
const BG_CODE = '\x1b[48;5;236m';
const FG_LANG = '\x1b[38;5;243m';
const FG_BORDER = '\x1b[38;5;240m';
const FG_CODE = '\x1b[38;5;252m';

function getTermWidth(): number {
  return Math.min(process.stdout.columns || 80, 100);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function renderCodeBlock(code: string, lang?: string): string {
  const width = getTermWidth() - 4;
  const innerWidth = width - 2;
  const lines = code.replace(/\n$/, '').split('\n');
  const langTag = lang ? ` ${lang} ` : '';
  const topBarFill = innerWidth - langTag.length;

  const parts: string[] = [];
  parts.push(
    `${FG_BORDER}┌${'─'.repeat(Math.max(topBarFill - langTag.length, 1))}${FG_LANG}${langTag}${FG_BORDER}${'─'.repeat(Math.min(langTag.length, topBarFill))}┐${RESET}`,
  );

  for (const line of lines) {
    const visible = stripAnsi(line);
    const pad = Math.max(innerWidth - visible.length, 0);
    parts.push(
      `${FG_BORDER}│${RESET}${BG_CODE}${FG_CODE}${line}${' '.repeat(pad)}${RESET}${FG_BORDER}│${RESET}`,
    );
  }

  parts.push(`${FG_BORDER}└${'─'.repeat(innerWidth)}┘${RESET}`);
  return '\n' + parts.join('\n') + '\n';
}

// 表格边框字符
const TABLE_CHARS = {
  top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
  bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
  left: '│', 'left-mid': '├',
  mid: '─', 'mid-mid': '┼',
  right: '│', 'right-mid': '┤',
  middle: '│',
};

function extractTokenText(tokens: any[]): string {
  if (!tokens || !Array.isArray(tokens)) return '';
  return tokens.map((t: any) => {
    if (t.type === 'text' || t.type === 'codespan') return t.text || t.raw || '';
    if (t.type === 'strong' || t.type === 'em' || t.type === 'del') return extractTokenText(t.tokens);
    if (t.type === 'link') return extractTokenText(t.tokens);
    return t.raw || t.text || '';
  }).join('');
}

function calcColWidths(colCount: number): number[] {
  const termWidth = getTermWidth();
  const borderOverhead = colCount + 1;
  const paddingOverhead = colCount * 2;
  const available = Math.max(termWidth - borderOverhead - paddingOverhead, colCount * 6);
  const baseWidth = Math.floor(available / colCount);
  const remainder = available - baseWidth * colCount;
  return Array.from({ length: colCount }, (_, i) =>
    baseWidth + (i < remainder ? 1 : 0) + 2,
  );
}

function renderTable(token: any): string {
  // 简化表格渲染，不依赖 cli-table3
  const headerCells: string[] = token.header.map((cell: any) => extractTokenText(cell.tokens));
  const bodyRows: string[][] = token.rows.map((row: any) =>
    row.map((cell: any) => extractTokenText(cell.tokens)),
  );

  const colCount = headerCells.length;
  if (colCount === 0) return '';

  const colWidths = calcColWidths(colCount);
  const lines: string[] = [];

  // 顶部边框
  lines.push('┌' + colWidths.map((w) => '─'.repeat(w)).join('┬') + '┐');
  // 表头
  const headerLine = '│' + headerCells.map((cell, i) => {
    const w = colWidths[i] - 2;
    const text = cell.length > w ? cell.slice(0, w - 1) + '…' : cell;
    return ' ' + text + ' '.repeat(Math.max(w - text.length, 0)) + ' ';
  }).join('│') + '│';
  lines.push(`\x1b[1m\x1b[36m${headerLine}${RESET}`);
  // 分隔线
  lines.push('├' + colWidths.map((w) => '─'.repeat(w)).join('┼') + '┤');
  // 数据行
  for (const row of bodyRows) {
    const rowLine = '│' + row.map((cell, i) => {
      const w = colWidths[i] - 2;
      const text = cell.length > w ? cell.slice(0, w - 1) + '…' : cell;
      return ' ' + text + ' '.repeat(Math.max(w - text.length, 0)) + ' ';
    }).join('│') + '│';
    lines.push(rowLine);
  }
  // 底部边框
  lines.push('└' + colWidths.map((w) => '─'.repeat(w)).join('┴') + '┘');

  return '\n' + lines.join('\n') + '\n\n';
}

const marked = new Marked(
  markedTerminal({
    reflowText: false,
    code: renderCodeBlock,
    tableOptions: { chars: TABLE_CHARS },
  }) as any,
  {
    renderer: {
      table: renderTable as any,
    },
  },
);

/** 补全流式文本中未闭合的 markdown 结构 */
function patchIncompleteMarkdown(text: string): string {
  let patched = text;
  const fenceMatches = patched.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 !== 0) {
    patched += '\n```';
  }
  const backtickCount = (patched.match(/(?<!\\)`/g) || []).length;
  if (backtickCount % 2 !== 0) {
    patched += '`';
  }
  return patched;
}

/** 将 markdown 文本渲染为终端 ANSI 字符串 */
export function renderMarkdownToAnsi(text: string): string {
  try {
    const patched = patchIncompleteMarkdown(text);
    const rendered = marked.parse(patched) as string;
    return rendered.replace(/^\n+/, '').replace(/\n+$/, '');
  } catch {
    return text;
  }
}
