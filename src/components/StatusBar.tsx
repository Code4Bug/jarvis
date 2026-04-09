import React from 'react';
import { Box, Text } from 'ink';
import { MODEL_NAME, PROJECT_NAME, ENABLE_THINKING_MODE_TOGGLE, CONTEXT_TOKEN_LIMIT } from '../config/constants';

interface StatusBarProps {
  width: number;
  totalTokens: number;
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

function StatusBar({ width, totalTokens }: StatusBarProps) {
  const left = ` ${MODEL_NAME} │ ${PROJECT_NAME}`;

  // 右侧：token 进度条 + 思考模式切换（可选）
  const tokenLabel = `${totalTokens}/${CONTEXT_TOKEN_LIMIT}`;
  const barWidth = 10;
  const { bar, color } = tokenProgressBar(totalTokens, CONTEXT_TOKEN_LIMIT, barWidth);
  const effortPart = ENABLE_THINKING_MODE_TOGGLE ? ' │ ● medium · /effort' : '';
  // 右侧完整文本长度（用于计算间距）
  const rightLen = tokenLabel.length + 1 + barWidth + effortPart.length + 1;
  const gap = Math.max(width - left.length - rightLen, 1);

  return (
    <Box>
      <Text color="gray">{left}</Text>
      <Text>{' '.repeat(gap)}</Text>
      <Text color="gray">{tokenLabel} </Text>
      <Text color={color}>{bar}</Text>
      {ENABLE_THINKING_MODE_TOGGLE && <Text color="gray">{effortPart}</Text>}
      <Text> </Text>
    </Box>
  );
}

export default React.memo(StatusBar);
