/**
 * 消息打印器
 *
 * 负责将 Message 对象格式化为终端 ANSI 字符串并输出。
 * 输出后的内容不可撤回（append-only），这是避免闪烁的关键。
 */

import * as ansi from './ansi.js';
import { Message, MessageStatus, MessageType } from '../types/index.js';
import { renderMarkdownToAnsi } from './markdownRenderer.js';

/** ● 占 2 列 + 1 空格 = 3 列，后续行需要对齐到同样的缩进 */
const INDENT = '   '; // 3 个空格，对齐 "● " 后的内容起始位置

function statusDot(status: MessageStatus, type?: MessageType): { dot: string; color: string } {
  if (status === 'pending') return { dot: '●', color: 'yellow' };
  if (status === 'aborted') return { dot: '●', color: 'yellow' };
  if (status === 'error') return { dot: '●', color: 'red' };
  if (type === 'reasoning') return { dot: '●', color: 'white' };
  if (type === 'tool_exec') return { dot: '●', color: 'green' };
  return { dot: '●', color: 'green' };
}

function formatStats(msg: Message, showDetails: boolean): string {
  const showAbortHint = msg.status === 'aborted' && msg.abortHint;
  if (!showDetails && !showAbortHint) return '';

  const parts: string[] = [];
  if (showDetails) {
    if (msg.duration != null) parts.push(`耗时 ${(msg.duration / 1000).toFixed(1)}s`);
    if (msg.tokenCount != null) parts.push(`${msg.tokenCount} tokens`);
    if (msg.firstTokenLatency != null) parts.push(`首token ${msg.firstTokenLatency}ms`);
    if (msg.tokensPerSecond != null) parts.push(`${msg.tokensPerSecond.toFixed(1)} tok/s`);
  }

  let result = '';
  if (parts.length > 0) {
    result += `${INDENT}${ansi.fg('gray')}${ansi.DIM}${parts.join(' · ')}${ansi.RESET}\n`;
  }
  if (showAbortHint) {
    result += `${INDENT}${ansi.fg('red')}⏹ ${msg.abortHint}${ansi.RESET}\n`;
  }
  return result;
}

/** 将多行内容按 dot 前缀格式输出：第一行带 dot，后续行缩进对齐 */
function pushDotContent(lines: string[], dotColor: string, dot: string, contentLines: string[]): void {
  if (contentLines.length === 0) return;
  lines.push(`${ansi.fg(dotColor)}${dot} ${ansi.RESET}${contentLines[0]}`);
  for (let i = 1; i < contentLines.length; i++) {
    lines.push(`${INDENT}${contentLines[i]}`);
  }
}

