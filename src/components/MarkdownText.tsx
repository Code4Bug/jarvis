import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Marked } from 'marked';
// @ts-ignore — marked-terminal 无内置类型声明
import { markedTerminal } from 'marked-terminal';
// @ts-ignore
import Table from 'cli-table3';
// @ts-ignore — wrap-ansi 无显式类型声明
import wrapAnsi from 'wrap-ansi';

// ===== ANSI 颜色常量 =====
const RESET = '\x1b[0m';
const BG_CODE = '\x1b[48;5;236m';   // 深灰背景
const FG_LANG = '\x1b[38;5;243m';   // 语言标签颜色
const FG_BORDER = '\x1b[38;5;240m'; // 边框颜色
const FG_CODE = '\x1b[38;5;252m';   // 代码文本颜色

/** 获取终端宽度，用于代码块边框 */
function getTermWidth(): number {
  return Math.min(process.stdout.columns || 80, 100);
}

/**
 * 去除字符串中的 ANSI 转义序列，返回可见字符长度
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 自定义代码块渲染：深色背景 + Unicode 边框 + 语言标签
 */
function renderCodeBlock(code: string, lang?: string): string {
  const width = getTermWidth() - 4;
  const innerWidth = width - 2;
  const lines = code.replace(/\n$/, '').split('\n');

  const langTag = lang ? ` ${lang} ` : '';
  const topBarFill = innerWidth - langTag.length;

  const parts: string[] = [];

  parts.push(
    `${FG_BORDER}┌${'─'.repeat(Math.max(topBarFill - langTag.length, 1))}${FG_LANG}${langTag}${FG_BORDER}${'─'.repeat(Math.min(langTag.length, topBarFill))}┐${RESET}`
  );

  for (const line of lines) {
    const visible = stripAnsi(line);
    const pad = Math.max(innerWidth - visible.length, 0);
    parts.push(
      `${FG_BORDER}│${RESET}${BG_CODE}${FG_CODE}${line}${' '.repeat(pad)}${RESET}${FG_BORDER}│${RESET}`
    );
  }

  parts.push(
    `${FG_BORDER}└${'─'.repeat(innerWidth)}┘${RESET}`
  );

  return '\n' + parts.join('\n') + '\n';
}

// ===== 表格边框字符 =====
const TABLE_CHARS = {
  top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
  bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
  left: '│', 'left-mid': '├',
  mid: '─', 'mid-mid': '┼',
  right: '│', 'right-mid': '┤',
  middle: '│',
};

/**
 * 根据终端宽度和实际列数，计算每列宽度
 * cli-table3 的 colWidths 包含 padding（左右各1），所以每列最小宽度 = 内容宽度 + 2
 */
function calcColWidths(colCount: number): number[] {
  const termWidth = getTermWidth();
  // 边框占用：左边框1 + 列间分隔符(colCount-1) + 右边框1 = colCount + 1
  const borderOverhead = colCount + 1;
  // 每列 padding 左右各1
  const paddingOverhead = colCount * 2;
  const available = Math.max(termWidth - borderOverhead - paddingOverhead, colCount * 6);
  const baseWidth = Math.floor(available / colCount);
  const remainder = available - baseWidth * colCount;

  // 均分宽度，余数分给前几列；+2 是 cli-table3 的 padding
  return Array.from({ length: colCount }, (_, i) =>
    baseWidth + (i < remainder ? 1 : 0) + 2
  );
}

/**
 * 递归提取 marked token 中的纯文本内容
 */
function extractTokenText(tokens: any[]): string {
  if (!tokens || !Array.isArray(tokens)) return '';
  return tokens.map((t: any) => {
    if (t.type === 'text' || t.type === 'codespan') return t.text || t.raw || '';
    if (t.type === 'strong' || t.type === 'em' || t.type === 'del') return extractTokenText(t.tokens);
    if (t.type === 'link') return extractTokenText(t.tokens);
    return t.raw || t.text || '';
  }).join('');
}

/**
 * 自定义表格渲染：动态列宽 + 自动换行
 * 作为 marked extension 注入，完全接管表格 token 的渲染
 */
function renderTable(token: any): string {
  // 解析表头
  const headerCells: string[] = token.header.map((cell: any) =>
    extractTokenText(cell.tokens)
  );

  // 解析表体
  const bodyRows: string[][] = token.rows.map((row: any) =>
    row.map((cell: any) => extractTokenText(cell.tokens))
  );

  const colCount = headerCells.length;
  if (colCount === 0) return '';

  const colWidths = calcColWidths(colCount);

  const table = new Table({
    head: headerCells,
    chars: TABLE_CHARS,
    colWidths,
    wordWrap: true,
    wrapOnWordBoundary: false,
    style: {
      'padding-left': 1,
      'padding-right': 1,
      head: ['cyan', 'bold'],
    },
  });

  for (const row of bodyRows) {
    table.push(row);
  }

  return '\n' + table.toString() + '\n\n';
}

// 创建 marked 实例
const marked = new Marked(
  markedTerminal({
    reflowText: false,
    code: renderCodeBlock,
    // 保留 tableOptions 作为 fallback，但主要靠 extension 接管
    tableOptions: {
      chars: TABLE_CHARS,
    },
  }) as any,
  // 自定义 table renderer extension，优先级高于 markedTerminal 的 table 方法
  {
    renderer: {
      table: renderTable as any,
    },
  },
);

/**
 * 补全流式文本中未闭合的 markdown 结构
 */
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
function renderMarkdown(text: string): string {
  try {
    const patched = patchIncompleteMarkdown(text);
    const rendered = marked.parse(patched) as string;
    return rendered.replace(/^\n+/, '').replace(/\n+$/, '');
  } catch {
    return text;
  }
}

function wrapRenderedLine(line: string, width: number): string[] {
  if (!line) return [''];

  const safeWidth = Math.max(width, 12);
  const plainLine = stripAnsi(line);
  const listPrefixMatch = plainLine.match(/^(\s*(?:[*+-]|\d+\.)\s+)/);

  if (!listPrefixMatch) {
    return wrapAnsi(line, safeWidth, {
      hard: true,
      trim: false,
      wordWrap: false,
    }).split('\n');
  }

  const prefix = listPrefixMatch[1];
  const content = line.slice(prefix.length);
  const contentWidth = Math.max(safeWidth - prefix.length, 8);
  const wrappedContent = wrapAnsi(content, contentWidth, {
    hard: true,
    trim: false,
    wordWrap: false,
  }).split('\n');

  return wrappedContent.map((segment, index) => (
    `${index === 0 ? prefix : ' '.repeat(prefix.length)}${segment}`
  ));
}

/**
 * Markdown 终端渲染组件
 * 支持表格（动态列宽+自动换行）、代码块（深色背景+边框）、加粗、列表等
 * 对流式不完整文本做容错补全
 *
 * 渲染策略：将 ANSI 字符串按 \n 拆行，每行用独立 <Text> 渲染。
 * 直接将含 \n 的 ANSI 字符串塞入单个 <Text> 会导致 ink 布局引擎
 * 与 ANSI 转义序列冲突，出现光标错位和输出错乱。
 */
function MarkdownText({ text, color }: { text: string; color?: string }) {
  const { stdout } = useStdout();

  const lines = useMemo(() => {
    const rendered = renderMarkdown(text);
    const availableWidth = Math.max(Math.min(stdout?.columns ?? 80, 100) - 6, 20);
    return rendered
      .split('\n')
      .flatMap((line) => wrapRenderedLine(line, availableWidth));
  }, [text, stdout]);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} color={color}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

export default React.memo(MarkdownText);
