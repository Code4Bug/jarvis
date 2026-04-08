/**
 * 危险命令交互式确认组件
 *
 * 拦截到危险命令时弹出，提供三个选项：
 *   1. 临时执行（仅本次）
 *   2. 持久授权（写入 ~/.jarvis/.permissions.json）
 *   3. 取消执行
 */

import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

export type ConfirmChoice = 'once' | 'always' | 'cancel';

interface DangerConfirmProps {
  command: string;
  reason: string;
  ruleName: string;
  onSelect: (choice: ConfirmChoice) => void;
}

const OPTIONS: { key: ConfirmChoice; label: string; color: string }[] = [
  { key: 'once',   label: '临时执行（仅本次会话）',                       color: 'yellow' },
  { key: 'always', label: '持久授权（写入 ~/.jarvis/.permissions.json）', color: 'green' },
  { key: 'cancel', label: '取消执行',                                     color: 'red' },
];

// 圆角边框字符
const BORDER = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

export default function DangerConfirm({ command, reason, ruleName, onSelect }: DangerConfirmProps) {
  const [selectedIndex, setSelectedIndex] = useState(2); // 默认选中「取消」，最安全
  const { stdout } = useStdout();
  const cols = Math.min(stdout?.columns ?? 80, 80);
  // 内容区宽度 = 总宽度 - 左右边框(2) - 左右 padding(2)
  const innerWidth = cols - 4;

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

  const hLine = BORDER.h.repeat(cols - 2);
  const topBorder = BORDER.tl + hLine + BORDER.tr;
  const bottomBorder = BORDER.bl + hLine + BORDER.br;

  /** 渲染一行带左右边框的内容 */
  const row = (children: React.ReactNode) => (
    <Box>
      <Text color="yellow">{BORDER.v} </Text>
      <Box width={innerWidth}>
        {children}
      </Box>
      <Text color="yellow"> {BORDER.v}</Text>
    </Box>
  );

  const emptyRow = row(<Text> </Text>);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">{topBorder}</Text>

      {row(<Text color="yellow" bold>安全围栏拦截</Text>)}
      {emptyRow}
      {row(<Text color="gray">命令: <Text color="white" bold>{command}</Text></Text>)}
      {row(<Text color="gray">规则: <Text color="cyan">{ruleName}</Text></Text>)}
      {row(<Text color="red">{reason}</Text>)}
      {emptyRow}
      {row(<Text color="gray" dimColor>使用 ↑↓ 选择，Enter 确认，ESC 取消:</Text>)}
      {emptyRow}
      {OPTIONS.map((opt, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? '❯ ' : '  ';
        return (
          <React.Fragment key={opt.key}>
            {row(
              <Text color={isSelected ? opt.color : 'gray'} bold={isSelected}>
                {prefix}{opt.label}
              </Text>
            )}
          </React.Fragment>
        );
      })}

      <Text color="yellow">{bottomBorder}</Text>
    </Box>
  );
}