export function formatMessage(msg: Message, showDetails: boolean): string[] {
  const lines: string[] = [];
  const { dot, color: dotColor } = statusDot(msg.status, msg.type);

  if (msg.type === 'user') {
    lines.push(`${ansi.fg('gray')}❯ ${ansi.RESET}${ansi.BOLD}${msg.content}${ansi.RESET}`);
    lines.push('');
    return lines;
  }

  if (msg.type === 'thinking' && msg.status === 'pending') {
    lines.push(`${ansi.fg('yellow')}⠋${ansi.RESET} ${ansi.fg(dotColor)}${dot}${ansi.RESET} ${ansi.fg('gray')}Thinking...${ansi.RESET}`);
    return lines;
  }

  if (msg.type === 'thinking' && msg.status === 'success' && msg.think) {
    const header = `${ansi.fg('cyan')}○ ${ansi.RESET}${msg.subAgentId ? `${ansi.fg('blue')}${ansi.DIM}${msg.subAgentId} › ${ansi.RESET}` : ''}${ansi.fg('gray')}Thinking${ansi.RESET}${ansi.fg('gray')}${ansi.DIM} (${msg.think.length} chars)${ansi.RESET}`;
    if (showDetails) {
      lines.push(header);
      for (const tl of msg.think.split('\n')) {
        lines.push(`${INDENT}${ansi.fg('gray')}${ansi.DIM}${tl}${ansi.RESET}`);
      }
    } else {
      lines.push(header + `${ansi.fg('gray')}${ansi.DIM}  [Ctrl+O 展开]${ansi.RESET}`);
    }
    return lines;
  }

  if (msg.type === 'tool_exec') {
    const isBash = msg.toolName === 'Bash';
    const bashCmd = isBash && msg.toolArgs?.command ? String(msg.toolArgs.command) : '';
    const isSkill = msg.toolName?.startsWith('skill_');
    const skillName = isSkill ? msg.toolName!.replace(/^skill_/, '') : '';
    const skillArgsSummary = isSkill && msg.toolArgs
      ? Object.values(msg.toolArgs).map((v) => String(v)).filter(Boolean).join(', ')
      : '';
    const isParallel = !!msg.parallelGroupId;
    const subAgentPrefix = msg.subAgentId ? `${ansi.fg('blue')}${ansi.DIM}${msg.subAgentId} - ${ansi.RESET}` : '';

    let toolLabel: string;
    if (isBash && bashCmd) {
      toolLabel = `${ansi.fg('white')}${ansi.BOLD}Bash${ansi.RESET}${ansi.fg('gray')}(${bashCmd})${ansi.RESET}`;
    } else if (isSkill) {
      toolLabel = `${ansi.fg('cyan')}${ansi.BOLD}${skillName}${ansi.RESET}${ansi.fg('gray')}(${skillArgsSummary})${ansi.RESET}`;
    } else {
      toolLabel = `${ansi.fg('magenta')}${ansi.BOLD}${msg.toolName || 'tool'}${ansi.RESET}`;
    }

    const parallelPrefix = isParallel ? `${ansi.fg('cyan')}${ansi.DIM}⇉ ${ansi.RESET}` : '';
    lines.push(`${parallelPrefix}${ansi.fg(dotColor)}${dot} ${ansi.RESET}${subAgentPrefix}${toolLabel}`);

    if (showDetails && msg.toolArgs && !isBash) {
      lines.push(`${INDENT}${ansi.fg('gray')}${ansi.DIM}${JSON.stringify(msg.toolArgs)}${ansi.RESET}`);
    }
    if (showDetails && msg.toolResult) {
      const result = msg.toolResult.length > 300 ? msg.toolResult.slice(0, 300) + '…' : msg.toolResult;
      lines.push(`${INDENT}${ansi.fg('gray')}${result}${ansi.RESET}`);
    }

    const stats = formatStats(msg, showDetails);
    if (stats) lines.push(stats.trimEnd());
    lines.push('');
    return lines;
  }

  if (msg.type === 'error') {
    lines.push(`${ansi.fg(dotColor)}${dot} ${ansi.RESET}${ansi.fg('red')}${msg.content}${ansi.RESET}`);
    const stats = formatStats(msg, showDetails);
    if (stats) lines.push(stats.trimEnd());
    lines.push('');
    return lines;
  }

  if (msg.type === 'reasoning') {
    const rendered = renderMarkdownToAnsi(msg.content);
    if (msg.subAgentId) {
      lines.push(`${ansi.fg(dotColor)}${dot} ${ansi.RESET}${ansi.fg('blue')}${ansi.DIM}${msg.subAgentId} › ${ansi.RESET}`);
      for (const cl of rendered.split('\n')) {
        lines.push(`${INDENT}${cl}`);
      }
    } else {
      pushDotContent(lines, dotColor, dot, rendered.split('\n'));
    }
    const stats = formatStats(msg, showDetails);
    if (stats) lines.push(stats.trimEnd());
    lines.push('');
    return lines;
  }

  if (msg.type === 'system' && msg.content) {
    if (msg.systemKind === 'shortcut_help') {
      lines.push(...formatShortcutHelp());
    } else {
      pushDotContent(lines, dotColor, dot, renderMarkdownToAnsi(msg.content).split('\n'));
    }
    const stats = formatStats(msg, showDetails);
    if (stats) lines.push(stats.trimEnd());
    lines.push('');
    return lines;
  }

  // 其他已完成消息
  if (msg.status !== 'pending' && msg.content) {
    pushDotContent(lines, dotColor, dot, renderMarkdownToAnsi(msg.content).split('\n'));
    const stats = formatStats(msg, showDetails);
    if (stats) lines.push(stats.trimEnd());
    lines.push('');
    return lines;
  }

  return lines;
}

function formatShortcutHelp(): string[] {
  const lines: string[] = [];
  lines.push(`${ansi.fg('cyan')}${ansi.BOLD}快捷键帮助${ansi.RESET}`);
  lines.push(`${ansi.fg('gray')}macOS 用户：Option 键 = Alt 键${ansi.RESET}`);
  lines.push('');
  lines.push(`${ansi.fg('yellow')}${ansi.BOLD}基础操作${ansi.RESET}`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}Enter${ansi.RESET}              提交输入`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}Alt+Enter${ansi.RESET}          换行（多行输入）`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}↑ / ↓${ansi.RESET}             浏览历史输入`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}Tab${ansi.RESET}                填入提示`);
  lines.push('');
  lines.push(`${ansi.fg('yellow')}${ansi.BOLD}控制${ansi.RESET}`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}Ctrl+C × 2${ansi.RESET}        退出`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}ESC${ansi.RESET}                中断推理`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}ESC × 2${ansi.RESET}           清空输入`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}Ctrl+L${ansi.RESET}             清屏并重置会话`);
  lines.push(`${INDENT}${ansi.fg('green')}${ansi.BOLD}Ctrl+O${ansi.RESET}             展开/折叠详情`);
  return lines;
}
