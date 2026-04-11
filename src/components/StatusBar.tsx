import React from 'react';
import { Box, Text } from 'ink';
import { PROJECT_NAME, getContextTokenLimit, getModelName, isThinkingModeToggleEnabled } from '../config/constants.js';

interface StatusBarProps {
  width: number;
  totalTokens: number;
  activeAgents?: number;
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
  const modelName = getModelName();
  const contextTokenLimit = getContextTokenLimit();
  const thinkingModeToggleEnabled = isThinkingModeToggleEnabled();
  const left = ` ${modelName} │ ${PROJECT_NAME}`;

  // 右侧：智能体数量（有后台 Agent 时显示）+ token 进度条 + 思考模式切换（可选）
  const agentPart = activeAgents > 0 ? `⬡ ${activeAgents} agent${activeAgents > 1 ? 's' : ''} │ ` : '';
  const tokenLabel = `${totalTokens}/${contextTokenLimit}`;
  const barWidth = 10;
  const { bar, color } = tokenProgressBar(totalTokens, contextTokenLimit, barWidth);
  const effortPart = thinkingModeToggleEnabled ? ' │ ● medium · /effort' : '';
  // 右侧完整文本长度（用于计算间距）
  const rightLen = agentPart.length + tokenLabel.length + 1 + barWidth + effortPart.length + 1;
  const gap = Math.max(width - left.length - rightLen, 1);

  return (
    <Box>
      <Text color="gray">{left}</Text>
      <Text>{' '.repeat(gap)}</Text>
      {activeAgents > 0 && <Text color="cyan">{agentPart}</Text>}
      <Text color="gray">{tokenLabel} </Text>
      <Text color={color}>{bar}</Text>
      {thinkingModeToggleEnabled && <Text color="gray">{effortPart}</Text>}
      <Text> </Text>
    </Box>
  );
}

export default React.memo(StatusBar);
