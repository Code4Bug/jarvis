import React from 'react';
import { Box, Text } from 'ink';
import { useStreamDisplay } from '../hooks/useStreamDisplay.js';
import MarkdownText from './MarkdownText.js';

/**
 * 流式阶段实时 markdown 渲染。
 * 通过 useStreamDisplay 外部 store 订阅，只有本组件刷新，不影响父级渲染树。
 * MarkdownText 内部已对未闭合 fence/backtick 做容错补全。
 * 正式消息落盘后由 MessageItem -> MarkdownText 接管（内容相同，无闪烁）。
 */
function StreamingDraft() {
  const text = useStreamDisplay();

  if (!text) return null;

  return (
    <Box marginBottom={1} flexDirection="column">
      <Box alignItems="flex-start">
        <Text color="yellow">● </Text>
        <Box flexDirection="column" flexShrink={1}>
          <MarkdownText text={text} />
        </Box>
      </Box>
    </Box>
  );
}

export default React.memo(StreamingDraft);
