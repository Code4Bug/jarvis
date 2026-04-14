import React from 'react';
import { Box, Text } from 'ink';
import { PROJECT_NAME, getContextTokenLimit, getModelName, isThinkingModeToggleEnabled } from '../config/constants.js';
import { getToolStatsText } from '../tools/index.js';
import { useSessionDurationDisplay } from '../hooks/useSessionDurationDisplay.js';
import { useSessionStartDisplay } from '../hooks/useSessionStartDisplay.js';

interface StatusBarProps {
  width: number;
  totalTokens: number;
  activeAgents?: number;
}

function charDisplayWidth(char: string): number {
  if (!char) return 0;
  const code = char.codePointAt(0) ?? 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
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
  ) {
    return 2;
  }
  return 1;
}

function getDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charDisplayWidth(char);
  }
  return width;
}

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (getDisplayWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return '…';

  let result = '';
  let currentWidth = 0;
  for (const char of text) {
    const nextWidth = charDisplayWidth(char);
    if (currentWidth + nextWidth > maxWidth - 1) break;
    result += char;
    currentWidth += nextWidth;
  }
  return `${result}…`;
}

/** 生成 token 用量进度条 */
function tokenProgressBar(used: number, limit: number, barWidth: number): { bar: string; color: string } {
  const ratio = Math.min(used / limit, 1);
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = ratio >= 0.9 ? 'red' : ratio >= 0.7 ? 'yellow' : 'green';
  return { bar, color };
}

function StatusBar({ width, totalTokens, activeAgents = 0 }: StatusBarProps) {
  const sessionStartedAt = useSessionStartDisplay();
  const sessionDurationLabel = useSessionDurationDisplay(sessionStartedAt);
  const modelName = getModelName();
  const contextTokenLimit = getContextTokenLimit();
  const thinkingModeToggleEnabled = isThinkingModeToggleEnabled();
  const toolStats = getToolStatsText();
  const rawLeft = ` ${modelName} │ ${PROJECT_NAME} │ ${toolStats}`;

  // 右侧：智能体数量（有后台 Agent 时显示）+ token 进度条 + 思考模式切换（可选）
  const agentPart = activeAgents > 0 ? `⬡ ${activeAgents} agent${activeAgents > 1 ? 's' : ''} │ ` : '';
  const sessionPart = `会话 ${sessionDurationLabel} │ `;
  const tokenLabel = `${totalTokens}/${contextTokenLimit}`;
  const barWidth = 10;
  const { bar, color } = tokenProgressBar(totalTokens, contextTokenLimit, barWidth);
  const effortPart = thinkingModeToggleEnabled ? ' │ ● medium · /effort' : '';
  // 右侧完整文本长度（用于计算间距）
  const rightLen = getDisplayWidth(agentPart) + getDisplayWidth(sessionPart) + getDisplayWidth(tokenLabel) + 1 + barWidth + getDisplayWidth(effortPart) + 1;
  const leftMaxWidth = Math.max(width - rightLen - 1, 1);
  const left = truncateText(rawLeft, leftMaxWidth);
  const gap = Math.max(width - getDisplayWidth(left) - rightLen, 1);

  return (
    <Box>
      <Text color="gray">{left}</Text>
      <Text>{' '.repeat(gap)}</Text>
      {activeAgents > 0 && <Text color="cyan">{agentPart}</Text>}
      <Text color="blue">{sessionPart}</Text>
      <Text color="gray">{tokenLabel} </Text>
      <Text color={color}>{bar}</Text>
      {thinkingModeToggleEnabled && <Text color="gray">{effortPart}</Text>}
      <Text> </Text>
    </Box>
  );
}

export default React.memo(StatusBar);
