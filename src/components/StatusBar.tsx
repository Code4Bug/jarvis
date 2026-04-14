import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { PROJECT_NAME, getContextTokenLimit, getModelName, isThinkingModeToggleEnabled } from '../config/constants.js';
import { getToolStatsText } from '../tools/index.js';

interface StatusBarProps {
  width: number;
  totalTokens: number;
  activeAgents?: number;
  sessionStartedAt?: number;
}

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1)}…`;
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

function formatSessionDuration(sessionStartedAt?: number, now: number = Date.now()): string {
  if (!sessionStartedAt || sessionStartedAt <= 0) return '00:00';
  const elapsedSeconds = Math.max(0, Math.floor((now - sessionStartedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function StatusBar({ width, totalTokens, activeAgents = 0, sessionStartedAt }: StatusBarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [sessionStartedAt]);

  const modelName = getModelName();
  const contextTokenLimit = getContextTokenLimit();
  const thinkingModeToggleEnabled = isThinkingModeToggleEnabled();
  const toolStats = getToolStatsText();
  const rawLeft = ` ${modelName} │ ${PROJECT_NAME} │ ${toolStats}`;

  // 右侧：智能体数量（有后台 Agent 时显示）+ token 进度条 + 思考模式切换（可选）
  const agentPart = activeAgents > 0 ? `⬡ ${activeAgents} agent${activeAgents > 1 ? 's' : ''} │ ` : '';
  const sessionPart = `会话 ${formatSessionDuration(sessionStartedAt, now)} │ `;
  const tokenLabel = `${totalTokens}/${contextTokenLimit}`;
  const barWidth = 10;
  const { bar, color } = tokenProgressBar(totalTokens, contextTokenLimit, barWidth);
  const effortPart = thinkingModeToggleEnabled ? ' │ ● medium · /effort' : '';
  // 右侧完整文本长度（用于计算间距）
  const rightLen = agentPart.length + sessionPart.length + tokenLabel.length + 1 + barWidth + effortPart.length + 1;
  const leftMaxWidth = Math.max(width - rightLen - 1, 1);
  const left = truncateText(rawLeft, leftMaxWidth);
  const gap = Math.max(width - left.length - rightLen, 1);

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
