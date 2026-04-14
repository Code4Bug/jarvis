/**
 * 状态栏构建器
 *
 * 将状态栏信息格式化为 ANSI 字符串，不依赖 Ink 组件。
 */

import * as ansi from './ansi.js';
import { PROJECT_NAME, getContextTokenLimit, getModelName, isThinkingModeToggleEnabled } from '../config/constants.js';
import { getToolStatsText } from '../tools/index.js';

function tokenProgressBar(used: number, limit: number, barWidth: number): { bar: string; color: string } {
  const ratio = Math.min(used / limit, 1);
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = ratio >= 0.9 ? 'red' : ratio >= 0.7 ? 'yellow' : 'green';
  return { bar, color };
}

function formatDuration(startedAt: number): string {
  if (!startedAt || startedAt <= 0) return '00s';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (elapsedSeconds < 60) return `${String(elapsedSeconds).padStart(2, '0')}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}h${String(mins).padStart(2, '0')}m`;
  return `${String(mins).padStart(2, '0')}m`;
}

export function buildStatusBar(
  width: number,
  totalTokens: number,
  activeAgents: number,
  sessionStartedAt: number,
): string {
  const modelName = getModelName();
  const contextTokenLimit = getContextTokenLimit();
  const thinkingModeToggleEnabled = isThinkingModeToggleEnabled();
  const toolStats = getToolStatsText();
  const sessionDurationLabel = formatDuration(sessionStartedAt);

  const rawLeft = ` ${modelName} │ ${PROJECT_NAME} │ ${toolStats}`;

  // 右侧
  const agentPart = activeAgents > 0 ? `⬡ ${activeAgents} agent${activeAgents > 1 ? 's' : ''} │ ` : '';
  const sessionPart = `会话 ${sessionDurationLabel} │ `;
  const tokenLabel = `${totalTokens}/${contextTokenLimit}`;
  const barWidth = 10;
  const { bar, color } = tokenProgressBar(totalTokens, contextTokenLimit, barWidth);
  const effortPart = thinkingModeToggleEnabled ? ' │ ● medium · /effort' : '';

  const rightLen = ansi.textWidth(agentPart) + ansi.textWidth(sessionPart) + ansi.textWidth(tokenLabel) + 1 + barWidth + ansi.textWidth(effortPart) + 1;
  const leftMaxWidth = Math.max(width - rightLen - 1, 1);
  const left = ansi.truncate(rawLeft, leftMaxWidth);
  const gap = Math.max(width - ansi.textWidth(left) - rightLen, 1);

  let result = `${ansi.fg('gray')}${left}${ansi.RESET}`;
  result += ' '.repeat(gap);
  if (activeAgents > 0) result += `${ansi.fg('cyan')}${agentPart}${ansi.RESET}`;
  result += `${ansi.fg('blue')}${sessionPart}${ansi.RESET}`;
  result += `${ansi.fg('gray')}${tokenLabel} ${ansi.RESET}`;
  result += `${ansi.fg(color)}${bar}${ansi.RESET}`;
  if (thinkingModeToggleEnabled) result += `${ansi.fg('gray')}${effortPart}${ansi.RESET}`;
  result += ' ';

  return result;
}
