import React from 'react';
import { Box, Text } from 'ink';
import { SlashCommand } from '../commands/index';

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  /** 菜单最大可见行数 */
  maxVisible?: number;
}

/** 类别标签颜色 */
const categoryColor: Record<string, string> = {
  agent: 'magenta',
  tool: 'cyan',
  builtin: 'gray',
};

const categoryLabel: Record<string, string> = {
  agent: '智能体',
  tool: '工具',
  builtin: '内置',
};

/**
 * 斜杠命令下拉菜单组件
 *
 * 显示在输入框上方，支持滚动窗口。
 */
function SlashCommandMenu({
  commands,
  selectedIndex,
  maxVisible = 6,
}: SlashCommandMenuProps) {
  if (commands.length === 0) {
    return (
      <Box paddingLeft={2}>
        <Text color="gray" italic>无匹配命令</Text>
      </Box>
    );
  }

  // 计算滚动窗口
  const total = commands.length;
  const visible = Math.min(total, maxVisible);
  let start = 0;
  if (selectedIndex >= visible) {
    start = selectedIndex - visible + 1;
  }
  if (start + visible > total) {
    start = Math.max(0, total - visible);
  }
  const visibleItems = commands.slice(start, start + visible);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {start > 0 && (
        <Text color="gray" dimColor>  ↑ 还有 {start} 项</Text>
      )}
      {visibleItems.map((cmd, i) => {
        const realIndex = start + i;
        const isSelected = realIndex === selectedIndex;
        const catColor = categoryColor[cmd.category] ?? 'gray';
        const catText = categoryLabel[cmd.category] ?? cmd.category;

        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {' '}/{cmd.name}{' '}
            </Text>
            <Text color={isSelected ? 'cyan' : 'gray'}>
              - {cmd.description}{' '}
            </Text>
            <Text color={catColor} dimColor>[{catText}]</Text>
          </Box>
        );
      })}
      {start + visible < total && (
        <Text color="gray" dimColor>  ↓ 还有 {total - start - visible} 项</Text>
      )}
    </Box>
  );
}

export default React.memo(SlashCommandMenu);
