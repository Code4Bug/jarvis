/**
 * 危险命令交互式确认组件
 *
 * 拦截到危险命令时弹出，提供四个选项：
 *   1. 当次允许（仅执行这一次）
 *   2. 本轮会话允许（当前 session 内持续生效）
 *   3. 持久授权（写入 ~/.jarvis/.permissions.json）
 *   4. 取消执行
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

export type ConfirmChoice = 'once' | 'session' | 'always' | 'cancel';

interface DangerConfirmProps {
  command: string;
  reason: string;
  ruleName: string;
  onSelect: (choice: ConfirmChoice) => void;
}

const OPTIONS: { key: ConfirmChoice; label: string; color: string }[] = [
  { key: 'once',    label: '当次允许（仅执行这一次）',                       color: 'yellow' },
  { key: 'session', label: '本轮会话允许（仅当前 session）',                 color: 'cyan' },
  { key: 'always',  label: '持久授权（写入 ~/.jarvis/.permissions.json）',   color: 'green' },
  { key: 'cancel',  label: '取消执行',                                       color: 'red' },
];

export default function DangerConfirm({ command, reason, ruleName, onSelect }: DangerConfirmProps) {
  const [selectedIndex, setSelectedIndex] = useState(3); // 默认选中「取消」，最安全
  const { stdout } = useStdout();
  const cols = Math.min(stdout?.columns ?? 80, 84);
  const contentWidth = Math.max(32, cols - 8);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : OPTIONS.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < OPTIONS.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      onSelect(OPTIONS[selectedIndex].key);
    } else if (key.escape) {
      onSelect('cancel');
    }
  });

  const section = (label: string, value: React.ReactNode) => (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">{label}</Text>
      <Box width={contentWidth} marginTop={0}>
        {value}
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Box flexDirection="column">
        <Text backgroundColor="yellow" color="black" bold>
          {' 安全围栏 '}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold color="white">检测到高风险命令</Text>
          <Text color="gray">请确认是否继续执行</Text>
        </Box>
      </Box>

      {section('命令', <Text color="white" bold wrap="truncate-end">{command}</Text>)}
      {section('规则', <Text color="cyan">{ruleName}</Text>)}
      {section('原因', <Text color="red">{reason}</Text>)}

      <Box marginTop={2}>
        <Text color="gray" dimColor>使用 ↑↓ 选择，Enter 确认，ESC 取消</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
      {OPTIONS.map((opt, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? '›' : ' ';
        const textColor = isSelected ? 'black' : opt.color;
        const backgroundColor = isSelected
          ? (opt.color === 'yellow'
            ? 'yellow'
            : opt.color === 'cyan'
              ? 'cyan'
              : opt.color === 'green'
                ? 'green'
                : 'red')
          : undefined;
        return (
          <Box key={opt.key} marginTop={i === 0 ? 0 : 1}>
            <Text
              color={textColor}
              backgroundColor={backgroundColor}
              bold={isSelected}
            >
              {` ${prefix} ${opt.label} `}
            </Text>
          </Box>
        );
      })}
      </Box>
    </Box>
  );
}
